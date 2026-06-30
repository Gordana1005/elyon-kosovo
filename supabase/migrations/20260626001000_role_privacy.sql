-- Per-role privacy / data-exposure controls (the "Access & Privacy" tab).
--
-- Mirrors the financial_visibility design: one row per role, admin-only writes,
-- read by everyone through the SECURITY DEFINER get_my_permissions() RPC.
-- The edge function enforces these server-side (the real boundary); the frontend
-- masking is cosmetic on top.

CREATE TABLE IF NOT EXISTS public.role_privacy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL UNIQUE,
  show_customer_phone   boolean NOT NULL DEFAULT true,   -- full phone vs last-3 mask
  show_customer_name    boolean NOT NULL DEFAULT true,   -- full name vs "First L."
  show_customer_address boolean NOT NULL DEFAULT true,   -- street/postal vs "•••" (city always shown)
  show_order_history    boolean NOT NULL DEFAULT true,   -- order status timeline + customer's past orders
  show_segment_members  boolean NOT NULL DEFAULT true,   -- per-list member counts + the people inside
  can_hear_recordings   boolean NOT NULL DEFAULT false,  -- play / download call recordings
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.role_privacy ENABLE ROW LEVEL SECURITY;

-- Admins manage it; admins+managers may read it directly (everyone else reads
-- their own effective flags via get_my_permissions()).
CREATE POLICY "Admins can manage role_privacy" ON public.role_privacy
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins and managers view role_privacy" ON public.role_privacy
  FOR SELECT TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

-- ── Seed defaults ──────────────────────────────────────────────
-- admin/inbound_agent: full visibility + recordings. manager (investor): masked,
-- no history, no segment members, no recordings. warehouse/agents: full customer
-- data (they need it to work) but no recordings by default. ads_admin: minimal.
INSERT INTO public.role_privacy
  (role, show_customer_phone, show_customer_name, show_customer_address, show_order_history, show_segment_members, can_hear_recordings) VALUES
  ('admin',            true,  true,  true,  true,  true,  true),
  ('inbound_agent',    true,  true,  true,  true,  true,  true),
  ('manager',          false, false, false, false, false, false),
  ('agent',            true,  true,  true,  true,  true,  false),
  ('pending_agent',    true,  true,  true,  true,  true,  false),
  ('prediction_agent', true,  true,  true,  true,  true,  false),
  ('warehouse',        true,  true,  true,  true,  false, false),
  ('ads_admin',        false, false, false, false, false, false)
ON CONFLICT (role) DO NOTHING;

-- ── role_permissions for the new inbound_agent role (mirror 'agent') ──
INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('inbound_agent', 'dashboard',        true,  false, false, false, false),
  ('inbound_agent', 'assigned',         true,  false, true,  false, false),
  ('inbound_agent', 'prediction_leads', true,  false, true,  false, false),
  ('inbound_agent', 'call_scripts',     true,  false, false, false, false),
  ('inbound_agent', 'call_history',     true,  false, false, false, false),
  ('inbound_agent', 'my_shifts',        true,  false, false, false, false),
  ('inbound_agent', 'products',         true,  false, false, false, false),
  ('inbound_agent', 'inbound_leads',    true,  false, true,  false, false),
  ('inbound_agent', 'recordings',       true,  false, false, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

INSERT INTO public.financial_visibility (role, show_profit, show_net_contribution, show_cost, show_returned_value, show_financial_insights) VALUES
  ('inbound_agent', false, false, false, false, false)
ON CONFLICT (role) DO NOTHING;

-- ── Manager (investor) defaults: read-only orders + no Assigner ──
-- The Role Permissions tab can change these later; here we set the safe default
-- so a freshly-seeded manager is read-only on orders and has no Assigner access.
UPDATE public.role_permissions
  SET can_create = false, can_edit = false, can_delete = false
  WHERE role = 'manager' AND module_key = 'orders';

UPDATE public.role_permissions
  SET can_view = false, can_create = false, can_edit = false, can_delete = false
  WHERE role = 'manager' AND module_key = 'assigner';

-- ── Backfill: existing admins also carry inbound_agent (consistency with the
-- admin-grants-all-roles trigger, which now includes it for future admins). ──
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'inbound_agent'::public.app_role
FROM public.user_roles
WHERE role = 'admin'
ON CONFLICT (user_id, role) DO NOTHING;
