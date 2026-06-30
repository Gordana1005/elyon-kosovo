
-- Module settings: global enable/disable for each module
CREATE TABLE public.module_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL UNIQUE,
  module_label text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  is_protected boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.module_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage module_settings" ON public.module_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view module_settings" ON public.module_settings
  FOR SELECT TO authenticated
  USING (true);

-- Role permissions: per-role, per-module action permissions
CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  module_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  can_export boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, module_key)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage role_permissions" ON public.role_permissions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view role_permissions" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (true);

-- Financial visibility per role
CREATE TABLE public.financial_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL UNIQUE,
  show_profit boolean NOT NULL DEFAULT false,
  show_net_contribution boolean NOT NULL DEFAULT false,
  show_cost boolean NOT NULL DEFAULT false,
  show_returned_value boolean NOT NULL DEFAULT false,
  show_financial_insights boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_visibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage financial_visibility" ON public.financial_visibility
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view financial_visibility" ON public.financial_visibility
  FOR SELECT TO authenticated
  USING (true);
