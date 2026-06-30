-- Phase 2C — lock down module_settings + role_permissions SELECT policies
--
-- The frontend now reads via the get_my_permissions() RPC (Phase 2A),
-- which is SECURITY DEFINER and bypasses RLS. So we can safely make the
-- underlying tables admin/manager-only without breaking agents.
--
-- After this migration:
--   - Admin/manager: direct SELECT works (via existing 'Admins can manage'
--     and 'Managers can manage' FOR ALL policies that already grant USING).
--   - Agents/other roles: direct SELECT denied. They must go through the
--     get_my_permissions() RPC, which only returns rows scoped to them.

-- module_settings ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can view module_settings"
  ON public.module_settings;

-- role_permissions ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can view role_permissions"
  ON public.role_permissions;

-- Admins already have full access via "Admins can manage role_permissions"
-- (FOR ALL ... USING (has_role('admin'))). Add an equivalent for managers
-- so they can edit role permissions in the Settings UI. The original schema
-- had managers covered for some tables but not these two — fix that too.

CREATE POLICY "Managers can view module_settings"
  ON public.module_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers can view role_permissions"
  ON public.role_permissions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));
