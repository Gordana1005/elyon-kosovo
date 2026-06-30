-- Batch A — Security hardening
--
-- Notes
--  • notifications INSERT was already tightened in 20260312051301
--  • inventory_logs SELECT was already tightened in 20260505151349
--  • module_settings + role_permissions SELECT remain readable by all
--    authenticated users — the frontend depends on them for routing.
--    A proper get_my_permissions() SECURITY DEFINER refactor is Batch C.

-- 1. financial_visibility — admin/manager only (was: all authenticated)
DROP POLICY IF EXISTS "Authenticated can view financial_visibility"
  ON public.financial_visibility;

CREATE POLICY "Admins and managers view financial_visibility"
  ON public.financial_visibility FOR SELECT
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

-- 2. lead_distribution_config — admin/manager only (was: all authenticated)
DROP POLICY IF EXISTS "Authenticated can view lead_distribution_config"
  ON public.lead_distribution_config;

CREATE POLICY "Admins and managers view lead_distribution_config"
  ON public.lead_distribution_config FOR SELECT
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

-- 3. profiles.user_id index — speeds up every RLS check that joins to profiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id
  ON public.profiles(user_id);
