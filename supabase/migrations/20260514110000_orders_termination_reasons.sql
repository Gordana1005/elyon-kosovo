-- Structured + free-text termination reasons on orders.
--
-- Cancel side is agent-driven from the call outcome picker; populated by the
-- POST /api/call-logs endpoint when outcome='cancelled'. Return side is
-- warehouse-driven and is filled when the OrderModal status dropdown flips
-- the order to 'returned' (current flow stays as is — we just add the
-- columns so the warehouse can capture a structured reason in a future UI
-- iteration).
--
-- Reason text values are constrained to a fixed enum so we can filter and
-- report on them later. *_notes columns capture verbatim what the customer
-- said and stay free-text.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_reason text
    CHECK (cancellation_reason IS NULL OR cancellation_reason IN (
      'no_money',
      'changed_mind',
      'wrong_product',
      'bought_elsewhere',
      'family_refused',
      'duplicate_order',
      'price_too_high',
      'other'
    )),
  ADD COLUMN IF NOT EXISTS cancellation_reason_notes text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reason text
    CHECK (return_reason IS NULL OR return_reason IN (
      'not_picked_up',
      'refused_at_door',
      'undeliverable_address',
      'damaged_in_transit',
      'wrong_item_shipped',
      'changed_mind_after_ship',
      'other'
    )),
  ADD COLUMN IF NOT EXISTS return_reason_notes text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

-- Index to support "show me everyone who cancelled because of price" queries
-- in future analytics; partial so only populated rows are indexed.
CREATE INDEX IF NOT EXISTS idx_orders_cancellation_reason
  ON public.orders (cancellation_reason)
  WHERE cancellation_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_return_reason
  ON public.orders (return_reason)
  WHERE return_reason IS NOT NULL;
