-- Add the neutral 'answered' outcome to call_logs.
--
-- Background: the VOIP layer used to silently log every answered-but-undecided
-- call as 'interested', which polluted Call History (you could never tell what
-- a call actually turned into). We now log such calls as 'answered' — a neutral
-- "they picked up, no order decision was made" state. The real result
-- (Confirmed / Cancelled / Trash) is derived from the order's own status, and
-- the call row is re-tagged when the agent resolves the order (see the merge in
-- POST /api/call-logs).
--
-- This is PURELY ADDITIVE: every existing value is kept so historical rows and
-- the OrderModal's per-order outcome buttons (interested / not_interested /
-- wrong_number / call_again) keep working unchanged.

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;

ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_outcome_check
  CHECK (outcome IN (
    -- Existing
    'no_answer', 'interested', 'not_interested', 'wrong_number', 'call_again',
    'confirmed', 'cancelled', 'trash',
    -- New: neutral "answered, no decision yet"
    'answered'
  ));
