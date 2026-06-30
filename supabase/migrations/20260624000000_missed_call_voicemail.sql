-- ============================================================
-- Missed-call voicemail: capture the message the caller leaves
-- ============================================================
-- Inbound calls now answer + play a greeting + record a message (Asterisk
-- Record() in the [elyon-missed-call] dialplan). The recording is written to the
-- PBX monitor dir (/var/spool/asterisk/monitor/YYYY/MM/DD/vm-<uniqueid>.wav) and
-- served via the existing elyon-rec.php signed-URL service. When a real message
-- is left, the PBX posts the file path here (POST /api/webhook/missed-call-vm),
-- which stamps these columns onto the matching missed_calls row (by uniqueid).

ALTER TABLE public.missed_calls
  ADD COLUMN IF NOT EXISTS voicemail_file    TEXT,   -- YYYY/MM/DD/vm-<uniqueid>.wav (under monitor dir)
  ADD COLUMN IF NOT EXISTS voicemail_seconds INT;    -- approx message length

COMMENT ON COLUMN public.missed_calls.voicemail_file IS
  'Relative path (YYYY/MM/DD/vm-<uniqueid>.wav) of the caller''s recorded message under the PBX monitor dir; streamed via elyon-rec.php signed URLs. NULL = caller left no message.';
