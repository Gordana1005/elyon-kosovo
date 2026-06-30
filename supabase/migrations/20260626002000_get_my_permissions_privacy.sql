-- Extend get_my_permissions() with a `privacy` block (role_privacy rows),
-- mirroring how `financialVisibility` is returned. Admins/managers get all rows
-- (so the Access & Privacy tab can render the full matrix); everyone else gets
-- only their own role's rows. SECURITY DEFINER + fixed search_path as before.

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
    ), '[]'::jsonb),

    'privacy', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role',                  pv.role,
        'show_customer_phone',   pv.show_customer_phone,
        'show_customer_name',    pv.show_customer_name,
        'show_customer_address', pv.show_customer_address,
        'show_order_history',    pv.show_order_history,
        'show_segment_members',  pv.show_segment_members,
        'can_hear_recordings',   pv.can_hear_recordings
      ))
      FROM public.role_privacy pv
      WHERE (SELECT yes FROM is_priv)
         OR pv.role IN (SELECT role_name FROM my_role_names)
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;
