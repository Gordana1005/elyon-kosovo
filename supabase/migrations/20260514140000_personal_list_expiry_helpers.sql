-- Personal List expiry helpers.
--
-- We deliberately DO NOT use pg_cron — this project doesn't have it enabled
-- and the v1 escalation flow doesn't need a scheduler. Instead the API
-- endpoint GET /api/personal-list/expiring calls these helpers on demand
-- (lazy escalation): the first read after a hold passes its expires_at
-- writes escalated_at, so admins/managers see the same "newly expired"
-- count whether they refresh the dashboard hourly or daily.

-- Mark every active hold past its expiry as escalated (idempotent — if
-- escalated_at is already set, leave it). Returns the rows that were
-- newly escalated in this call.
CREATE OR REPLACE FUNCTION public.escalate_expired_personal_list_holds()
RETURNS TABLE (
  id uuid,
  agent_id uuid,
  agent_name text,
  customer_phone text,
  customer_name text,
  reason text,
  expires_at timestamptz,
  escalated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.personal_list_holds
     SET escalated_at = now()
   WHERE status = 'active'
     AND expires_at < now()
     AND escalated_at IS NULL
  RETURNING id, agent_id, agent_name, customer_phone, customer_name,
            reason, expires_at, escalated_at;
$$;

-- Count of holds currently past expiry (drives the dashboard bell badge).
-- Independent of escalated_at so the count is accurate even before anyone
-- has triggered the escalation helper.
CREATE OR REPLACE FUNCTION public.count_expired_personal_list_holds()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.personal_list_holds
   WHERE status = 'active'
     AND expires_at < now();
$$;

GRANT EXECUTE ON FUNCTION public.escalate_expired_personal_list_holds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_expired_personal_list_holds() TO authenticated;
