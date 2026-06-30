-- ============================================================================
-- Fix orders.returned_at recording (2026-06-23)
-- ============================================================================
-- PROBLEM: returned_at was almost never populated — 20 of 1,299 returned orders
-- have it. Returns are set via BigArena warehouse sync and bulk status changes
-- that only write `status='returned'`, never returned_at. This blinded every
-- reader of the real return time — the Discord /returns report and Insights
-- "returns by date" filter on returned_at, so they were blind to ~98% of returns.
--
-- (No effect on the prediction-segments engine: the new Current Returns list keys
-- off the returned order's created_at + "newest order is a return", not returned_at.)
--
-- FIX (mirrors the cancelled_at fix):
--   1. Backfill returned_at where NULL from the best signal available:
--      the order_history 'returned' event timestamp (only ~20 exist), else
--      updated_at (= the BigArena processing/sync date — the accurate-enough
--      "when the return was recorded"; this lands the bulk-synced returns in the
--      20 May -> now window the operator cares about, where created_at would
--      wrongly show only ~16). created_at is the last-ditch fallback.
--   2. A BEFORE trigger that stamps returned_at = now() whenever a row enters
--      'returned' without one — guarantees the field on EVERY path, current and
--      future, while letting code that sets it explicitly win (NULL-only).
-- ============================================================================

BEGIN;

-- 1. Backfill: only touches rows where returned_at IS NULL.
UPDATE public.orders o
SET returned_at = COALESCE(
  (SELECT max(h.changed_at) FROM public.order_history h
    WHERE h.order_id = o.id AND h.to_status = 'returned'),
  o.updated_at,
  o.created_at
)
WHERE o.status = 'returned' AND o.returned_at IS NULL;

-- 2. Forward guarantee on every writer (BigArena sync, bulk status change, and
--    anything added later).
CREATE OR REPLACE FUNCTION public.orders_set_returned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'returned' AND NEW.returned_at IS NULL THEN
    NEW.returned_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_set_returned_at() IS
'2026-06-23: stamps orders.returned_at = now() whenever a row enters status=returned without one. NULL-only, so explicit code-set values win. Backs the recording fix for the BigArena/bulk paths that only set status.';

DROP TRIGGER IF EXISTS trg_orders_set_returned_at ON public.orders;
CREATE TRIGGER trg_orders_set_returned_at
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_set_returned_at();

COMMIT;
