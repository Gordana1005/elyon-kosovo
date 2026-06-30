-- Call telemetry: every dial attempt logs start/connect/end times so we can
-- compute ring vs talk vs total duration. Generated columns keep the
-- durations always in sync with the timestamps. customer_phone is
-- denormalised for fast "show me every call to this number" lookups
-- regardless of whether the call was logged against an order or a
-- prediction lead.
--
-- Pre-existing rows have NULL timestamps (we are not backfilling — the
-- mock VOIP layer didn't capture them).

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS started_at      timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at        timestamptz,
  ADD COLUMN IF NOT EXISTS customer_phone  text,
  ADD COLUMN IF NOT EXISTS connection_state text
    CHECK (connection_state IS NULL OR connection_state IN
      ('answered', 'no_answer', 'busy', 'failed', 'voicemail'));

-- Generated duration columns. Added separately because
-- IF NOT EXISTS + GENERATED is fiddly across PG versions.
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS ring_seconds int
    GENERATED ALWAYS AS (
      CASE WHEN connected_at IS NOT NULL AND started_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (connected_at - started_at))::int
      END
    ) STORED;

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS talk_seconds int
    GENERATED ALWAYS AS (
      CASE WHEN ended_at IS NOT NULL AND connected_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (ended_at - connected_at))::int
      END
    ) STORED;

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS total_seconds int
    GENERATED ALWAYS AS (
      CASE WHEN ended_at IS NOT NULL AND started_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (ended_at - started_at))::int
      END
    ) STORED;

-- Fast lookup of every call to a given customer (drives the Calls tab on
-- the Calls page client dashboard).
CREATE INDEX IF NOT EXISTS idx_call_logs_customer_phone_started
  ON public.call_logs (customer_phone, started_at DESC)
  WHERE customer_phone IS NOT NULL;

-- Allow agents to read other agents' call logs for the same customer phone.
-- The existing "Agents can view own call logs" policy is too restrictive for
-- the new client-history dashboard, where every agent must see who called
-- this customer before, when, for how long, and with what outcome.
DROP POLICY IF EXISTS "Agents can view own call logs" ON public.call_logs;

CREATE POLICY "Authenticated can view all call logs"
  ON public.call_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);
