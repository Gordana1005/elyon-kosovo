-- Add 'not_satisfied' as an agent-facing cancellation reason (replaces the
-- rarely-used 'duplicate_order' button in the call widget). 'duplicate_order'
-- stays in the allowed set so historical orders that already carry it remain
-- valid and readable.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancellation_reason_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR cancellation_reason IN (
    'no_money', 'changed_mind', 'wrong_product', 'bought_elsewhere',
    'family_refused', 'duplicate_order', 'price_too_high', 'not_satisfied',
    'other', 'pending_cleanup', 'stale_pending_cleanup'
  ));
