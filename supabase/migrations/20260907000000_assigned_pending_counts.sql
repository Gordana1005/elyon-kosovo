-- ============================================================================
-- ASSIGNED PENDING COUNTS (2026-07-25)
--
-- Pendings (affiliate/webhook leads) are assigned on orders.assigned_agent_id,
-- a completely separate system from prediction_segment_members — so the
-- Assigner's Unassign tab (fed only by assignment_matrix()) could never show
-- them. This RPC gives the per-agent count of still-pending assigned orders:
-- exactly the rows the mass-unassign may free. take/call_again orders mean the
-- agent already engaged and are kept, mirroring the members is_completed rule.
--
-- Read-side only. No engine SQL, no affiliate objects, no writes.
-- ============================================================================

-- Serves both this aggregate and the status='pending' scoped UPDATE the
-- unassign endpoint runs.
CREATE INDEX IF NOT EXISTS idx_orders_assigned_pending
  ON public.orders (assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL AND status = 'pending';

CREATE OR REPLACE FUNCTION public.assigned_pending_counts()
RETURNS TABLE (
  agent_id uuid,
  pendings int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT assigned_agent_id AS agent_id,
         COUNT(*)::int     AS pendings
  FROM public.orders
  WHERE status = 'pending'
    AND assigned_agent_id IS NOT NULL
  GROUP BY assigned_agent_id;
$$;
COMMENT ON FUNCTION public.assigned_pending_counts() IS
  'Per-agent count of assigned status=pending orders for the assigner unassign panel.';
REVOKE ALL ON FUNCTION public.assigned_pending_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assigned_pending_counts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assigned_pending_counts() TO service_role;
