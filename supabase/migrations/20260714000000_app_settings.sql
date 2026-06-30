-- Generic key/value store for operator-tunable global settings, so things the
-- business wants to regulate from the dashboard (instead of via a code change +
-- redeploy) live in one place. First tenant: the per-agent Personal List
-- capacity, previously a hard-coded 25 in the edge function and the Calls badge.
--
-- Reads are open to any authenticated user (the agent's "/N" badge needs the
-- number). Writes are admin-only and in practice go through the edge function's
-- service-role client; the RLS policy below is belt-and-suspenders.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read app_settings"
  ON public.app_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage app_settings"
  ON public.app_settings FOR ALL
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));

CREATE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Default raised from the old hard-coded 25 to 50.
INSERT INTO public.app_settings (key, value)
VALUES ('personal_list_max_holds', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;
