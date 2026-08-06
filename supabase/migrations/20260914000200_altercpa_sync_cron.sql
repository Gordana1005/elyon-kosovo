-- AlterCPA bridge — the schedulers.
--
-- Postgres never talks to AlterCPA itself; the altercpa-sync edge function does
-- (window splitting, offer mapping, order promotion). This is the same pg_cron
-- + pg_net pattern 20260801000300 uses for the postback drain, including the
-- rule that the secret lives in Vault and never in SQL.
--
-- One-time setup (values NEVER committed — see docs/VAULT.md §2):
--   npx supabase secrets set ALTERCPA_SYNC_SECRET=<64-hex> --project-ref bmfxhgznttcnnlqloqzp
--   SELECT vault.create_secret('<same 64-hex>', 'altercpa_sync_secret');
--
-- Until an active row exists in altercpa_accounts AND the vault secret is
-- stored, every job below is a silent no-op — it returns before any HTTP.
--
-- ── Why three jobs and not one ──────────────────────────────────────────────
-- The rolling job only ever asks for a narrow recent window. Whether that is
-- enough depends on something we cannot assume: does comp/list.json's from/to
-- filter on CREATION time or LAST-UPDATE time? If creation, an order stays in
-- its birth window forever and the rolling poll can NEVER see a phase change on
-- an older lead — the sweeps are then the only path an outcome has, not a
-- safety net. scripts/probe-altercpa-window.mjs answers this; the sweeps are
-- sized so the bridge is correct either way.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.invoke_altercpa_sync(_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _secret text;
BEGIN
  -- Cheap gate: nothing configured → no HTTP at all.
  IF NOT EXISTS (SELECT 1 FROM public.altercpa_accounts WHERE is_active) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _secret
  FROM vault.decrypted_secrets
  WHERE name = 'altercpa_sync_secret';
  IF _secret IS NULL THEN
    RETURN;  -- vault not configured yet → no-op
  END IF;

  -- MACEDONIA. This URL must always be THIS project. Pointed anywhere else,
  -- this database would drive another deployment's lead intake on a timer.
  PERFORM net.http_post(
    url := 'https://bmfxhgznttcnnlqloqzp.supabase.co/functions/v1/altercpa-sync',
    headers := jsonb_build_object(
      'x-altercpa-sync-secret', _secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', _kind),
    -- Generous: a sweep fans out to a third-party API and may split windows.
    -- pg_net is async, so this bounds the response wait, not the cron slot.
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RETURN;  -- the scheduler must never error the cron job
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_altercpa_sync(text) FROM PUBLIC, anon, authenticated;

-- Idempotent: replace any previous schedules with these names.
DO $cron$
DECLARE
  _job text;
BEGIN
  FOREACH _job IN ARRAY ARRAY['altercpa-sync-rolling','altercpa-sync-nightly','altercpa-sync-weekly']
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = _job) THEN
      PERFORM cron.unschedule(_job);
    END IF;
  END LOOP;
END
$cron$;

-- New leads. Every 2 minutes, window = last_synced_at − 45 min → now.
-- Not every minute: the postback drain already holds that slot, and a lead that
-- is two minutes old is not meaningfully colder than a one-minute-old one.
SELECT cron.schedule(
  'altercpa-sync-rolling', '*/2 * * * *',
  $job$SELECT public.invoke_altercpa_sync('rolling');$job$
);

-- Nightly sweep, last 7 days. 02:15 Europe/Skopje is 00:15/01:15 UTC depending
-- on DST; cron here is UTC, and the exact minute does not matter — what matters
-- is that it is outside calling hours so a status flip never lands mid-call.
SELECT cron.schedule(
  'altercpa-sync-nightly', '15 1 * * *',
  $job$SELECT public.invoke_altercpa_sync('nightly');$job$
);

-- Weekly sweep, last 90 days: the reconciliation net for slow COD conversions.
-- 90 days is a starting figure — probe §3 measures the real creation→settlement
-- p99 and this window must be at least that, or the slowest conversions are
-- missed permanently rather than late.
SELECT cron.schedule(
  'altercpa-sync-weekly', '45 2 * * 0',
  $job$SELECT public.invoke_altercpa_sync('weekly');$job$
);
