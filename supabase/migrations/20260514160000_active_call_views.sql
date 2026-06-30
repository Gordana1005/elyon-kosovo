-- TAKE status with heartbeat: when an agent opens a customer on the Calls
-- page, their pending/call_again orders flip to status='take' so other
-- agents/managers see who's currently working that customer. The browser
-- sends a heartbeat every 30s; if the heartbeat stops for 2+ minutes (tab
-- closed, agent walked away, opened another customer) the lazy-cleanup
-- function reverts orders back to 'pending' so they don't get stuck.

CREATE TABLE IF NOT EXISTS public.active_call_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name      text NOT NULL,
  customer_phone  text NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '2 minutes'),
  -- Snapshot of order ids whose status was flipped pending→take by this
  -- view, so cleanup can revert exactly those (and only those) back.
  taken_order_ids uuid[] NOT NULL DEFAULT '{}',
  taken_from_status text[] NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_call_view_agent_phone
  ON public.active_call_views (agent_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_active_call_views_phone
  ON public.active_call_views (customer_phone);

CREATE INDEX IF NOT EXISTS idx_active_call_views_expires
  ON public.active_call_views (expires_at);

ALTER TABLE public.active_call_views ENABLE ROW LEVEL SECURITY;

-- Every authenticated user can SEE every active view so the
-- "🟢 Mile is on this customer" badge renders for everyone.
CREATE POLICY "Authenticated can read active views"
  ON public.active_call_views FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Agents manage own views"
  ON public.active_call_views FOR ALL
  USING (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

-- Cleanup function: revert orders the expired view flipped to 'take',
-- then delete the row. Idempotent — safe to call from any GET endpoint
-- as a lazy sweep. Only reverts orders that are STILL in 'take' from
-- the same agent (so we don't trample a manual change).
CREATE OR REPLACE FUNCTION public.cleanup_expired_active_call_views()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  reverted_count int := 0;
BEGIN
  FOR v IN
    SELECT id, agent_id, taken_order_ids, taken_from_status
    FROM public.active_call_views
    WHERE expires_at < now()
  LOOP
    -- Revert each taken order, but only if it's still 'take' AND still
    -- assigned to the same agent (avoid trampling manual changes).
    FOR i IN 1..coalesce(array_length(v.taken_order_ids, 1), 0) LOOP
      UPDATE public.orders
        SET status = v.taken_from_status[i]
        WHERE id = v.taken_order_ids[i]
          AND status = 'take'
          AND assigned_agent_id = v.agent_id;
      IF FOUND THEN reverted_count := reverted_count + 1; END IF;
    END LOOP;
    DELETE FROM public.active_call_views WHERE id = v.id;
  END LOOP;
  RETURN reverted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_active_call_views() TO authenticated;
