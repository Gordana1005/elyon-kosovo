-- Phase 2B — seed default module + role permissions
--
-- Without these rows the RPC returns empty arrays, which means agents
-- can't access any module (admin/manager are unaffected because of the
-- 'admin returns true' shortcut in PermissionsContext.canAccessModule).
--
-- The values here are sensible defaults; admins can tune them via the
-- Settings UI later. Using ON CONFLICT DO NOTHING so re-applying the
-- migration on a database that already has data is a no-op.

-- ── module_settings ────────────────────────────────────────────
INSERT INTO public.module_settings (module_key, module_label, is_enabled, is_protected) VALUES
  ('dashboard',          'Dashboard',           true, false),
  ('insights',           'Management Insights', true, false),
  ('operations',         'Operations',          true, false),
  ('orders',             'Orders',              true, false),
  ('inbound_leads',      'Inbound Leads',       true, false),
  ('assigner',           'Assigner',            true, false),
  ('lead_distribution',  'Lead Distribution',   true, false),
  ('assigned',           'Assigned to Me',      true, false),
  ('prediction_leads',   'Prediction Leads',    true, false),
  ('prediction_lists',   'Prediction Lists',    true, false),
  ('search_prediction',  'Search Prediction',   true, false),
  ('warehouse',          'Warehouse',           true, false),
  ('users',              'Users',               true, false),
  ('performance',        'Agent Performance',   true, false),
  ('shifts',             'Shifts Management',   true, false),
  ('my_shifts',          'My Shifts',           true, false),
  ('call_scripts',       'Call Scripts',        true, false),
  ('call_history',       'Call History',        true, false),
  ('products',           'Products',            true, false),
  ('webhooks',           'Webhooks',            true, false),
  ('ads',                'Ads',                 true, false),
  ('settings',           'Settings',            true, true)
ON CONFLICT (module_key) DO NOTHING;

-- ── role_permissions ───────────────────────────────────────────
-- One row per (role, module). Admins/Managers bypass this table via
-- their override in canAccessModule, but rows are still useful for
-- UI rendering of "what each role can do".

-- Helper: ((role, module_key, view, create, edit, delete, export))
-- ----------------------------- agent (regular call-center agent) ---
INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('agent', 'dashboard',         true,  false, false, false, false),
  ('agent', 'assigned',          true,  false, true,  false, false),
  ('agent', 'prediction_leads',  true,  false, true,  false, false),
  ('agent', 'call_scripts',      true,  false, false, false, false),
  ('agent', 'call_history',      true,  false, false, false, false),
  ('agent', 'my_shifts',         true,  false, false, false, false),
  ('agent', 'products',          true,  false, false, false, false),
  ('agent', 'inbound_leads',     true,  false, true,  false, false),

-- ----------------------------- pending_agent (limited until activated) ---
  ('pending_agent', 'assigned',  true,  false, true,  false, false),
  ('pending_agent', 'my_shifts', true,  false, false, false, false),
  ('pending_agent', 'call_scripts', true, false, false, false, false),

-- ----------------------------- prediction_agent (calling prediction leads) ---
  ('prediction_agent', 'dashboard',         true,  false, false, false, false),
  ('prediction_agent', 'prediction_leads',  true,  false, true,  false, false),
  ('prediction_agent', 'call_scripts',      true,  false, false, false, false),
  ('prediction_agent', 'call_history',      true,  false, false, false, false),
  ('prediction_agent', 'my_shifts',         true,  false, false, false, false),
  ('prediction_agent', 'products',          true,  false, false, false, false),

-- ----------------------------- warehouse ---
  ('warehouse', 'warehouse',     true,  true,  true,  false, true),
  ('warehouse', 'products',      true,  false, false, false, false),
  ('warehouse', 'orders',        true,  false, true,  false, false),

