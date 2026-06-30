-- ============================================================================
-- ENGINE v4 CONTROLS — dashboard kill-switch + on-demand recompute (2026-06-26)
-- ============================================================================
-- Adds operator controls (used by Settings → Prediction Engine):
--   * A STOP switch for the NEW preview (shadow) engine: turns its nightly job
--     on/off without touching the live v3.4 engine or its 03:00 cron at all.
--   * Status read so the dashboard can show what's scheduled and running.
-- On-demand recompute uses the existing recompute RPCs (live: recompute_all_segments,
-- preview: recompute_all_segments_v4) — wired to buttons in the UI.
-- ============================================================================

BEGIN;

-- Flag (default ON, matching the shadow cron the scaffold scheduled).
INSERT INTO public.app_settings (key, value)
VALUES ('segment_shadow_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Turn the preview (shadow) engine's nightly job on/off + remember the choice.
-- Does NOT touch the live engine or its cron.
CREATE OR REPLACE FUNCTION public.set_shadow_engine(_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.app_settings (key, value)
  VALUES ('segment_shadow_enabled', to_jsonb(_enabled))
  ON CONFLICT (key) DO UPDATE SET value = to_jsonb(_enabled), updated_at = now();

  IF _enabled THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute-shadow') THEN
      PERFORM cron.schedule('nightly-segment-recompute-shadow', '30 0 * * *',
        $job$SELECT public.recompute_all_segments_v4();$job$);
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute-shadow') THEN
      PERFORM cron.unschedule('nightly-segment-recompute-shadow');
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_shadow_engine(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_shadow_engine(BOOLEAN) TO service_role;

-- Status for the dashboard: is the preview engine enabled, are the crons live,
-- and when do they run.
CREATE OR REPLACE FUNCTION public.segment_engine_controls_status()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'shadow_enabled',     COALESCE((SELECT value FROM public.app_settings WHERE key = 'segment_shadow_enabled'), 'true'::jsonb),
    'active_engine',      public.get_active_segment_engine(),
    'shadow_cron_active', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute-shadow' AND active),
    'shadow_cron_schedule', (SELECT schedule FROM cron.job WHERE jobname = 'nightly-segment-recompute-shadow' LIMIT 1),
    'live_cron_active',   EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute' AND active),
    'live_cron_schedule', (SELECT schedule FROM cron.job WHERE jobname = 'nightly-segment-recompute' LIMIT 1)
  );
$$;

REVOKE ALL ON FUNCTION public.segment_engine_controls_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.segment_engine_controls_status() TO service_role;
