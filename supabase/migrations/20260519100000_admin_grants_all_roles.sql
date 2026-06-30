-- Admins implicitly have every role
--
-- The CRM has been growing roles (manager, warehouse, prediction_agent,
-- pending_agent, ads_admin, agent) and we kept hitting the situation where an
-- admin user technically didn't carry e.g. 'agent', so they didn't appear in
-- agent-only dropdowns or list memberships and looked half-provisioned to
-- managers. Operationally an admin should be able to act as any other role.
--
-- This migration:
--   1) backfills every non-admin role onto each existing admin user
--   2) installs a trigger so any future admin grant auto-fills the rest
--
-- Idempotent and safe to re-run (uses ON CONFLICT DO NOTHING).

-- 1) Trigger function: when admin role is inserted, also insert every other role
CREATE OR REPLACE FUNCTION public.admin_grant_all_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.app_role;
BEGIN
  IF NEW.role = 'admin' THEN
    FOR r IN
      SELECT unnest(enum_range(NULL::public.app_role))
      EXCEPT
      SELECT 'admin'::public.app_role
    LOOP
      INSERT INTO public.user_roles(user_id, role)
      VALUES (NEW.user_id, r)
      ON CONFLICT (user_id, role) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_grant_all_roles ON public.user_roles;
CREATE TRIGGER trg_admin_grant_all_roles
AFTER INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.admin_grant_all_roles();

-- 2) Backfill existing admins so they have every role today
INSERT INTO public.user_roles(user_id, role)
SELECT ur.user_id, r.role
FROM public.user_roles ur
CROSS JOIN (
  SELECT unnest(enum_range(NULL::public.app_role)) AS role
) r
WHERE ur.role = 'admin'
  AND r.role <> 'admin'
ON CONFLICT (user_id, role) DO NOTHING;
