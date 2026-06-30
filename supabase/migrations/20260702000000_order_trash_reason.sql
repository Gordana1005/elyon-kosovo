-- ============================================================================
-- Structured trash reason for orders (2026-06-18)
-- ============================================================================
-- WHY: trashed orders never carried a real reason. The agent picks one in the
-- "Choose Answer" trash form (wrong_number / wrong_person / rude /
-- uncooperative / other), but it was either dropped entirely (the pending-order
-- trash path called apiUpdateOrderStatus with no reason) or only loosely
-- written into free-text `notes` (the synthetic path) — and the order-create
-- endpoint hard-nulls cancellation_reason for any non-cancelled row. So the
-- Orders list had nothing to show and fell back to the placeholder
-- product_name "No prior product on file".
--
-- We add a DEDICATED, NULLABLE column rather than reuse cancellation_reason:
--   • cancellation_reason has an operator-curated CHECK set + a dedicated index
--     + cancel analytics that aggregate it; trash values would pollute all of
--     those and the cancel reason picker domain.
--   • A new nullable column is inert to every existing consumer (nothing reads
--     it yet) and the prediction engine routes on status/dates, never on a
--     reason column — so this cannot change segment membership or any insight.
--
-- Additive only: nullable, no default, no backfill. Existing rows are
-- untouched and every existing query keeps working. Idempotent.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS trash_reason text,
  ADD COLUMN IF NOT EXISTS trash_reason_notes text;

-- 'not_reachable' is reserved for the server-side 5-no-answer auto-trash; the
-- other five mirror the agent-facing picker keys in ChooseAnswerButton.tsx.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_trash_reason_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_trash_reason_check
  CHECK (trash_reason IS NULL OR trash_reason IN (
    'wrong_number', 'wrong_person', 'rude', 'uncooperative', 'other', 'not_reachable'
  ));

-- Matches the (small) trashed-with-reason slice only; mirrors the cancellation
-- reason index so any future "trash reasons breakdown" stays cheap.
CREATE INDEX IF NOT EXISTS idx_orders_trash_reason
  ON public.orders (trash_reason)
  WHERE trash_reason IS NOT NULL;
