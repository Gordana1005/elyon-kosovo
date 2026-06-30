-- ============================================================================
-- ENGINE v4 CUTOVER — make the config-driven engine LIVE (2026-06-26)
-- ============================================================================
-- ⚠️ DO NOT APPLY until the operator has watched shadow mode and is satisfied:
--      node scripts/segment-engine-parity.mjs   → review the diff
--      node scripts/audit-segments-integrity.mjs → 12/12 (engine still v3_4)
--    Cutover is reversible (see the ROLLBACK block at the bottom).
--
-- What this does:
--   1. Preserves the live v3.4 body as recompute_customer_segments_v3_4 (rollback).
--   2. Builds the LIVE v4 function FROM the already-validated shadow function via
--      pg_get_functiondef + a table-name swap (shadow → real). No hand-copying —
--      the live engine is byte-identical to what shadow produced, just writing the
--      real prediction_segment_members table. The order-triggers and the nightly
--      cron already call recompute_customer_segments / recompute_all_segments, so
--      they pick up v4 automatically.
--   3. Swaps the data: backs up the live members, then loads the validated shadow
--      snapshot into the real table so live == the previewed state instantly.
--   4. Flips active_engine='v4' (turns on sync orphan-cleanup) and repoints the
--      config-save RPC to recompute the REAL table.
--   5. Stops the shadow nightly job.
-- ============================================================================

BEGIN;

-- 1. Keep v3.4 for rollback.
ALTER FUNCTION public.recompute_customer_segments(text) RENAME TO recompute_customer_segments_v3_4;

-- 2. Create the LIVE v4 from the proven shadow function (retarget to real table).
DO $cut$
DECLARE
  src TEXT;
BEGIN
  src := pg_get_functiondef('public.recompute_customer_segments_v4(text)'::regprocedure);
  src := replace(src, 'prediction_segment_members_shadow', 'prediction_segment_members');
  src := replace(src, 'recompute_customer_segments_v4(', 'recompute_customer_segments(');
  EXECUTE src;
END
$cut$;

GRANT EXECUTE ON FUNCTION public.recompute_customer_segments(text) TO authenticated;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS
'engine v4 LIVE (cutover 2026-06-26): config-driven classifier writing the real prediction_segment_members table. Generated from the validated shadow function recompute_customer_segments_v4 (identical logic, real table). Reads thresholds from segment_engine_config. v3.4 retained as recompute_customer_segments_v3_4 for rollback.';

-- 3. Swap ONLY engine-managed memberships: back up live, then replace the
-- engine-managed rows with the validated shadow snapshot. The externally-imported
-- static lists (FULL MONAD LIST, Cancelled Pendings) are NOT in shadow and must be
-- preserved — so we delete/insert only is_static=false lists plus the additive
-- static lists the engine writes (Trashed, Due to Reorder).
DROP TABLE IF EXISTS public.prediction_segment_members_pre_v4_backup;
CREATE TABLE public.prediction_segment_members_pre_v4_backup AS
  SELECT * FROM public.prediction_segment_members;

DELETE FROM public.prediction_segment_members m
USING public.prediction_segment_lists l
WHERE m.list_id = l.id
  AND (l.is_static = false OR l.name IN ('Trashed', 'Due to Reorder'));

INSERT INTO public.prediction_segment_members
  SELECT s.* FROM public.prediction_segment_members_shadow s
  JOIN public.prediction_segment_lists l ON l.id = s.list_id
  WHERE (l.is_static = false OR l.name IN ('Trashed', 'Due to Reorder'));

-- 4. Flip the engine + repoint config-save to the real table.
UPDATE public.segment_engine_config SET active_engine = 'v4' WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.set_segment_engine_config(_config JSONB, _note TEXT, _actor UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_engine TEXT;
  v_ver INT;
BEGIN
  SELECT active_engine INTO v_engine FROM public.segment_engine_config WHERE is_active = true LIMIT 1;
  v_engine := COALESCE(v_engine, 'v4');
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_ver FROM public.segment_engine_config;

  UPDATE public.segment_engine_config SET is_active = false WHERE is_active = true;
  INSERT INTO public.segment_engine_config (version, config, active_engine, is_active, note, created_by)
  VALUES (v_ver, _config, v_engine, true, COALESCE(_note, ''), _actor);

  PERFORM public.sync_segment_lists_from_config();  -- now ALSO deactivates orphan lists (active_engine='v4')
  PERFORM public.recompute_all_segments();          -- recompute the REAL table
  RETURN v_ver;
END;
$$;

REVOKE ALL ON FUNCTION public.set_segment_engine_config(JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_segment_engine_config(JSONB, TEXT, UUID) TO service_role;

COMMIT;

-- 5. Stop the shadow job (live cron `nightly-segment-recompute` now runs v4).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute-shadow') THEN
    PERFORM cron.unschedule('nightly-segment-recompute-shadow');
  END IF;
END
$cron$;

-- One clean pass with the now-live v4 (also runs sync orphan-cleanup).
SELECT public.sync_segment_lists_from_config();
SELECT public.recompute_all_segments();

-- ============================================================================
-- ROLLBACK (run manually if needed — restores v3.4 instantly):
--   BEGIN;
--   DROP FUNCTION public.recompute_customer_segments(text);
--   ALTER FUNCTION public.recompute_customer_segments_v3_4(text)
--     RENAME TO recompute_customer_segments;
--   TRUNCATE public.prediction_segment_members;
--   INSERT INTO public.prediction_segment_members
--     SELECT * FROM public.prediction_segment_members_pre_v4_backup;
--   UPDATE public.segment_engine_config SET active_engine = 'v3_4' WHERE is_active = true;
--   COMMIT;
--   -- (re-add the shadow cron from 20260726000000 if you want to keep comparing)
-- ============================================================================
