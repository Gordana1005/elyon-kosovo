-- ============================================================================
-- ASSIGNER TRUTH + WORKLOADS (2026-07-07)
--
-- 1) bulk_last_calls(p8s)  — latest REAL call per last-8 phone from call_logs.
--    Read-time truth for the segment member "Last call" column: member rows are
--    only stamped by the queue/no-answer paths, so calls made via the order-
--    confirmation flow or standalone dialing showed "never". NO member-row
--    backfill — display truth is resolved at read time.
-- 2) agent_workloads()     — one aggregate for the /assigner agents panel:
--    open orders + prediction-member loads per agent. Replaces an unbounded
--    per-request orders select that risked the PostgREST 1000-row cap.
-- 3) Supporting indexes.
-- 4) One-time resync of stale denormalized assigned_agent_name (training
--    accounts were renamed in profiles but member rows kept the old names).
--
-- Engine v3.4 / v4 shadow SQL untouched. Read-side only + one idempotent
-- name sync.
-- ============================================================================

-- (3a) Expression index: last-8 digits of call_logs.customer_phone + recency.
--      Expressions MUST textually match the ones used in bulk_last_calls.
CREATE INDEX IF NOT EXISTS idx_call_logs_phone8_recency
  ON public.call_logs (
    (right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8)),
    (COALESCE(started_at, created_at)) DESC
  )
  WHERE customer_phone IS NOT NULL;

-- (3b) Cheap per-agent load lookups on the members table (polled every 15s).
CREATE INDEX IF NOT EXISTS idx_segment_members_assigned_agent
  ON public.prediction_segment_members (assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;

-- (1) Latest call per last-8 phone. DISTINCT ON + the expression index above.
CREATE OR REPLACE FUNCTION public.bulk_last_calls(p8s text[])
RETURNS TABLE (
  phone8            text,
  last_call_at      timestamptz,
  outcome           text,
  connection_state  text,
  agent_id          uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8))
         right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8) AS phone8,
         COALESCE(started_at, created_at)                                      AS last_call_at,
         outcome,
         connection_state,
         agent_id
  FROM public.call_logs
  WHERE customer_phone IS NOT NULL
    AND right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8) = ANY(p8s)
  ORDER BY right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8),
           COALESCE(started_at, created_at) DESC;
$$;
COMMENT ON FUNCTION public.bulk_last_calls(text[]) IS
  'Latest call_logs row per last-8-digit phone. Read-time truth for the assigner/segment "Last call" column.';
REVOKE ALL ON FUNCTION public.bulk_last_calls(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_last_calls(text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_last_calls(text[]) TO service_role;

-- (2) Per-agent workloads: open orders + prediction member loads, one shot.
--     orders_open semantics identical to the previous inline tally
--     (status IN pending|take|call_again, assigned_agent_id set).
CREATE OR REPLACE FUNCTION public.agent_workloads()
RETURNS TABLE (
  agent_id         uuid,
  orders_open      int,
  members_assigned int,
  members_open     int,
  members_parked   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH o AS (
    SELECT assigned_agent_id AS aid, COUNT(*)::int AS orders_open
    FROM public.orders
    WHERE assigned_agent_id IS NOT NULL
      AND status IN ('pending', 'take', 'call_again')
    GROUP BY 1
  ),
  m AS (
    SELECT assigned_agent_id AS aid,
           COUNT(*)::int                                            AS members_assigned,
           COUNT(*) FILTER (WHERE NOT is_completed)::int            AS members_open,
           COUNT(*) FILTER (WHERE NOT is_completed
                              AND in_call_again_until IS NOT NULL
                              AND in_call_again_until > now())::int AS members_parked
    FROM public.prediction_segment_members
    WHERE assigned_agent_id IS NOT NULL
    GROUP BY 1
  )
  SELECT COALESCE(o.aid, m.aid) AS agent_id,
         COALESCE(o.orders_open, 0),
         COALESCE(m.members_assigned, 0),
         COALESCE(m.members_open, 0),
         COALESCE(m.members_parked, 0)
  FROM o FULL OUTER JOIN m ON m.aid = o.aid;
$$;
COMMENT ON FUNCTION public.agent_workloads() IS
  'Per-agent open orders (pending/take/call_again) + prediction-member loads for the assigner agents panel.';
REVOKE ALL ON FUNCTION public.agent_workloads() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_workloads() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_workloads() TO service_role;

-- (4) One-time denormalized-name resync (idempotent).
--     Member rows are live work queues — always reflect the current profile
--     name. Orders: OPEN statuses only; closed orders keep the historical
--     display name (renamed training accounts must not re-label past work).
UPDATE public.prediction_segment_members m
SET    assigned_agent_name = p.full_name
FROM   public.profiles p
WHERE  m.assigned_agent_id = p.user_id
  AND  m.assigned_agent_name IS DISTINCT FROM p.full_name;

UPDATE public.orders o
SET    assigned_agent_name = p.full_name
FROM   public.profiles p
WHERE  o.assigned_agent_id = p.user_id
  AND  o.status IN ('pending', 'take', 'call_again')
  AND  o.assigned_agent_name IS DISTINCT FROM p.full_name;
