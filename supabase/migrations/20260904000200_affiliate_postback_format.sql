-- Affiliate postbacks — native AlterCPA advertiser-API mode.
--
-- Our postback was built as a generic Keitaro-style tracker pixel: it emits
-- WORDS ({status} = lead/sale/rejected, {stage} = lead|hold|approve|...).
-- But cpa.toys and cashfactories.com are AlterCPA NETWORKS, not trackers.
-- They expose an advertiser API that wants NUMERIC status codes, NUMERIC
-- cancel reasons, and a separate accept=1 flag for approval:
--
--   GET /api/comp/edit.json?id=<token>&oid=<their order id>&accept=1
--   GET /api/comp/edit.json?id=<token>&oid=<...>&status=5&reason=11
--
-- AlterCPA is explicit that approval MUST go through accept=1: "use this
-- particular confirmation option, and not setting the status of the lead to
-- 'Packaging' or 'Completed', for the correct operation of all mechanisms."
--
-- postback_format keeps the two worlds apart so existing/future generic
-- partners are byte-for-byte unaffected.

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS postback_format text NOT NULL DEFAULT 'generic';

DO $$
BEGIN
  ALTER TABLE public.affiliates
    ADD CONSTRAINT affiliates_postback_format_check
    CHECK (postback_format IN ('generic','altercpa'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Our reason strings -> their numeric codes. PER-AFFILIATE because the two
-- networks publish DIFFERENT tables (they diverge on 15/18/19, and codes
-- 16-19 do not exist in the vendor's generic doc at all). AlterCPA states
-- outright that reasons "may vary depending on your network settings", so a
-- single hardcoded table would be wrong for somebody. NULL = use the default
-- below, which is seeded from the cashfactories/cpa.toys published list.
--
-- Operator decision 2026-07-22: 'rude' and 'uncooperative' map to 2 (Changed
-- his mind), NOT to a trash-flagged code. Those were real people who refused;
-- trash-flagged reasons carry no payout AND remove the lead from the
-- webmaster's approve-rate metric, which would be unfair and invites disputes.
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS altercpa_reason_map jsonb;

COMMENT ON COLUMN public.affiliates.altercpa_reason_map IS
  'Our cancellation/trash reason string -> AlterCPA numeric reason code. NULL = built-in default. Per-affiliate: each network configures its own reason table.';

-- 'ship' is a NEW event: our affiliate_stage() collapses confirmed/shipped/
-- delivered into one 'hold' stage, so confirmed->shipped fires nothing. That
-- is right for a tracker but loses AlterCPA status 7 (Sending).
ALTER TABLE public.affiliate_postbacks
  DROP CONSTRAINT IF EXISTS affiliate_postbacks_event_check;
ALTER TABLE public.affiliate_postbacks
  ADD CONSTRAINT affiliate_postbacks_event_check
  CHECK (event IN ('lead','hold','ship','approve','cancel','trash','return','test'));

-- ── Capture trigger: adds the 'ship' event, altercpa-only ────────────────────
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
  _format text;
BEGIN
  SELECT id, affiliate_id INTO _lead
  FROM public.affiliate_leads WHERE order_id = NEW.id;
  IF _lead.id IS NULL THEN
    RETURN NEW;  -- not an affiliate lead (or sidecar row not written yet)
  END IF;

  SELECT postback_format INTO _format
  FROM public.affiliates WHERE id = _lead.affiliate_id;

  _reason := COALESCE(NEW.cancellation_reason, NEW.return_reason, NEW.trash_reason);

  -- Shipping is invisible to the stage model (confirmed/shipped/delivered are
  -- all 'hold'), so capture it separately and ONLY for AlterCPA partners —
  -- generic trackers must keep receiving exactly the events they do today.
  IF TG_OP = 'UPDATE'
     AND _format = 'altercpa'
     AND NEW.status = 'shipped'
     AND OLD.status IS DISTINCT FROM 'shipped' THEN
    INSERT INTO public.affiliate_postbacks (affiliate_id, affiliate_lead_id, order_id, event, reason)
    VALUES (_lead.affiliate_id, _lead.id, NEW.id, 'ship', NULL)
    ON CONFLICT (affiliate_lead_id, event) WHERE status = 'pending' DO NOTHING;
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

  -- Statuses with no affiliate-visible stage ('duplicated', and anything added
  -- to the enum later) are INTENTIONALLY not reported.
  IF _event IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.affiliate_postbacks (affiliate_id, affiliate_lead_id, order_id, event, reason)
  VALUES (_lead.affiliate_id, _lead.id, NEW.id, _event, _reason)
  ON CONFLICT (affiliate_lead_id, event) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
