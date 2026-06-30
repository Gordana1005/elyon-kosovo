-- Extend call_logs.outcome to support the richer Calls-page taxonomy:
--
--   ANSWERED                  NOT ANSWERED
--   ─ confirmed               ─ no_answer (existing — retried after 2 days)
--   ─ cancelled               ─ trash (no future contact, reason in notes)
--   ─ call_again              ─ call_again
--
-- Existing values stay (interested / not_interested / wrong_number are still
-- in use by the OrderModal's per-order call-outcome buttons, where the
-- semantics are different from the queue's "did the customer answer"). The
-- reason ("no money", "wrong person", etc.) is appended to call_logs.notes
-- by the agent's outcome picker.

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;

ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_outcome_check
  CHECK (outcome IN (
    -- Existing
    'no_answer', 'interested', 'not_interested', 'wrong_number', 'call_again',
    -- New (Calls-page outcome picker)
    'confirmed', 'cancelled', 'trash'
  ));
