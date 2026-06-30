-- Fix stuck "Take" orders.
-- ============================================================================
-- "Take" means: the agent is CURRENTLY viewing this customer on the Calls page.
-- An agent views one customer at a time, so they should hold takes for at most
-- that one customer; when they move on, close the tab, or go offline, the take
-- must revert to 'call_again'.
--
-- Bug: the cleanup only reverted orders tracked in an EXPIRED view row. Once an
-- order got stuck in 'take' (a view row deleted without reverting, an untracked
-- re-take, a crash) nothing ever reverted it — so offline agents accumulated
-- dozens of permanent takes (Boris 26, Miki 30) and showed as "on this customer".
-- There is also no pg_cron on this project, so cleanup only runs lazily on each
-- heartbeat / lookup.
--
-- Fix: rewrite cleanup_expired_active_call_views() to ALSO revert any order that
-- is still 'take' but has NO live view covering it (the real safety net), and
-- clear the soft-lock (assigned_agent_id/assigned_at) on every revert so the
-- "open" counts stay truthful. Because this runs on every heartbeat/lookup, a
-- stuck take now clears within ~30s of any agent being active. A one-time
-- backfill at the end clears the currently-stuck takes immediately.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_expired_active_call_views()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  reverted_count int := 0;
  orphaned_count int := 0;
BEGIN
  -- 1) Expired views: revert their tracked orders to the EXACT prior status
  --    (e.g. a website 'pending' goes back to 'pending', not 'call_again') and
  --    clear the soft-lock, then delete the view row.
  FOR v IN
    SELECT id, agent_id, taken_order_ids, taken_from_status
    FROM public.active_call_views
    WHERE expires_at < now()
  LOOP
    FOR i IN 1..coalesce(array_length(v.taken_order_ids, 1), 0) LOOP
      UPDATE public.orders
        SET status = v.taken_from_status[i]::order_status,
            assigned_agent_id = NULL,
            assigned_at = NULL
        WHERE id = v.taken_order_ids[i]
          AND status = 'take'
          AND assigned_agent_id = v.agent_id;
      IF FOUND THEN reverted_count := reverted_count + 1; END IF;
    END LOOP;
    DELETE FROM public.active_call_views WHERE id = v.id;
  END LOOP;

  -- 2) SAFETY NET: any order still in 'take' that NO live view covers (agent went
  --    offline / crashed / the take got stuck untracked). Revert to 'call_again'
  --    and clear the soft-lock so it returns to the calling pool. This is what
  --    finally clears long-stuck takes that step 1 can no longer see.
  UPDATE public.orders o
    SET status = 'call_again'::order_status,
        assigned_agent_id = NULL,
        assigned_at = NULL
    WHERE o.status = 'take'
      AND NOT EXISTS (
        SELECT 1
        FROM public.active_call_views acv
        WHERE acv.expires_at > now()
          AND acv.agent_id = o.assigned_agent_id
          AND o.id = ANY(acv.taken_order_ids)
      );
  GET DIAGNOSTICS orphaned_count = ROW_COUNT;

  RETURN reverted_count + orphaned_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_active_call_views() TO authenticated;

-- One-time backfill: clear every currently-stuck take right now.
SELECT public.cleanup_expired_active_call_views();

COMMIT;
