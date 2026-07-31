-- Affiliate/CPA program — step 3 of 4: postback queue + capture triggers.
--
-- Postbacks are THE feature affiliates care about: when an order they sent
-- changes stage, we GET their tracker URL with their clickid/subs so their ad
-- pixels optimize. Delivery must be reliable, logged, and retried — so capture
-- is transactional (DB trigger → queue row) and delivery is done by the edge
-- function (Increment 3) with exponential backoff. Postgres itself never makes
-- the HTTP call for a real postback; the every-minute cron (20260801000300)
-- only pokes the edge-function drain.
--
-- Status map (single source of truth = affiliate_stage() below):
--   pending/take/call_again        → wait     (postback event 'lead')
--   confirmed/shipped/delivered    → hold     ("Approved (hold)" — buyout model)
--   paid                           → approve  (payout earned — the ONLY money event)
--   cancelled                      → cancel   trashed → trash   returned → return
-- Transitions WITHIN a stage (pending→take, shipped→delivered…) fire nothing.

-- ── 1) Queue + log (one table, one row per attempted event) ──────────────────
-- order_id is deliberately FK-less: the delivery log must survive order
-- deletion (affiliate_lead_id CASCADEs away, the log row keeps its history).
CREATE TABLE public.affiliate_postbacks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id       uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  affiliate_lead_id  uuid REFERENCES public.affiliate_leads(id) ON DELETE CASCADE,
  order_id           uuid,
  event              text NOT NULL CHECK (event IN ('lead','hold','approve','cancel','trash','return','test')),
  reason             text,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','skipped')),
  attempts           integer NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  rendered_url       text,
  last_response_code integer,
  last_response_body text,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at       timestamptz
);
CREATE INDEX idx_affiliate_postbacks_due
  ON public.affiliate_postbacks (next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_affiliate_postbacks_affiliate
  ON public.affiliate_postbacks (affiliate_id, created_at DESC);
-- Burst collapse (e.g. BigArena bulk-paid): at most ONE pending row per
-- (lead, event); the capture trigger inserts ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX uniq_affiliate_postbacks_active
  ON public.affiliate_postbacks (affiliate_lead_id, event) WHERE status = 'pending';

ALTER TABLE public.affiliate_postbacks ENABLE ROW LEVEL SECURITY;
-- (No policies on purpose — service-role-only access via the edge function;
-- same pattern as the leaderboard tables.)

-- ── 2) Stage mapper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.affiliate_stage(_s public.order_status)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _s
    WHEN 'pending'    THEN 'wait'
    WHEN 'take'       THEN 'wait'
    WHEN 'call_again' THEN 'wait'
    WHEN 'confirmed'  THEN 'hold'
    WHEN 'shipped'    THEN 'hold'
    WHEN 'delivered'  THEN 'hold'
    WHEN 'paid'       THEN 'approve'
    WHEN 'cancelled'  THEN 'cancel'
    WHEN 'trashed'    THEN 'trash'
    WHEN 'returned'   THEN 'return'
  END
$$;

-- ── 3) Capture triggers ───────────────────────────────────────────────────────
-- Same defensive pattern as tg_notify_order_paid: SECURITY DEFINER + swallow
-- everything, so a postback-capture failure can never roll back a status
-- change. Row-level AFTER triggers fire per row even for bulk UPDATEs, so this
-- covers /orders/:id/status, bulk-status-update, bigarena-sync and any future
-- write path.
CREATE OR REPLACE FUNCTION public.tg_enqueue_affiliate_postback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lead   record;
  _event  text;
  _reason text;
BEGIN
  SELECT id, affiliate_id INTO _lead
  FROM public.affiliate_leads WHERE order_id = NEW.id;
  IF _lead.id IS NULL THEN
    RETURN NEW;  -- not an affiliate lead (or sidecar row not written yet)
  END IF;

  IF TG_OP = 'INSERT' THEN
    _event := 'lead';
  ELSE
    IF public.affiliate_stage(NEW.status) IS NOT DISTINCT FROM public.affiliate_stage(OLD.status) THEN
      RETURN NEW;  -- internal churn within the same affiliate-visible stage
    END IF;
    _event := public.affiliate_stage(NEW.status);
    IF _event = 'wait' THEN
      _event := 'lead';  -- regression back to processing re-uses the 'lead' event
    END IF;
  END IF;

  _reason := COALESCE(NEW.cancellation_reason, NEW.return_reason, NEW.trash_reason);

  INSERT INTO public.affiliate_postbacks (affiliate_id, affiliate_lead_id, order_id, event, reason)
  VALUES (_lead.affiliate_id, _lead.id, NEW.id, _event, _reason)
  ON CONFLICT (affiliate_lead_id, event) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- Safety net only: on the intake path the affiliate_leads sidecar is inserted
-- AFTER the order row, so this no-ops there (the intake handler enqueues the
-- 'lead' event itself). It exists for any future path that creates both rows
-- in one transaction.
DROP TRIGGER IF EXISTS trg_affiliate_postback_insert ON public.orders;
CREATE TRIGGER trg_affiliate_postback_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.source_type = 'affiliate')
  EXECUTE FUNCTION public.tg_enqueue_affiliate_postback();

DROP TRIGGER IF EXISTS trg_affiliate_postback_status ON public.orders;
CREATE TRIGGER trg_affiliate_postback_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.source_type = 'affiliate' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_enqueue_affiliate_postback();

-- ── 4) Concurrency-safe claim for the edge-function drain ────────────────────
-- PostgREST can't express FOR UPDATE SKIP LOCKED; this RPC atomically claims a
-- batch of due rows and leases them for 10 minutes (attempts is bumped on
-- claim; the drain rewrites next_attempt_at with the real backoff or marks the
-- row delivered/failed). Two overlapping drains can never double-send.
CREATE OR REPLACE FUNCTION public.claim_due_affiliate_postbacks(_batch integer DEFAULT 20)
RETURNS SETOF public.affiliate_postbacks
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.affiliate_postbacks p
     SET attempts = p.attempts + 1,
         next_attempt_at = now() + interval '10 minutes'
   WHERE p.id IN (
     SELECT q.id
     FROM public.affiliate_postbacks q
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
     ORDER BY q.next_attempt_at
     LIMIT _batch
     FOR UPDATE SKIP LOCKED
   )
   RETURNING p.*;
$$;

REVOKE ALL ON FUNCTION public.claim_due_affiliate_postbacks(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_affiliate_postbacks(integer) TO service_role;
