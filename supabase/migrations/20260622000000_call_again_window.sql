-- Call-Again 3-day window.
-- ============================================================================
-- A no-answer now (a) marks the EXISTING order as 'call_again' (the operator
-- needs to see "this was already called" — no second order is ever created),
-- and (b) opens a 3-day Call-Again window during which the client is callable
-- repeatedly. Between auto-dial attempts a short cooldown (next_call_after /
-- in_call_again_until) skips the client for a few hours, then it resurfaces.
--
-- call_again_since = the FIRST no-answer that opened the window. It is anchored
-- (never reset on subsequent no-answers), so the 3-day clock is fixed from
-- entry. NULL = not in a Call-Again window.
--
-- Expiry is lazy (this project has no pg_cron — same pattern as
-- escalate_expired_personal_list_holds): the Call-Again endpoint calls
-- expire_call_again_window() on read. After 3 days a still-call_again order
-- reverts to 'pending' (back to the normal/prediction calling list) and the
-- prediction member's window clears.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS call_again_since TIMESTAMPTZ;

ALTER TABLE public.prediction_segment_members
  ADD COLUMN IF NOT EXISTS call_again_since TIMESTAMPTZ;

-- Drives Source B of the Call-Again queue (orders currently in the window).
CREATE INDEX IF NOT EXISTS idx_orders_call_again_since
  ON public.orders (call_again_since)
  WHERE status = 'call_again';

-- Lazy expiry: reverts everything whose 3-day window has elapsed. Idempotent.
CREATE OR REPLACE FUNCTION public.expire_call_again_window()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Orders: still 'call_again' after 3 days → back to the normal calling list.
  UPDATE public.orders
     SET status = 'pending',
         call_again_since = NULL,
         next_call_after = NULL
   WHERE status = 'call_again'
     AND call_again_since IS NOT NULL
     AND call_again_since < now() - interval '3 days';

  -- Prediction members: window elapsed → drop the Call-Again marker so they
  -- return to their prediction queue (is_completed stays false = still workable).
  UPDATE public.prediction_segment_members
     SET call_again_since = NULL,
         in_call_again_until = NULL
   WHERE call_again_since IS NOT NULL
     AND call_again_since < now() - interval '3 days'
     AND is_completed = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_call_again_window() TO authenticated;
