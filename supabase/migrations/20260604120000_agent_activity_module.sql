-- Agent Activity Timeline module — enable the module + grant view to
-- manager/admin so the /agent-activity page is reachable and its sidebar
-- entry renders. Admins also bypass role_permissions via the in-code
-- canAccessModule shortcut, but the row is kept for UI completeness.
--
-- Idempotent: ON CONFLICT DO NOTHING so re-applying is a no-op.

-- ── module_settings ────────────────────────────────────────────
INSERT INTO public.module_settings (module_key, module_label, is_enabled, is_protected) VALUES
  ('agent_activity', 'Agent Activity', true, false)
ON CONFLICT (module_key) DO NOTHING;

-- ── role_permissions ───────────────────────────────────────────
-- View-only management feature: manager + admin. Agents do NOT get a nav
-- entry; if ever granted, the endpoint still pins them to their own row.
INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('manager', 'agent_activity', true, false, false, false, true),
  ('admin',   'agent_activity', true, true,  true,  true,  true)
ON CONFLICT (role, module_key) DO NOTHING;
