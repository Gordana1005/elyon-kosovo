-- Operator-requested cancellation reason set (2026-06-03). Adds three new
-- agent-facing reasons — 'still_using_product', 'not_interested',
-- 'will_call_back' — to the allowed set. All previously-allowed values are kept
-- so historical orders remain valid and readable; only the agent-facing picker
-- order/labels change (see src/lib/cancellationReasons.ts). Widening a CHECK is
-- safe: no existing row can be rejected.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancellation_reason_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR cancellation_reason IN (
    'no_money', 'changed_mind', 'wrong_product', 'bought_elsewhere',
    'family_refused', 'duplicate_order', 'price_too_high', 'not_satisfied',
    'still_using_product', 'not_interested', 'will_call_back',
    'other', 'pending_cleanup', 'stale_pending_cleanup'
  ));
