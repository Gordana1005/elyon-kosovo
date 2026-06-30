-- Deterministic recording↔call linkage (operator bug reports #1 and #4).
--
-- Background: recordings live only on the PBX disk and were matched to calls at
-- READ time by "last-8 phone + nearest timestamp within ±20 min", comparing the
-- recording's mtime (≈ call END) against the call's connected_at (call START).
-- That made any call longer than ~20 min un-matchable (#1) and let recordings
-- swap between two calls to the same number (#4). The recording filename already
-- carries the Asterisk uniqueid — the reliable key — but it was never used.
--
-- This table is the permanent anchor: the PBX hangup hook reports one row per
-- call (keyed by uniqueid) to POST /api/webhook/recording, which links it to the
-- matching call_logs row deterministically and stamps recording_uniqueid /
-- recording_file onto that row. Idempotent on uniqueid → can never swap.
--
-- Retention: audio files are still purged from the PBX after ~30 days (operator
-- decision — no permanent archival). These index rows are tiny and may outlive
-- the audio; Call History shows "recording expired" when a row is past retention
-- and has no playable file.

CREATE TABLE IF NOT EXISTS public.call_recordings (
  uniqueid         text PRIMARY KEY,
  ext              text,
  dialed_last8     text,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_seconds int,
  file             text,
  size             bigint,
  agent_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  call_log_id      uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Matching by (agent, last-8 phone, time-overlap) and reverse lookups.
CREATE INDEX IF NOT EXISTS idx_call_recordings_phone_ended
  ON public.call_recordings (dialed_last8, ended_at DESC)
  WHERE dialed_last8 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_recordings_agent
  ON public.call_recordings (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_recordings_call_log
  ON public.call_recordings (call_log_id) WHERE call_log_id IS NOT NULL;

-- Service-role only (the edge function reads/writes it). No browser access.
ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;

-- The persisted link on the call row. recording_file is what Call History
-- renders; recording_uniqueid is the stable anchor (one recording per call).
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS recording_uniqueid text,
  ADD COLUMN IF NOT EXISTS recording_file     text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_logs_recording_uniqueid
  ON public.call_logs (recording_uniqueid)
  WHERE recording_uniqueid IS NOT NULL;
