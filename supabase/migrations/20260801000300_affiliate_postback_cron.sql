-- Affiliate/CPA program — step 4 of 4: every-minute drain scheduler.
--
-- Postgres never delivers postbacks itself — the edge function does (macro
-- rendering, fetch with timeout, backoff). But something must wake the drain
-- reliably even when no operator is clicking around. This is the officially
-- documented Supabase pattern: pg_cron + pg_net invoking the edge function,
-- with the shared secret kept in Vault (never in SQL/source).
--
-- Until Increment 3 deploys the drain endpoint AND the operator stores the
-- secret, this job is a silent no-op:
--   * no due pending rows  → returns before any HTTP,
--   * vault secret missing → returns before any HTTP.
--
-- One-time setup (manual, values NEVER committed):
--   npx supabase secrets set POSTBACK_DRAIN_SECRET=<64-hex>   (edge side)
--   SELECT vault.create_secret('<same 64-hex>', 'postback_drain_secret');
--
-- Operator fallback if pg_net is ever unwanted: unschedule this job and put a
-- curl on the PBX VPS crontab hitting the same endpoint with the same header.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.invoke_affiliate_postback_drain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _secret text;
BEGIN
  -- Cheap gate: no due work → no HTTP call (keeps the every-minute job free).
  IF NOT EXISTS (
    SELECT 1 FROM public.affiliate_postbacks
    WHERE status = 'pending' AND next_attempt_at <= now()
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _secret
  FROM vault.decrypted_secrets
  WHERE name = 'postback_drain_secret';
  IF _secret IS NULL THEN
    RETURN;  -- vault not configured yet → no-op
  END IF;

  -- MACEDONIA. Upstream (Bulgaria) hardcodes its own project ref here; this URL
  -- must always be THIS project. Pointing it at another deployment makes this
  -- database drain that deployment's postback queue once a minute, silently.
  PERFORM net.http_post(
    url := 'https://bmfxhgznttcnnlqloqzp.supabase.co/functions/v1/api/cpa/postbacks/process',
    headers := jsonb_build_object('x-postback-secret', _secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
EXCEPTION WHEN OTHERS THEN
  RETURN;  -- the scheduler must never error the cron job
END;
$fn$;

-- Only the cron job (job owner) should run this; it reads a vault secret.
REVOKE ALL ON FUNCTION public.invoke_affiliate_postback_drain() FROM PUBLIC, anon, authenticated;

-- Idempotent: replace any previous schedule with the same name.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-postback-drain') THEN
    PERFORM cron.unschedule('affiliate-postback-drain');
  END IF;
END
$cron$;

SELECT cron.schedule(
  'affiliate-postback-drain',
  '* * * * *',
  $job$SELECT public.invoke_affiliate_postback_drain();$job$
);
