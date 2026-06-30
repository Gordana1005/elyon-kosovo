-- Call History "Result" filter fix.
--
-- The Call History page shows a single "Result" per call that MERGES the call's
-- own outcome with the linked order/lead status (the order status wins once the
-- order reaches a resolved state). See getResult() in
-- src/pages/CallHistoryPage.tsx. The server filter, however, only matched the
-- raw call_logs.outcome column, so filtering "Confirmed" / "Cancelled" hid every
-- row whose displayed result came from the ORDER status rather than the outcome
-- (the operator's bug report #2 and #3).
--
-- This view computes the SAME canonical `result` the UI shows, so the API can
-- filter on it directly and "what you filter == what you see". The CASE below is
-- the single source of truth and mirrors getResult precedence exactly:
--   1. no_answer wins over everything
--   2. a resolved order/lead status wins over the call outcome
--   3. otherwise the call outcome, consolidated
--
-- Read with a service-role client only (the edge function). Not granted to
-- anon/authenticated — it is never queried directly from the browser.

CREATE OR REPLACE VIEW public.call_logs_with_result AS
SELECT
  cl.*,
  COALESCE(o.status::text, pl.status::text) AS effective_status,
  CASE
    -- (1) the call wasn't answered — wins over any later order status
    WHEN cl.outcome = 'no_answer' THEN 'no_answer'
    -- (2) the order/lead reached a resolved state — that IS the result
    WHEN COALESCE(o.status::text, pl.status::text) = 'confirmed' THEN 'confirmed'
    WHEN COALESCE(o.status::text, pl.status::text) = 'cancelled' THEN 'cancelled'
    WHEN COALESCE(o.status::text, pl.status::text) = 'trashed'   THEN 'trash'
    WHEN COALESCE(o.status::text, pl.status::text) = 'shipped'   THEN 'shipped'
    WHEN COALESCE(o.status::text, pl.status::text) = 'delivered' THEN 'delivered'
    WHEN COALESCE(o.status::text, pl.status::text) = 'paid'      THEN 'paid'
    WHEN COALESCE(o.status::text, pl.status::text) = 'returned'  THEN 'returned'
    -- (3) otherwise the consolidated call outcome
    WHEN cl.outcome = 'confirmed'                      THEN 'confirmed'
    WHEN cl.outcome IN ('cancelled', 'not_interested') THEN 'cancelled'
    WHEN cl.outcome IN ('trash', 'wrong_number')       THEN 'trash'
    WHEN cl.outcome = 'call_again'                      THEN 'call_again'
    WHEN cl.outcome IN ('answered', 'interested')      THEN 'answered'
    ELSE 'unknown'
  END AS result
FROM public.call_logs cl
LEFT JOIN public.orders o
  ON cl.context_type = 'order' AND o.id = cl.context_id
LEFT JOIN public.prediction_leads pl
  ON cl.context_type = 'prediction_lead' AND pl.id = cl.context_id;

-- Service role bypasses RLS; the underlying call_logs RLS still applies to any
-- non-service caller. Keep the view off the public PostgREST surface.
REVOKE ALL ON public.call_logs_with_result FROM anon, authenticated;
GRANT SELECT ON public.call_logs_with_result TO service_role;
