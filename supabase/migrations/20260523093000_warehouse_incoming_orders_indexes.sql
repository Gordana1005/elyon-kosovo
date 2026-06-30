-- Performance indexes for the warehouse Incoming Orders flow (and related views).
--
-- The GET /warehouse/incoming-orders handler (supabase/functions/api/index.ts:4832)
-- and the three tabs in WarehousePage.tsx (IncomingOrdersTab, DelayedOrdersTab,
-- ShipmentCalendarTab) repeatedly run filtered queries against orders + order_items
-- (and prediction_leads + prediction_lead_items for unconverted confirmed leads).
--
-- Hot predicates (as of 2026-05):
--   - status = 'confirmed' or status IN ('confirmed','shipped','delivered','paid')
--   - created_at BETWEEN from AND to (90-day default window, explicit ranges, or "All")
--   - assigned_agent_id = ?
--   - source_lead_id IS NULL / NOT NULL
--   - ORDER BY created_at DESC
--   - Client-side post-filter / group on ship_after_date for Delayed + Calendar
--
-- Existing single-column indexes (status, created_at, assigned_agent_id, source_lead_id partial)
-- were not sufficient for the composite filters + range + ORDER that the warehouse
-- tab exercises on every filter change and after every status/bulk action.
--
-- These composite + partial indexes target exactly the warehouse access pattern.
-- Partial indexes on the "incoming/ready" statuses keep the indexes small and fast
-- for the daily warehouse use-case while still covering the broader status range when needed.
--
-- Safe: all use IF NOT EXISTS. Non-blocking in practice on Supabase (index builds
-- are online for most workloads). Run `npx supabase db push --linked` (or via Studio)
-- after this lands. Rebuild can take seconds to a couple of minutes on the ~14k+
-- orders table depending on load.
--
-- Part of the Phase 1 lowest-risk performance fix (see research summary).

-- Primary composite for the most common warehouse query shape
-- (status filter + created_at range + ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON public.orders (status, created_at DESC);

-- Helps the agent-filtered path in the warehouse handler + Assigner inspector.
CREATE INDEX IF NOT EXISTS idx_orders_status_agent_created_at
  ON public.orders (status, assigned_agent_id, created_at DESC);

-- Supports Delayed Orders + Shipment Calendar (ship_after_date is selected and
-- heavily used for grouping/filtering in the UI even if the backend window is on created_at).
CREATE INDEX IF NOT EXISTS idx_orders_status_ship_after
  ON public.orders (status, ship_after_date);

-- Partial indexes scoped only to the "ready for warehouse" statuses.
-- These are the exact rows the Incoming Orders tab cares about 99% of the time.
-- Smaller, faster to maintain, perfect cache behavior for daily ops.
CREATE INDEX IF NOT EXISTS idx_orders_incoming_status_created_at
  ON public.orders (status, created_at DESC)
  WHERE status IN ('confirmed', 'shipped', 'delivered', 'paid');

CREATE INDEX IF NOT EXISTS idx_orders_incoming_status_agent_created
  ON public.orders (status, assigned_agent_id, created_at DESC)
  WHERE status IN ('confirmed', 'shipped', 'delivered', 'paid');

CREATE INDEX IF NOT EXISTS idx_orders_incoming_status_ship_after
  ON public.orders (status, ship_after_date)
  WHERE status IN ('confirmed', 'shipped', 'delivered', 'paid');

-- Also help the prediction_leads branch inside the same warehouse handler
-- (confirmed leads without a linked order yet).
CREATE INDEX IF NOT EXISTS idx_prediction_leads_status_created_at
  ON public.prediction_leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_leads_status_agent_created
  ON public.prediction_leads (status, assigned_agent_id, created_at DESC)
  WHERE status = 'confirmed';

-- Note on source_lead_id: the handler already has a partial index from earlier
-- migrations (idx_orders_source_lead_id). The new composites above will be used
-- together with it by the planner for the source filter branches.
