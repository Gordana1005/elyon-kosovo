-- SECURITY FIX (2026-07-22) — round two of the affiliate hard-wall lockdown.
--
-- 20260802000200 closed five tables that any authenticated login could read
-- (call_logs, customer_profiles, products, app_settings, courier_offices).
-- A full audit of pg_policies found TEN more still open with
-- `USING (true)` or `USING (auth.uid() IS NOT NULL)`:
--
--   call_scripts (14 rows)             our sales scripts in EN/BG/SQ
--   prediction_segment_lists (60)      our segmentation strategy
--   courier_rates (4)                  negotiated shipping costs
--   segment_engine_config (1)          the prediction-engine ruleset
--   active_call_views (2)              live call activity
--   suppliers / prediction_lists / shift_templates / order_locks (0 today)
--   bg_settlements (5495)              public postal reference — locked for consistency
--
-- Affiliates hold a REAL Supabase login (app_role 'affiliate'), so they can
-- query PostgREST directly with their own JWT and bypass the edge function's
-- hard wall entirely. That is exactly the vector 20260802000200 described.
--
-- Fix: reuse the SAME predicate that migration introduced —
-- public.is_internal_staff(uuid) = "has at least one role that is not
-- 'affiliate'". Do not invent a second predicate.
--
-- Safe because:
--   * every server path to these tables uses the service-role client (bypasses RLS),
--   * each table keeps its existing admin/manager ALL policies untouched,
--   * agents remain internal staff and keep read access,
--   * the only frontend table read directly is order_locks, on /orders,
--     which is admin/manager-only,
--   * the affiliate portal reads nothing directly — it goes through the edge fn.
--
-- Recreated as TO authenticated (never `public`, which includes anon).

-- ── call_scripts ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone authenticated can view call scripts" ON public.call_scripts;
CREATE POLICY "Internal staff can view call scripts" ON public.call_scripts
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── prediction_segment_lists ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone authenticated can view segment lists" ON public.prediction_segment_lists;
CREATE POLICY "Internal staff can view segment lists" ON public.prediction_segment_lists
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── courier_rates ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone authenticated can read courier rates" ON public.courier_rates;
CREATE POLICY "Internal staff can read courier rates" ON public.courier_rates
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── segment_engine_config ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can read segment_engine_config" ON public.segment_engine_config;
CREATE POLICY "Internal staff can read segment_engine_config" ON public.segment_engine_config
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── active_call_views ────────────────────────────────────────────────────────
-- ("Agents manage own views" ALL policy is left intact.)
DROP POLICY IF EXISTS "Authenticated can read active views" ON public.active_call_views;
CREATE POLICY "Internal staff can read active views" ON public.active_call_views
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── order_locks ──────────────────────────────────────────────────────────────
-- (own-row INSERT/DELETE policies are left intact; /orders is admin/mgr only.)
DROP POLICY IF EXISTS "Authenticated can view order locks" ON public.order_locks;
CREATE POLICY "Internal staff can view order locks" ON public.order_locks
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── prediction_lists ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agents can view prediction lists" ON public.prediction_lists;
CREATE POLICY "Internal staff can view prediction lists" ON public.prediction_lists
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── shift_templates ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can view shift templates" ON public.shift_templates;
CREATE POLICY "Internal staff can view shift templates" ON public.shift_templates
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── suppliers ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can view suppliers" ON public.suppliers;
CREATE POLICY "Internal staff can view suppliers" ON public.suppliers
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

-- ── bg_settlements ───────────────────────────────────────────────────────────
-- Public postal reference data (harmless), but there is no reason for an
-- external partner login to enumerate 5,495 Bulgarian settlements either.
DROP POLICY IF EXISTS "Authenticated can read settlements" ON public.bg_settlements;
CREATE POLICY "Internal staff can read settlements" ON public.bg_settlements
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));
