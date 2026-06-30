-- One-time cleanup: remove the duplicate €0 "stub" orders the Calls page used to
-- auto-create on every no-answer / call-again to a customer with no linked order.
-- ============================================================================
-- These stubs (status take/call_again, price 0, no line items, internally
-- created) caused the "multiple Takes / multiple Call-Agains for one customer"
-- symptom and dragged down the conversion denominator (take/call_again count as
-- "taken" but trashed/cancelled don't). The app no longer creates them — the
-- no-answer/call-again lifecycle is now owned server-side (POST /call-logs:
-- 1-day hold + 5-consecutive auto-trash) with no stub orders.
--
-- Dry-run (2026-06-21) matched 46 rows across 33 customers, every one of which
-- has at least one OTHER real order — so the guard below never deletes a
-- customer's only order. Each delete fires the recompute trigger, reclassifying
-- the phone cleanly. Idempotent: re-running deletes 0 rows.
-- ============================================================================

DELETE FROM public.orders o
WHERE o.status IN ('take', 'call_again')
  AND COALESCE(o.price, 0) = 0
  AND o.external_order_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
  )
  AND right(regexp_replace(COALESCE(o.customer_phone, ''), '\D', '', 'g'), 8) <> ''
  AND EXISTS (
    SELECT 1 FROM public.orders o2
    WHERE o2.id <> o.id
      AND right(regexp_replace(COALESCE(o2.customer_phone, ''), '\D', '', 'g'), 8)
        = right(regexp_replace(COALESCE(o.customer_phone, ''), '\D', '', 'g'), 8)
  );
