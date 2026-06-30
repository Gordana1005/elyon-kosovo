-- Per-agent "hear your OWN recordings" privacy flag (training use case).
--
-- Background: today role_privacy.can_hear_recordings means "hear ALL recordings"
-- (admin/manager/inbound_agent). Operators want regular call agents to replay
-- their OWN calls for training, with a hard guarantee they can never hear another
-- agent's calls. We add a SEPARATE, explicit flag instead of overloading the
-- existing one (overloading would make the same toggle mean "all" for one role
-- and "own" for another — a footgun).
--
-- The real boundary is server-side in the edge function: Call History is already
-- scoped to the caller's own rows, and GET /api/recordings/audio now verifies the
-- requested file belongs to the caller before signing a URL. This flag only
-- decides WHO gets the own-scoped path; it never grants cross-agent access.

ALTER TABLE public.role_privacy
  ADD COLUMN IF NOT EXISTS can_hear_own_recordings boolean NOT NULL DEFAULT false;

-- Extend get_my_permissions() so the frontend + edge function see the new flag.
-- Identical to 20260626002000_get_my_permissions_privacy.sql except the privacy
-- block now also returns can_hear_own_recordings.
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
        'role',                    pv.role,
        'show_customer_phone',     pv.show_customer_phone,
        'show_customer_name',      pv.show_customer_name,
        'show_customer_address',   pv.show_customer_address,
        'show_order_history',      pv.show_order_history,
        'show_segment_members',    pv.show_segment_members,
        'can_hear_recordings',     pv.can_hear_recordings,
        'can_hear_own_recordings', pv.can_hear_own_recordings
      ))
      FROM public.role_privacy pv
      WHERE (SELECT yes FROM is_priv)
         OR pv.role IN (SELECT role_name FROM my_role_names)
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- Seed ON for the call-agent roles that train on their own calls. Pending agents
-- are intentionally excluded (they have no Call History access). inbound_agent
-- keeps its existing hear-all access. Admins are all-access regardless.
UPDATE public.role_privacy
  SET can_hear_own_recordings = true, updated_at = now()
  WHERE role IN ('agent', 'prediction_agent');
