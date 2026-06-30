-- Granular tab control: make individual in-page tabs governable from
-- Settings → Role Permissions (and enforced server-side via canViewModule).
--
-- This is the pattern for "control every tab": register the element as a module
-- key, gate its render + its data endpoint on canAccessModule/canViewModule.
--
-- Defaults here:
--   call_activity      → admin only (Call Activity timeline in Insights)
--   warehouse_incoming → admin + warehouse (hidden from managers/investors)
-- Admin is always allowed via the in-code shortcut, so only the warehouse grant
-- needs an explicit row. Every other role defaults to no access (no row) and can
-- be granted later from the Role Permissions UI (now upsert-backed).

INSERT INTO public.module_settings (module_key, module_label, is_enabled, is_protected) VALUES
  ('call_activity',      'Call Activity (Insights)',    true, false),
  ('warehouse_incoming', 'Warehouse — Incoming Orders', true, false)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('warehouse', 'warehouse_incoming', true, false, true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;
