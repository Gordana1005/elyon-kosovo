-- Incoming calls. The browser softphone can't answer inbound, so instead of
-- ringing, inbound calls are logged here as "missed calls" (caller number +
-- which of our DIDs they dialed + time). An admin/manager assigns an agent to
-- call back. Rows are inserted by the PBX via an HMAC-signed webhook.

CREATE TABLE IF NOT EXISTS public.missed_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_number       text NOT NULL,
  did                 text,                                   -- which of our 20 numbers was dialed (359… form)
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  uniqueid            text UNIQUE,                            -- Asterisk uniqueid (dedupe)
  status              text NOT NULL DEFAULT 'new',            -- new | assigned | called_back | ignored
  assigned_agent_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_agent_name text,
  linked_order_id     uuid,                                   -- matched existing order/customer, if any
  linked_phone_norm   text,                                   -- last-8 normalised caller number (matching)
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_missed_calls_status ON public.missed_calls (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_missed_calls_assigned ON public.missed_calls (assigned_agent_id);

ALTER TABLE public.missed_calls ENABLE ROW LEVEL SECURITY;

-- Admins/managers see all; agents see ones assigned to them. (The Edge Function
-- uses the service role + gates in code; these are a backstop.)
CREATE POLICY "Admins/managers read all missed calls"
  ON public.missed_calls FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','manager')));

CREATE POLICY "Agents read assigned missed calls"
  ON public.missed_calls FOR SELECT
  USING (assigned_agent_id = auth.uid());

-- The missed-call notification trigger function tg_notify_missed_call() is defined
-- in 20260604130000, which (on a from-scratch apply) ran before this table existed
-- and therefore skipped creating the trigger. Create it now that the table exists.
DO $mc_trg$
BEGIN
  IF to_regproc('public.tg_notify_missed_call') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_notify_missed_call ON public.missed_calls;
    CREATE TRIGGER trg_notify_missed_call
      AFTER INSERT ON public.missed_calls
      FOR EACH ROW EXECUTE FUNCTION public.tg_notify_missed_call();
  END IF;
END
$mc_trg$;
