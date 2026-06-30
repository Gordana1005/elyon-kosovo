-- Retire call_logs_with_result.
--
-- The view (added in 20260710000000) merged call outcome + order status into one
-- "result" for filtering. We changed the Call History design: order-status
-- results (Confirmed/Cancelled/Paid/…) are now ORDER-driven (one row per order in
-- that status, complete parity with the Orders page), and call-outcome results
-- (No Answer/Answered/Call Again) filter call_logs.outcome directly. Nothing reads
-- the view anymore, and its merge semantics (order status overriding the call)
-- are misleading, so drop it.
DROP VIEW IF EXISTS public.call_logs_with_result;
