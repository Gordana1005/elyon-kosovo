-- Allow a distinct cancellation reason for the bulk cleanup of stale
-- unassigned pendings (returning-buyer / old import artifacts), so this batch
-- is independently findable and reversible vs the new-customer 'pending_cleanup'
-- batch. The agent-facing reason picker is a separate hardcoded list, so this
-- value won't appear there.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancellation_reason_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR cancellation_reason IN (
    'no_money', 'changed_mind', 'wrong_product', 'bought_elsewhere',
    'family_refused', 'duplicate_order', 'price_too_high', 'other',
    'pending_cleanup', 'stale_pending_cleanup'
  ));
