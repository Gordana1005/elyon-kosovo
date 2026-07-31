-- ============================================================================
-- ASSIGNMENT MATRIX (2026-07-22)
--
-- Backs the Assigner's new "Unassign" tab: one click frees every NOT-yet-called
-- prediction-list client from a chosen agent (or from all agents at once),
-- instead of walking every agent × every list by hand.
--
-- 1) assignment_matrix() — per (agent, list) assigned/open member counts in one
--    aggregate. Also replaces the inspector's old per-list probe loop, which
--    fired one GET /segments/:id per active list just to discover which lists an
--    agent has assignments in.
-- 2) Supporting composite index — serves both the matrix and the scoped UPDATE
--    the unassign endpoint runs.
--
-- Read-side only. No engine SQL, no membership writes.
-- ============================================================================

-- (2) Per-agent-per-list lookups + the (agent_id, list_id) filtered UPDATE.
CREATE INDEX IF NOT EXISTS idx_segment_members_agent_list
  ON public.prediction_segment_members (assigned_agent_id, list_id)
  WHERE assigned_agent_id IS NOT NULL;

-- (1) Who holds what, per list. members_open = not-done = the real workload,
--     and exactly the rows the mass-unassign frees (done rows keep their agent
--     stamp so the who-called-whom record survives).
CREATE OR REPLACE FUNCTION public.assignment_matrix()
RETURNS TABLE (
  agent_id         uuid,
  list_id          uuid,
  members_assigned int,
  members_open     int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT assigned_agent_id                                  AS agent_id,
         list_id,
         COUNT(*)::int                                      AS members_assigned,
         COUNT(*) FILTER (WHERE NOT is_completed)::int      AS members_open
  FROM public.prediction_segment_members
  WHERE assigned_agent_id IS NOT NULL
  GROUP BY assigned_agent_id, list_id;
$$;
COMMENT ON FUNCTION public.assignment_matrix() IS
  'Per (agent, list) prediction-member counts for the assigner unassign panel and the agent inspector.';
REVOKE ALL ON FUNCTION public.assignment_matrix() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assignment_matrix() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_matrix() TO service_role;
