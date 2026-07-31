-- SECURITY: stop anon/authenticated from executing maintenance & mutation RPCs.
--
-- Supabase's default `GRANT EXECUTE ON ALL FUNCTIONS ... TO anon, authenticated`
-- left a set of SECURITY DEFINER functions callable straight from PostgREST by
-- the public. None leak data, but several are heavy or state-changing:
--
--   recompute_all_segments()      — loops over EVERY customer phone → a trivial
--                                    unauthenticated DoS lever (verified: anon
--                                    POST /rpc/recompute_customer_segments = 204)
--   set_segment_engine_config()   — swaps the live prediction-engine config
--   set_shadow_engine()           — toggles config + schedules cron jobs
--   sync_segment_lists_from_config, recompute_*_v4, segment_engine_diff, …
--   the expire/escalate/cleanup/reconcile maintenance helpers
--
-- These are meant to run only from the edge function (service_role) and pg_cron.
-- service_role keeps its own grant, so nothing server-side changes.
--
-- DELIBERATELY NOT TOUCHED (must stay executable):
--   has_role / is_admin_or_manager / is_internal_staff  — referenced inside RLS
--     policy expressions; revoking could break RLS evaluation.
--   get_my_permissions / get_my_affiliate_id / get_my_role / check_phone_duplicates
--     / cleanup_expired_order_locks / get_active_segment_engine /
--     get_segment_engine_config  — called directly by the browser or internally
--     guarded (self-scoped), so they remain available to authenticated users.
--   trigger functions (tg_*/trg_*/*_set_*/generate_*/handle_new_user) — invoked
--     by the trigger machinery, not user-callable in any meaningful way.

DO $$
DECLARE
  r record;
  _names text[] := ARRAY[
    'recompute_all_segments','recompute_all_segments_v4',
    'recompute_customer_segments','recompute_customer_segments_v4',
    'set_segment_engine_config','set_shadow_engine','sync_segment_lists_from_config',
    'segment_engine_diff','segment_engine_controls_status',
    'cleanup_expired_active_call_views','count_expired_personal_list_holds',
    'escalate_expired_personal_list_holds','expire_call_again_window',
    'reconcile_recording_links','admin_grant_all_roles','recompute_all_segments'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(_names)
  LOOP
    -- FROM PUBLIC too: Postgres grants EXECUTE to PUBLIC on every new function
    -- by default, and PUBLIC includes anon — revoking only anon/authenticated
    -- leaves that default grant in place (this is why recompute_customer_segments
    -- was still reachable after the first pass).
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    RAISE NOTICE 'revoked EXECUTE from PUBLIC/anon/authenticated on %', r.sig;
  END LOOP;
END $$;
