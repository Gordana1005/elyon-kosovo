-- Call-again cooldown for real (pending) orders.
-- ============================================================================
-- A no-answer should park a customer for ~1 day instead of letting their
-- pending order be re-served within seconds. We add a per-order "next callable"
-- timestamp; the Calls page calling-bucket skips orders whose next_call_after is
-- still in the future. NULL = callable now (default / existing rows).
--
-- (Prediction re-marketing customers are parked via prediction_segment_members
-- .in_call_again_until, which already exists. The 5-consecutive-no-answer
-- auto-trash is enforced in the POST /call-logs edge function — no schema needed
-- because the streak is counted from call_logs.)
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS next_call_after TIMESTAMPTZ;

-- Supports the calling-bucket query: workable statuses that are callable now.
CREATE INDEX IF NOT EXISTS idx_orders_workable_callable
  ON public.orders (status, next_call_after)
  WHERE status IN ('pending', 'call_again');
