-- Phase 2A — get_my_permissions() RPC
--
-- Centralizes how the frontend reads its three permission-resolution tables
-- (module_settings, role_permissions, financial_visibility). Once the
-- frontend uses this single RPC, we can lock the underlying tables down so
-- non-admin users can't query them directly (Phase 2C migration).
--
-- The RPC returns:
--  - all module_settings rows (everybody needs them for routing)
--  - role_permissions rows that match the caller's roles
--    (admins/managers see all rows so they can configure them)
--  - financial_visibility rows that match the caller's roles
--    (admins/managers see all rows for the same reason)
--
-- SECURITY DEFINER + SET search_path is the standard hardening for RPCs
-- that bypass RLS. Granting EXECUTE to authenticated users is enough —
-- the function only returns rows for the caller's identity (auth.uid()).

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_role_names AS (
    SELECT ur.role::text AS role_name
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
  ),
  is_priv AS (
    SELECT public.is_admin_or_manager(auth.uid()) AS yes
  )
  SELECT jsonb_build_object(
    'modules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'module_key',   ms.module_key,
        'module_label', ms.module_label,
        'is_enabled',   ms.is_enabled,
        'is_protected', ms.is_protected
      ) ORDER BY ms.module_label)
      FROM public.module_settings ms
    ), '[]'::jsonb),

    'rolePermissions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role',       rp.role,
        'module_key', rp.module_key,
        'can_view',   rp.can_view,
        'can_create', rp.can_create,
        'can_edit',   rp.can_edit,
        'can_delete', rp.can_delete,
        'can_export', rp.can_export
      ))
      FROM public.role_permissions rp
      WHERE (SELECT yes FROM is_priv)
         OR rp.role IN (SELECT role_name FROM my_role_names)
    ), '[]'::jsonb),

    'financialVisibility', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role',                    fv.role,
        'show_profit',             fv.show_profit,
        'show_net_contribution',   fv.show_net_contribution,
        'show_cost',               fv.show_cost,
        'show_returned_value',     fv.show_returned_value,
        'show_financial_insights', fv.show_financial_insights
      ))
      FROM public.financial_visibility fv
      WHERE (SELECT yes FROM is_priv)
         OR fv.role IN (SELECT role_name FROM my_role_names)
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

COMMENT ON FUNCTION public.get_my_permissions() IS
  'Returns the caller''s effective permission summary as a single JSON document. '
  'Bypasses RLS by design (SECURITY DEFINER) but only returns rows the caller is '
  'entitled to see based on their roles. Used by the frontend PermissionsContext.';
