-- ============================================================================
-- Periodic recording-link reconciler (2026-07-07)
-- ============================================================================
-- The hangup webhook (POST /api/webhook/recording) links a recording to a
-- call_logs row only if that row already exists when it fires. But the browser
-- writes the call_logs row (apiLogCall) AFTER the call ends, so the webhook
-- often wins the race: the recording lands in call_recordings with
-- call_log_id = NULL and is never retried (webhook is one-shot on uniqueid).
-- Historically that left ~40% of answered calls' recordings unlinked in the DB.
--
-- This reconciler closes the race from the read/DB side, entirely inside the
-- database (no PBX call, no secret, no external host): every few minutes it
-- links recordings the webhook captured-but-didn't-link to their now-existing
-- call_logs row, using the SAME rules the app matcher uses (last-8 phone,
-- time-overlap / end-proximity, agent-extension gate).
--
-- SAFETY: it only ever CONNECTS currently-unlinked rows (call_recordings with
-- call_log_id NULL -> call_logs with recording_uniqueid/recording_file NULL);
-- it never overwrites an existing link. It links ONLY unambiguous 1:1 matches
-- (a recording with exactly one candidate call and that call with exactly one
-- candidate recording), so it never guesses when a number was called more than
-- once in the window. Each pair is stamped independently with a
-- unique_violation guard, so a concurrent webhook write can never abort the run
-- or corrupt data. Genuinely ambiguous / conflicting cases are left untouched.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.reconcile_recording_links(_lookback_hours integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  _linked integer := 0;
  _r record;
BEGIN
  FOR _r IN
    WITH rec AS (
      -- recordings the webhook stored but never linked, recent + not already
      -- claimed by any call_logs row (belt-and-suspenders vs the unique index).
      SELECT cr.uniqueid, cr.file, cr.started_at, cr.ended_at, cr.dialed_last8,
             te.user_id AS rec_agent
      FROM call_recordings cr
      LEFT JOIN telephony_extensions te ON te.extension = cr.ext
      WHERE cr.call_log_id IS NULL
        AND cr.file IS NOT NULL
        AND cr.ended_at IS NOT NULL
        AND cr.ended_at > now() - make_interval(hours => _lookback_hours)
        AND NOT EXISTS (SELECT 1 FROM call_logs x WHERE x.recording_uniqueid = cr.uniqueid)
    ),
    cand AS (
      SELECT r.uniqueid, r.file, cl.id AS call_id,
        ( LEAST(extract(epoch FROM r.ended_at),
                extract(epoch FROM coalesce(cl.ended_at, cl.connected_at, cl.started_at, cl.created_at)))
          - GREATEST(extract(epoch FROM r.started_at),
                     extract(epoch FROM coalesce(cl.connected_at, cl.started_at, cl.created_at))) ) AS overlap,
        abs( extract(epoch FROM r.ended_at)
             - extract(epoch FROM coalesce(cl.ended_at, cl.connected_at, cl.started_at, cl.created_at)) ) AS end_dist
      FROM rec r
      JOIN call_logs cl
        ON right(regexp_replace(cl.customer_phone, '\D', '', 'g'), 8) = r.dialed_last8
       AND cl.recording_uniqueid IS NULL
       AND cl.recording_file IS NULL
       AND (cl.connected_at IS NOT NULL OR cl.talk_seconds > 0)
       AND cl.created_at > now() - make_interval(hours => _lookback_hours + 24)
      -- agent gate: skip only when BOTH sides know the agent and they differ.
      WHERE (r.rec_agent IS NULL OR cl.agent_id IS NULL OR r.rec_agent = cl.agent_id)
    ),
    scored AS (
      -- keep true overlaps, or end-anchored matches within 20 min (clock skew).
      SELECT * FROM cand WHERE overlap > 0 OR end_dist <= 1200
    ),
    ranked AS (
      SELECT uniqueid, file, call_id,
        count(*) OVER (PARTITION BY uniqueid) AS n_calls_for_rec,
        count(*) OVER (PARTITION BY call_id)  AS n_recs_for_call
      FROM scored
    )
    SELECT uniqueid, file, call_id
    FROM ranked
    WHERE n_calls_for_rec = 1 AND n_recs_for_call = 1  -- unambiguous 1:1 only
  LOOP
    BEGIN
      -- Only stamp still-unlinked rows, so a concurrent webhook link is never
      -- clobbered. Recording side is stamped only if the call side took.
      UPDATE call_logs
         SET recording_uniqueid = _r.uniqueid, recording_file = _r.file
       WHERE id = _r.call_id
         AND recording_uniqueid IS NULL
         AND recording_file IS NULL;
      IF FOUND THEN
        UPDATE call_recordings
           SET call_log_id = _r.call_id
         WHERE uniqueid = _r.uniqueid
           AND call_log_id IS NULL;
        _linked := _linked + 1;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- a concurrent writer just linked this recording/call — skip, no harm.
      CONTINUE;
    END;
  END LOOP;
  RETURN _linked;
END;
$fn$;

-- Idempotent: replace any previous schedule with the same name.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-recording-links') THEN
    PERFORM cron.unschedule('reconcile-recording-links');
  END IF;
END
$cron$;

-- Every 10 minutes. Cheap: only touches currently-unlinked, recent rows.
SELECT cron.schedule(
  'reconcile-recording-links',
  '*/10 * * * *',
  $job$SELECT public.reconcile_recording_links(12);$job$
);
