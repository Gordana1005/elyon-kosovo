-- Stable "who confirmed this order" attribution.
--
-- Analytics must credit an order to the agent who CONFIRMED it (turned a lead
-- into a real sale) and keep that credit stable forever — even after the
-- superadmin exports the fulfilment CSV and the order flips to 'shipped'.
--
-- Until now the only agent field on an order was assigned_agent_name, which is
-- (a) NULL when an admin/manager confirms during a call, and (b) overwritable
-- by a later (re)assignment. The authoritative "who confirmed" lives in
-- order_history (the earliest row whose to_status='confirmed'). We denormalise
-- it onto the order so insights can group in O(1) without joining history.
--
-- Going forward the API populates these on the first transition into a
-- real-order status (see POST /orders, PATCH /orders/:id/status,
-- bulk-status-update). The status-change paths never overwrite an existing
-- value, so the confirmer stays put through shipped → paid.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmed_by_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by_name text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Backfill every order that is currently a real order. Prefer the earliest
-- confirm event from history; fall back to the assigned agent for the ~14k
-- legacy imports that have no order_history rows.
UPDATE public.orders o SET
  confirmed_by_name = COALESCE(
    (SELECT h.changed_by_name FROM public.order_history h
       WHERE h.order_id = o.id AND h.to_status = 'confirmed'
       ORDER BY h.changed_at ASC LIMIT 1),
    o.assigned_agent_name),
  confirmed_by_agent_id = COALESCE(
    (SELECT h.changed_by FROM public.order_history h
       WHERE h.order_id = o.id AND h.to_status = 'confirmed'
       ORDER BY h.changed_at ASC LIMIT 1),
    o.assigned_agent_id),
  confirmed_at = COALESCE(
    (SELECT h.changed_at FROM public.order_history h
       WHERE h.order_id = o.id AND h.to_status = 'confirmed'
       ORDER BY h.changed_at ASC LIMIT 1),
    o.assigned_at)
WHERE o.status IN ('confirmed', 'shipped', 'delivered', 'paid', 'returned');

-- Support "orders confirmed by X" grouping in analytics; partial so only
-- attributed rows are indexed.
CREATE INDEX IF NOT EXISTS idx_orders_confirmed_by_name
  ON public.orders (confirmed_by_name)
  WHERE confirmed_by_name IS NOT NULL;
