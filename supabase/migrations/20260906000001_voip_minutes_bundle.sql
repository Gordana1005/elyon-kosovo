-- ============================================================================
-- A1 minutes bundle tracking (2026-07-27)
--
-- Context: A1 raised our Business Voice trunk from 10 to 25 concurrent lines and
-- the monthly bundle from 5,000 to 20,000 minutes. We had NO quota tracking at
-- all — the Minutes tab only showed raw usage — so nobody could see the bundle
-- being consumed. Silently blowing through the allowance is the leading theory
-- for the two full outbound bars on 2026-07-02 and 2026-07-08 (instant 200 OK +
-- Bulgarian "service terminated" announcement, inbound unaffected), so this is a
-- safety feature, not just a dashboard nicety.
--
-- Two pieces:
--   1. voip_minutes_cycle_usage() — a set-returning aggregate so the edge
--      function never has to stream call_logs to sum them. The old code did
--      `.limit(20000)`, which PostgREST silently truncates to db-max-rows (1000)
--      — at ~1,000 calls/day every VOIP minute figure was under-reported.
--   2. app_settings.voip_minutes_bundle — the commercial terms, operator-tunable
--      because A1 changes them on their schedule, not our release cycle.
-- ============================================================================

BEGIN;

-- Per-day talk/total seconds over an arbitrary window. Aggregating in PG keeps
-- the response tiny (one row per day) and immune to the 1000-row cap. Per-day
-- rather than a single total because the projection is weekday-aware: weekends
-- run ~1 concurrent call against 5-6 on weekdays, so a flat used/elapsed
-- forecast is badly biased depending on where in the cycle you are.
CREATE OR REPLACE FUNCTION public.voip_minutes_cycle_usage(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (day date, talk_seconds bigint, total_seconds bigint, calls bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (created_at AT TIME ZONE 'Europe/Skopje')::date AS day,
         COALESCE(SUM(talk_seconds), 0)::bigint,
         COALESCE(SUM(total_seconds), 0)::bigint,
         COUNT(*)::bigint
  FROM public.call_logs
  WHERE created_at >= p_start AND created_at < p_end
  GROUP BY 1
  ORDER BY 1;
$$;

-- Superadmin-facing data (the VOIP Health page is admin-only) and the edge
-- function calls it with the service role. No broad grants.
REVOKE ALL ON FUNCTION public.voip_minutes_cycle_usage(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voip_minutes_cycle_usage(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.voip_minutes_cycle_usage(timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.voip_minutes_cycle_usage(timestamptz, timestamptz) IS
'Per-day talk/total seconds from call_logs over [p_start, p_end). Feeds the A1 bundle gauge on VOIP Health → Minutes. Days are bucketed in Europe/Skopje to match the billing cycle.';

-- Keeps the cycle scan an index range rather than a seq scan as call_logs grows.
CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON public.call_logs (created_at);

-- ── Bundle terms ────────────────────────────────────────────────────────────
-- MACEDONIA: telephony is deferred (Phase 2) and there is NO carrier contract
-- yet. Upstream seeds A1-Bulgaria's terms here (20,000 min, reset on the 1st);
-- carrying those over would put another market's contract into this database
-- where it would later be read as truth. Seeded at 0 instead — the gauge simply
-- reports "no bundle configured" until a real MK carrier is signed, then set it
-- from Settings → Telephony.
-- metric 'talk'          : carriers bill answered time. total_seconds includes
--                          ring time and will always read higher than an invoice.
INSERT INTO public.app_settings (key, value)
VALUES ('voip_minutes_bundle', jsonb_build_object(
  'included_minutes', 0,
  'billing_day', 1,
  'metric', 'talk',
  'warn_pct', 80,
  'critical_pct', 95
))
ON CONFLICT (key) DO NOTHING;

COMMIT;
