-- ============================================================================
-- Nightly automatic segment recompute (2026-06-10 operator decision)
-- ============================================================================
-- The classifier is time-sensitive (recency bands, the 30-day Current Cancels
-- park, Never-Converted Recent -> Old at 180 days, NEWCOMERS graduating at
-- day 21), but until now recompute only ran on order events or the manual
-- button — so customers never aged between lists. This schedules the full
-- recompute every night at 00:00 UTC (03:00 Sofia in summer, 02:00 in winter).
-- Order events keep recomputing instantly during the day via the triggers.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: replace any previous schedule with the same name.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute') THEN
    PERFORM cron.unschedule('nightly-segment-recompute');
  END IF;
END
$cron$;

SELECT cron.schedule(
  'nightly-segment-recompute',
  '0 0 * * *',
  $job$SELECT public.recompute_all_segments();$job$
);
