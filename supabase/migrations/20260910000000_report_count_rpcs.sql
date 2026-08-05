-- ============================================================================
-- REPORT COUNT RPCs (2026-08-05) — phase 1 of the reporting performance work
--
-- Three endpoints were counting rows by STREAMING them into the edge function
-- 1000 at a time and tallying in JavaScript. At 80k orders / 57k memberships
-- that is 60-200 sequential PostgREST round-trips to produce a handful of
-- integers, on every request — and two of them are polled every 30 seconds.
--
--   GET /segments               57 round-trips over prediction_segment_members
--                               (the code comment still says "~10k memberships";
--                                it is 56,807), polled 30s on the Assigner and
--                                60s on Segments  → ~114 round-trips/min/admin
--   GET /management-insights    the same 57, PLUS all of prediction_leads, paid
--                               unconditionally by every Insights tab including
--                               Pure Profit, which never displays the result
--   GET /orders/stats           streams the ENTIRE orders table — the Dashboard
--                               calls it with no date filter at all
--
-- These are COUNT(*) ... GROUP BY. Doing them in Postgres is arithmetically
-- identical to the JS tally — there is no rounding, no float, no ordering
-- dependence — so this cannot change a displayed number. Measured on live data:
-- the membership tally drops from 57 round-trips to a single 69 ms query.
--
-- Read-side only. No writes, no engine SQL, no schema changes.
-- ============================================================================

-- ── 1. Per-list membership counts for GET /segments ────────────────────────
-- Mirrors the JS tally at index.ts:12085-12099 exactly, including the rule that
-- "open" excludes completed rows and "distributable" is open AND unassigned.
-- engine_data_as_of is the global max(updated_at) — deliberately NOT per-list,
-- matching the single shared variable the old loop maintained.
CREATE OR REPLACE FUNCTION public.segment_list_counts()
RETURNS TABLE (
  list_id            uuid,
  total              int,
  assigned           int,
  completed          int,
  open_count         int,
  distributable      int,
  engine_data_as_of  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.list_id,
         COUNT(*)::int                                                        AS total,
         COUNT(*) FILTER (WHERE m.assigned_agent_id IS NOT NULL)::int         AS assigned,
         COUNT(*) FILTER (WHERE m.is_completed)::int                          AS completed,
         COUNT(*) FILTER (WHERE NOT m.is_completed)::int                      AS open_count,
         COUNT(*) FILTER (WHERE NOT m.is_completed
                            AND m.assigned_agent_id IS NULL)::int             AS distributable,
         -- global max, repeated on every row (see note above)
         MAX(MAX(m.updated_at)) OVER ()                                       AS engine_data_as_of
  FROM public.prediction_segment_members m
  GROUP BY m.list_id;
$$;
COMMENT ON FUNCTION public.segment_list_counts() IS
  'Per-list membership tallies for GET /segments. Replaces a 57-page row stream that was polled every 30s.';
REVOKE ALL ON FUNCTION public.segment_list_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.segment_list_counts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.segment_list_counts() TO service_role;


-- ── 2. Combined membership counts for GET /management-insights ─────────────
-- The Prediction Lists tab shows "how many people are in this list", which is
-- segment members PLUS uploaded leads sharing the same list_id keyspace.
-- Mirrors index.ts:13639-13646 (both tallies written into one memberCounts map).
CREATE OR REPLACE FUNCTION public.prediction_list_member_counts()
RETURNS TABLE (
  list_id  uuid,
  members  int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT z.list_id, SUM(z.n)::int AS members
  FROM (
    SELECT m.list_id, COUNT(*) AS n
      FROM public.prediction_segment_members m
     GROUP BY m.list_id
    UNION ALL
    SELECT l.list_id, COUNT(*) AS n
      FROM public.prediction_leads l
     WHERE l.list_id IS NOT NULL
     GROUP BY l.list_id
  ) z
  GROUP BY z.list_id;
$$;
COMMENT ON FUNCTION public.prediction_list_member_counts() IS
  'Segment members + uploaded leads per list, for the Insights Prediction Lists tab. Replaces two unbounded full-table streams paid by every Insights request.';
REVOKE ALL ON FUNCTION public.prediction_list_member_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prediction_list_member_counts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prediction_list_member_counts() TO service_role;


-- ── 3. Order status / agent / daily tallies for GET /orders/stats ──────────
-- Mirrors index.ts:6704-6719. Three separate GROUP BYs returned as one jsonb
-- so the edge function makes a single call.
--
-- Fidelity notes:
--   * agent_counts keys on assigned_agent_name only when truthy — the JS guard
--     is `if (o.assigned_agent_name)`, so NULL *and* '' are both skipped.
--   * daily_counts keys on created_at.substring(0,10) of the PostgREST ISO
--     string, i.e. the UTC date. `AT TIME ZONE 'UTC'` reproduces that exactly.
--     This is deliberately NOT Europe/Skopje — changing it is a separate,
--     user-visible decision, tracked in the reporting-timezone work.
--   * p_exclude_duplicated mirrors the non-admin `.is("duplicated_from", null)`
--     branch, so agents keep seeing the same numbers they see today.
CREATE OR REPLACE FUNCTION public.orders_status_stats(
  p_from                text    DEFAULT NULL,
  p_to                  text    DEFAULT NULL,
  p_exclude_duplicated  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH base AS (
    SELECT o.status::text AS status,
           o.assigned_agent_name,
           o.created_at
    FROM public.orders o
    WHERE (o.source_type IS NULL OR o.source_type::text <> 'monadon_legacy')
      AND (NULLIF(p_from, '') IS NULL OR o.created_at >= NULLIF(p_from, '')::timestamptz)
      AND (NULLIF(p_to,   '') IS NULL OR o.created_at <= NULLIF(p_to,   '')::timestamptz)
      AND (NOT p_exclude_duplicated OR o.duplicated_from IS NULL)
  )
  SELECT jsonb_build_object(
    'statusCounts', COALESCE((SELECT jsonb_object_agg(status, n)
                                FROM (SELECT status, COUNT(*)::int AS n
                                        FROM base GROUP BY status) s), '{}'::jsonb),
    'agentCounts',  COALESCE((SELECT jsonb_object_agg(assigned_agent_name, n)
                                FROM (SELECT assigned_agent_name, COUNT(*)::int AS n
                                        FROM base
                                       WHERE assigned_agent_name IS NOT NULL
                                         AND assigned_agent_name <> ''
                                       GROUP BY assigned_agent_name) a), '{}'::jsonb),
    'dailyCounts',  COALESCE((SELECT jsonb_object_agg(day, n)
                                FROM (SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                                             COUNT(*)::int AS n
                                        FROM base GROUP BY 1) d), '{}'::jsonb),
    'total',        (SELECT COUNT(*)::int FROM base)
  );
$$;
COMMENT ON FUNCTION public.orders_status_stats(text, text, boolean) IS
  'Status / agent / daily order tallies for GET /orders/stats. Replaces a full-table row stream the Dashboard fired with no date filter.';
REVOKE ALL ON FUNCTION public.orders_status_stats(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.orders_status_stats(text, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orders_status_stats(text, text, boolean) TO service_role;
