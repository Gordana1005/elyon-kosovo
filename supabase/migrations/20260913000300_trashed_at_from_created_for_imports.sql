-- ============================================================================
-- orders.trashed_at — correct the backfill for bulk-imported orders (2026-08-06)
-- ============================================================================
-- 20260913000100 backfilled trashed_at as:
--     COALESCE(max(order_history.changed_at where to_status='trashed'),
--              updated_at,
--              created_at)
-- That chain is right for a CRM-worked order, and WRONG for Macedonia's
-- historical book. All 17.714 trashed orders here came from the AlterCPA import
-- and have ZERO order_history rows, so every one of them fell through to
-- `updated_at` — which for an imported row is the import timestamp, not when the
-- order was junked. The result: 17.714 orders all stamped within the same
-- two-hour window on 2026-08-05.
--
-- WHY THAT MATTERS (it is not cosmetic). Engine v3.7-mk releases a trashed
-- customer when they have a PAID order dated AFTER the trash. With trashed_at
-- pinned to the import instant, every historical payment sorts BEFORE every
-- trash, so the release could never fire and the 2.391 customers who genuinely
-- paid us after being trashed would have been deleted from re-marketing anyway
-- — silently reversing the operator's decision. The 21-day not_reachable park
-- would likewise have restarted from the import date for everyone.
--
-- THE TRUTHFUL VALUE for these rows is the order's own created_at: AlterCPA
-- records one date per order, and the disposition (phase 5 = trashed) belongs to
-- that same record. It is the best evidence that exists.
--
-- Scope: rows with NO 'trashed' order_history event — i.e. exactly the ones the
-- previous migration had to guess at. Anything the CRM actually worked keeps its
-- real history-derived timestamp.
-- ============================================================================

BEGIN;

UPDATE public.orders o
SET trashed_at = o.created_at
WHERE o.status = 'trashed'
  AND o.trashed_at IS DISTINCT FROM o.created_at
  AND NOT EXISTS (
    SELECT 1 FROM public.order_history h
    WHERE h.order_id = o.id AND h.to_status = 'trashed'
  );

COMMIT;
