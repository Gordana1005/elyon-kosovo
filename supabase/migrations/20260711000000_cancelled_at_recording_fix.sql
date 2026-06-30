-- ============================================================================
-- Fix orders.cancelled_at recording (2026-06-23)
-- ============================================================================
-- PROBLEM: cancelled_at was almost never populated. Of cancels created in the
-- last 30 days only 17/1347 had it; last 7 days 2/991. Root cause: the bulk of
-- cancellations are "synthetic cancelled records" created straight as
-- status='cancelled' from the Calls page (POST /orders), and several status-sync
-- paths (BigArena warehouse sync, lead->order status sync) only set `status` —
-- none of them wrote cancelled_at. (A one-time backfill on 2026-05-21 stamped
-- 1,479 pre-existing cancels with that single date; those are old, history-less,
-- and left untouched here.)
--
-- This had no effect on the prediction-segments engine (it keys off the cancelled
-- order's created_at, never cancelled_at), but it broke anything that reads the
-- real cancellation time — e.g. the Discord cancellations report filters
-- `status='cancelled' AND cancelled_at BETWEEN ...`, so it was blind to ~99% of
-- cancels.
--
-- FIX (two parts):
--   1. Backfill cancelled_at where NULL from the most accurate source available —
--      the order_history 'cancelled' event timestamp — falling back to updated_at
--      then created_at. 1,337 of 1,350 NULL cancels have a history row; the median
--      history-vs-created gap is 0 days (synthetic records are created AS cancelled).
--   2. A BEFORE trigger that stamps cancelled_at = now() whenever a row enters
--      'cancelled' without one. This guarantees the field on EVERY path — current
--      and future — while letting code that sets it explicitly win (NULL-only).
-- ============================================================================

BEGIN;

-- 1. Backfill: only touches rows where cancelled_at IS NULL, so the 2026-05-21
--    bulk values (non-NULL, unrecoverable) are preserved as-is.
UPDATE public.orders o
SET cancelled_at = COALESCE(
  (SELECT max(h.changed_at) FROM public.order_history h
    WHERE h.order_id = o.id AND h.to_status = 'cancelled'),
  o.updated_at,
  o.created_at
)
WHERE o.status = 'cancelled' AND o.cancelled_at IS NULL;

-- 2. Forward guarantee on every writer (synthetic-cancel creation, status PATCH,
--    BigArena sync, lead-status sync, and anything added later).
CREATE OR REPLACE FUNCTION public.orders_set_cancelled_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_set_cancelled_at() IS
'2026-06-23: stamps orders.cancelled_at = now() whenever a row enters status=cancelled without one. NULL-only, so explicit code-set values win. Backs the recording fix for the call-outcome/sync paths that only set status.';

DROP TRIGGER IF EXISTS trg_orders_set_cancelled_at ON public.orders;
CREATE TRIGGER trg_orders_set_cancelled_at
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_set_cancelled_at();

COMMIT;
