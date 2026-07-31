-- ============================================================================
-- Record orders.shipped_at / orders.paid_at (2026-07-02)
-- ============================================================================
-- WHY: the agent-dashboard "My Orders" worklists need real event times —
-- the Shipped tab shows "shipped N days ago" (payment-chase list) and the
-- Paid tab is windowed by WHEN the order was paid, not when it was created
-- (COD payment lands days/weeks after creation, so a created_at window
-- silently hides orders paid this period but created in an earlier one).
-- No shipped_at/paid_at columns existed; the only event source was
-- order_history, which is awkward to window/paginate against.
--
-- Same design as the cancelled_at (20260711000000) and returned_at
-- (20260713000000) recording fixes: one-time backfill + a NULL-only BEFORE
-- trigger that guarantees the field on every write path.
--
-- DELIBERATE DEVIATION from the cancelled_at backfill: NO updated_at /
-- created_at fallback. ~11.4k legacy imported paid orders (BigArena / Monadon
-- history) have no order_history rows AND no agent attribution; stamping them
-- with an import date would fabricate meaningless event times. NULL = "event
-- time unknown" is the honest value, and every order that can appear in an
-- agent's list (i.e. has confirmed_by/assigned attribution) was verified to
-- have a real history row (176/176 paid, 255 shipped as of 2026-07-02).
--
-- min(changed_at) = FIRST time the order entered the status (same choice as
-- the confirmed_at backfill in 20260522100000); a return→re-ship keeps the
-- original shipped_at. Backfill is NOT restricted to the current status: a
-- now-paid order still gets its historical shipped_at (ship→pay latency).
-- ============================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at    timestamptz;

-- 1. Backfill from order_history ONLY (see header for why no fallback).
UPDATE public.orders o
SET shipped_at = h.first_at
FROM (
  SELECT order_id, min(changed_at) AS first_at
  FROM public.order_history
  WHERE to_status = 'shipped'
  GROUP BY order_id
) h
WHERE h.order_id = o.id AND o.shipped_at IS NULL;

UPDATE public.orders o
SET paid_at = h.first_at
FROM (
  SELECT order_id, min(changed_at) AS first_at
  FROM public.order_history
  WHERE to_status = 'paid'
  GROUP BY order_id
) h
WHERE h.order_id = o.id AND o.paid_at IS NULL;

-- 2. Forward guarantee on every writer (status PATCH, fulfilment CSV flip,
--    BigArena sync, bulk updates, and anything added later). NULL-only:
--    explicit code-set values and the FIRST event win.
CREATE OR REPLACE FUNCTION public.orders_set_shipped_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'shipped' AND NEW.shipped_at IS NULL THEN
    NEW.shipped_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_set_shipped_at() IS
  '2026-07: stamps orders.shipped_at = now() when a row enters status=shipped without one. NULL-only. Backs the agent My Orders payment-chase list.';

DROP TRIGGER IF EXISTS trg_orders_set_shipped_at ON public.orders;
CREATE TRIGGER trg_orders_set_shipped_at
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.orders_set_shipped_at();

CREATE OR REPLACE FUNCTION public.orders_set_paid_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_set_paid_at() IS
  '2026-07: stamps orders.paid_at = now() when a row enters status=paid without one. NULL-only. Windows the My Orders Paid tab.';

DROP TRIGGER IF EXISTS trg_orders_set_paid_at ON public.orders;
CREATE TRIGGER trg_orders_set_paid_at
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.orders_set_paid_at();

-- 3. Indexes for the event-window tabs + the owner filter. orders is ~20k
--    rows so these are cheap; confirmed_by_agent_id had no index at all
--    (only confirmed_by_name, from 20260522100000).
CREATE INDEX IF NOT EXISTS idx_orders_shipped_at
  ON public.orders (shipped_at) WHERE shipped_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_paid_at
  ON public.orders (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_confirmed_by_agent
  ON public.orders (confirmed_by_agent_id) WHERE confirmed_by_agent_id IS NOT NULL;

COMMIT;