-- ----------------------------- ads_admin ---
  ('ads_admin', 'ads',           true,  true,  true,  true,  true),
  ('ads_admin', 'webhooks',      true,  true,  true,  true,  false),
  ('ads_admin', 'inbound_leads', true,  false, true,  false, false),
  ('ads_admin', 'dashboard',     true,  false, false, false, false),

-- ----------------------------- manager (broad ops; no user/settings deletion by default) ---
  ('manager', 'dashboard',         true,  false, false, false, true),
  ('manager', 'insights',          true,  false, false, false, true),
  ('manager', 'operations',        true,  true,  true,  false, true),
  ('manager', 'orders',            true,  true,  true,  false, true),
  ('manager', 'inbound_leads',     true,  true,  true,  false, true),
  ('manager', 'assigner',          true,  true,  true,  false, false),
  ('manager', 'lead_distribution', true,  true,  true,  false, false),
  ('manager', 'assigned',          true,  true,  true,  false, true),
  ('manager', 'prediction_leads',  true,  true,  true,  false, true),
  ('manager', 'prediction_lists',  true,  true,  true,  true,  true),
  ('manager', 'search_prediction', true,  false, false, false, true),
  ('manager', 'warehouse',         true,  true,  true,  false, true),
  ('manager', 'users',             true,  true,  true,  false, false),
  ('manager', 'performance',       true,  false, false, false, true),
  ('manager', 'shifts',            true,  true,  true,  true,  false),
  ('manager', 'my_shifts',         true,  false, false, false, false),
  ('manager', 'call_scripts',      true,  true,  true,  false, false),
  ('manager', 'call_history',      true,  false, false, false, true),
  ('manager', 'products',          true,  true,  true,  false, true),
  ('manager', 'webhooks',          true,  true,  true,  false, false),
  ('manager', 'ads',               true,  true,  true,  false, false),
  ('manager', 'settings',          true,  false, true,  false, false),

-- ----------------------------- admin (everything; the in-code admin shortcut also bypasses these) ---
  ('admin', 'dashboard',         true, true, true, true, true),
  ('admin', 'insights',          true, true, true, true, true),
  ('admin', 'operations',        true, true, true, true, true),
  ('admin', 'orders',            true, true, true, true, true),
  ('admin', 'inbound_leads',     true, true, true, true, true),
  ('admin', 'assigner',          true, true, true, true, true),
  ('admin', 'lead_distribution', true, true, true, true, true),
  ('admin', 'assigned',          true, true, true, true, true),
  ('admin', 'prediction_leads',  true, true, true, true, true),
  ('admin', 'prediction_lists',  true, true, true, true, true),
  ('admin', 'search_prediction', true, true, true, true, true),
  ('admin', 'warehouse',         true, true, true, true, true),
  ('admin', 'users',             true, true, true, true, true),
  ('admin', 'performance',       true, true, true, true, true),
  ('admin', 'shifts',            true, true, true, true, true),
  ('admin', 'my_shifts',         true, true, true, true, true),
  ('admin', 'call_scripts',      true, true, true, true, true),
  ('admin', 'call_history',      true, true, true, true, true),
  ('admin', 'products',          true, true, true, true, true),
  ('admin', 'webhooks',          true, true, true, true, true),
  ('admin', 'ads',               true, true, true, true, true),
  ('admin', 'settings',          true, true, true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;

-- ── financial_visibility ───────────────────────────────────────
-- Who sees profit/cost/insights. Agents see nothing financial by default.
INSERT INTO public.financial_visibility (role, show_profit, show_net_contribution, show_cost, show_returned_value, show_financial_insights) VALUES
  ('admin',            true,  true,  true,  true,  true),
  ('manager',          true,  true,  true,  true,  true),
  ('ads_admin',        false, false, false, false, false),
  ('warehouse',        false, false, true,  true,  false),
  ('agent',            false, false, false, false, false),
  ('pending_agent',    false, false, false, false, false),
  ('prediction_agent', false, false, false, false, false)
ON CONFLICT (role) DO NOTHING;
