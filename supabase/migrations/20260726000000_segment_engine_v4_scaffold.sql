-- ============================================================================
-- ENGINE v4 SCAFFOLD — shadow-mode coexistence (2026-06-26)
-- ============================================================================
-- GOAL: make the prediction-list classifier operator-editable from the UI
-- (no more SQL+migration+deploy per list change) WITHOUT touching the live
-- engine. This migration is ZERO production impact:
--
--   * It does NOT modify recompute_customer_segments (the live v3.4 engine) nor
--     its triggers, nor the real prediction_segment_members table.
--   * It adds a new config store, a SHADOW members table, and a v4 engine that
--     writes ONLY to the shadow table on its own nightly job. The operator can
--     then compare v4 vs live in production (scripts/segment-engine-parity.mjs)
--     for as long as they want before any cutover.
--
-- In this scaffold step v4 is a FAITHFUL COPY of v3.4 (identical logic, just
-- retargeted to the shadow table). That makes the parity diff trivially
-- provable (≈0). Phase 1 then makes v4 read its thresholds from
-- segment_engine_config; Phase 2 adds the package-based "Due to Reorder" list.
-- Cutover is a separate, later migration that flips active_engine -> 'v4'.
-- ============================================================================

BEGIN;

-- ── 1. Versioned config store ───────────────────────────────────────────────
-- One row per saved version; exactly one is_active=true. The active row carries
-- both the editable thresholds (config jsonb) and which engine currently feeds
-- the REAL lists (active_engine). Seeded with TODAY'S EXACT v3.4 values and
-- active_engine='v3_4' so nothing changes until the operator edits + cuts over.
CREATE TABLE IF NOT EXISTS public.segment_engine_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version       INT  NOT NULL,
  config        JSONB NOT NULL,
  active_engine TEXT NOT NULL DEFAULT 'v3_4' CHECK (active_engine IN ('v3_4', 'v4')),
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Only one active config at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_segment_engine_config_active
  ON public.segment_engine_config (is_active) WHERE is_active = true;

ALTER TABLE public.segment_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read segment_engine_config"
  ON public.segment_engine_config FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage segment_engine_config"
  ON public.segment_engine_config FOR ALL
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));

-- Seed v1 = the exact thresholds hard-coded in engine v3.4. Built with
-- jsonb_build_* (and chr(8804) for the U+2264 value label) so the file carries
-- no multibyte literal — the label must byte-match the existing list-row names.
INSERT INTO public.segment_engine_config (version, config, active_engine, is_active, note)
SELECT
  1,
  jsonb_build_object(
    'recency_bands', jsonb_build_array(
      jsonb_build_object('label', 'NEWCOMERS', 'max_days', 21, 'holding_pen', true, 'strip_assignment', true),
      jsonb_build_object('label', '21d',   'max_days', 57),
      jsonb_build_object('label', '57d',   'max_days', 120),
      jsonb_build_object('label', '4-6m',  'max_days', 180),
      jsonb_build_object('label', '6-12m', 'max_days', 365),
      jsonb_build_object('label', '1-2yr', 'max_days', 730),
      jsonb_build_object('label', '2yr+',  'max_days', null)
    ),
    'value_bands', jsonb_build_array(
      jsonb_build_object('label', chr(8804) || '26', 'max_price', 26),
      jsonb_build_object('label', '26+', 'max_price', null)
    ),
    'frequency_bands', jsonb_build_array(
      jsonb_build_object('label', '(1-3 orders)', 'min_count', 1),
      jsonb_build_object('label', '(3+ orders)',  'min_count', 3),
      jsonb_build_object('label', '(5+ orders)',  'min_count', 5),
      jsonb_build_object('label', '(7+ orders)',  'min_count', 7)
    ),
    'windows', jsonb_build_object(
      'current_cancels_days', 14,
      'never_converted_recent_days', 180
    ),
    -- Phase 2 fills these in; disabled in the scaffold so v4 == v3.4 exactly.
    'reorder', jsonb_build_object(
      'enabled', false,
      'default_days_of_supply_per_unit', 15,
      'buffer_days', 8,
      'list_name', 'Due to Reorder'
    )
  ),
  'v3_4',
  true,
  'Seed = exact engine v3.4 thresholds (scaffold; live engine still v3.4).'
WHERE NOT EXISTS (SELECT 1 FROM public.segment_engine_config);

-- Returns the active config jsonb (Phase 1's v4 reads its thresholds from here).
CREATE OR REPLACE FUNCTION public.get_segment_engine_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT config FROM public.segment_engine_config WHERE is_active = true LIMIT 1;
$$;

-- Which engine currently feeds the REAL lists ('v3_4' | 'v4'). The cutover
-- migration and the dispatcher (added at cutover) consult this.
CREATE OR REPLACE FUNCTION public.get_active_segment_engine()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT active_engine FROM public.segment_engine_config WHERE is_active = true LIMIT 1), 'v3_4');
$$;

-- ── 2. Shadow members table ─────────────────────────────────────────────────
-- A faithful mirror of prediction_segment_members (same columns/defaults/PK/
-- indexes, no FKs, no carry of the CASCADE coupling) that v4 writes to. RLS is
-- enabled with NO policies so only the service-role (edge fn admin client) can
-- read it — agents never see shadow data.
CREATE TABLE IF NOT EXISTS public.prediction_segment_members_shadow
  (LIKE public.prediction_segment_members INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);

ALTER TABLE public.prediction_segment_members_shadow ENABLE ROW LEVEL SECURITY;

-- ── 3. Engine v4 (scaffold = faithful copy of v3.4, retargeted to shadow) ────
-- IDENTICAL logic to recompute_customer_segments (v3.4); the ONLY change is the
-- member table (prediction_segment_members_shadow) so it can run side-by-side
-- without touching live lists. Do NOT edit business rules here in the scaffold —
-- Phase 1 introduces the config-driven version in its own migration.
CREATE OR REPLACE FUNCTION public.recompute_customer_segments_v4(_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name TEXT;
  v_paid_count INT;
  v_lifetime NUMERIC;
  v_last_paid_at TIMESTAMPTZ;
  v_last_paid_price NUMERIC;

  v_disp_order_id UUID;
  v_disp_at TIMESTAMPTZ;
  v_disp_price NUMERIC;

  v_last_cancelled_order_id UUID;
  v_last_cancelled_at TIMESTAMPTZ;
  v_last_cancelled_price NUMERIC;

  v_last_returned_order_id UUID;
  v_last_returned_at TIMESTAMPTZ;
  v_last_returned_price NUMERIC;
  v_newest_is_return BOOLEAN := false;
  v_returns_list_id UUID;

  v_newest_order_id UUID;
  v_newest_order_at TIMESTAMPTZ;
  v_newest_order_price NUMERIC;
  v_newest_order_status TEXT;
  v_newest_order_reason TEXT;
  v_newest_is_wrong_trash BOOLEAN := false;
  v_trashed_list_id UUID;

  v_has_inflight BOOLEAN := false;

  v_days NUMERIC;
  v_recency_bucket TEXT;
  v_value_bucket TEXT;
  v_freq_bucket TEXT;
  v_target_list_name TEXT;
  v_target_list_id UUID;
  v_target_is_cancel BOOLEAN := false;

  v_avg_package_price NUMERIC;

  v_trigger_order_id UUID;
  v_trigger_at TIMESTAMPTZ;
  v_trigger_price NUMERIC;

  c_assigned_agent_id UUID;
  c_assigned_agent_name TEXT;
  c_assigned_at TIMESTAMPTZ;
  c_last_call_at TIMESTAMPTZ;
  c_last_call_outcome TEXT;
  c_in_call_again_until TIMESTAMPTZ;
  c_call_again_since TIMESTAMPTZ;
  c_is_completed BOOLEAN;
  c_prev_last_paid_at TIMESTAMPTZ;
BEGIN
  IF _phone IS NULL OR _phone = '' THEN RETURN; END IF;

  SELECT MAX(customer_name) FILTER (WHERE source_type IS DISTINCT FROM 'monadon_legacy'),
         COUNT(*)            FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'),
         COALESCE(SUM(price) FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'), 0)
    INTO v_customer_name, v_paid_count, v_lifetime
    FROM public.orders
   WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members_shadow m
    USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  SELECT created_at, price INTO v_last_paid_at, v_last_paid_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'paid'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  SELECT id, created_at, price INTO v_disp_order_id, v_disp_at, v_disp_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'paid' AND price > 0
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;
  IF v_disp_order_id IS NULL THEN
    SELECT id, created_at, price INTO v_disp_order_id, v_disp_at, v_disp_price
    FROM public.orders
    WHERE customer_phone = _phone AND status = 'paid'
      AND source_type IS DISTINCT FROM 'monadon_legacy'
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  SELECT id, created_at, price INTO v_last_cancelled_order_id, v_last_cancelled_at, v_last_cancelled_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'cancelled'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  SELECT id, created_at, price INTO v_last_returned_order_id, v_last_returned_at, v_last_returned_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'returned'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  IF v_last_returned_at IS NOT NULL THEN
    v_newest_is_return := NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE customer_phone = _phone
        AND source_type IS DISTINCT FROM 'monadon_legacy'
        AND created_at > v_last_returned_at
    );
  END IF;

  SELECT id, created_at, price, status, trash_reason
    INTO v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_status, v_newest_order_reason
  FROM public.orders
  WHERE customer_phone = _phone
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  v_newest_is_wrong_trash := (v_newest_order_status = 'trashed'
                              AND v_newest_order_reason IN ('wrong_number', 'wrong_person'));

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone
      AND status IN ('pending','take','call_again','confirmed','shipped','delivered')
      AND source_type IS DISTINCT FROM 'monadon_legacy'
  ) INTO v_has_inflight;

  IF v_paid_count >= 7 THEN v_freq_bucket := '(7+ orders)';
  ELSIF v_paid_count >= 5 THEN v_freq_bucket := '(5+ orders)';
  ELSIF v_paid_count >= 3 THEN v_freq_bucket := '(3+ orders)';
  ELSE v_freq_bucket := '(1-3 orders)';
  END IF;

  IF v_newest_is_wrong_trash THEN
    v_target_list_name := NULL;
  ELSIF v_paid_count = 0 AND v_has_inflight THEN
    v_target_list_name := NULL;
  ELSIF v_newest_is_return AND v_paid_count = 0 THEN
    v_target_list_name := NULL;
  ELSIF (NOT v_newest_is_return)
     AND v_last_cancelled_at IS NOT NULL
     AND (v_last_paid_at IS NULL OR v_last_cancelled_at > v_last_paid_at)
     AND (now() - v_last_cancelled_at) < interval '14 days' THEN
    v_target_list_name := 'Current Cancels';
    v_target_is_cancel := true;
  ELSIF v_paid_count = 0 THEN
    v_target_is_cancel := true;
    IF v_last_cancelled_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (now() - v_last_cancelled_at)) / 86400.0 <= 180 THEN
      v_target_list_name := 'Never-Converted Recent';
    ELSE
      v_target_list_name := 'Never-Converted Old';
    END IF;
  ELSIF v_last_paid_at IS NOT NULL THEN
    v_days := EXTRACT(EPOCH FROM (now() - v_last_paid_at)) / 86400.0;

    IF v_days < 21 THEN
      v_target_list_name := 'NEWCOMERS ' || v_freq_bucket;
    ELSE
      IF v_days <= 57 THEN v_recency_bucket := '21d';
      ELSIF v_days <= 120 THEN v_recency_bucket := '57d';
      ELSIF v_days <= 180 THEN v_recency_bucket := '4-6m';
      ELSIF v_days <= 365 THEN v_recency_bucket := '6-12m';
      ELSIF v_days <= 730 THEN v_recency_bucket := '1-2yr';
      ELSE v_recency_bucket := '2yr+';
      END IF;

      v_value_bucket := CASE WHEN COALESCE(v_last_paid_price, 0) <= 26
                             THEN chr(8804) || '26'
                             ELSE '26+' END;

      v_target_list_name := v_recency_bucket || ' ' || v_value_bucket || ' ' || v_freq_bucket;
    END IF;
  END IF;

  IF v_target_list_name IS NOT NULL THEN
    SELECT id INTO v_target_list_id
    FROM public.prediction_segment_lists
    WHERE name = v_target_list_name AND is_active = true AND is_static = false;
  END IF;

  IF v_target_is_cancel THEN
    v_trigger_order_id := v_last_cancelled_order_id;
    v_trigger_at       := v_last_cancelled_at;
    v_trigger_price    := v_last_cancelled_price;
  ELSE
    v_trigger_order_id := v_disp_order_id;
    v_trigger_at       := v_disp_at;
    v_trigger_price    := v_disp_price;
  END IF;

  SELECT m.assigned_agent_id, m.assigned_agent_name, m.assigned_at,
         m.last_call_at, m.last_call_outcome, m.in_call_again_until,
         m.call_again_since, m.is_completed, m.last_paid_at
    INTO c_assigned_agent_id, c_assigned_agent_name, c_assigned_at,
         c_last_call_at, c_last_call_outcome, c_in_call_again_until,
         c_call_again_since, c_is_completed, c_prev_last_paid_at
  FROM public.prediction_segment_members_shadow m
  JOIN public.prediction_segment_lists l ON l.id = m.list_id AND l.is_static = false
   AND l.name <> 'Current Returns'
  WHERE m.customer_phone = _phone
  ORDER BY (m.assigned_agent_id IS NOT NULL) DESC, m.updated_at DESC
  LIMIT 1;

  IF v_last_paid_at IS NOT NULL
     AND (c_prev_last_paid_at IS NULL OR v_last_paid_at > c_prev_last_paid_at) THEN
    c_is_completed := false;
    c_in_call_again_until := NULL;
    c_call_again_since := NULL;
  END IF;

  IF v_target_list_name = 'Current Cancels' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
    c_is_completed := false;
  END IF;

  IF v_target_list_name LIKE 'NEWCOMERS%' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
  END IF;

  DELETE FROM public.prediction_segment_members_shadow m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false
    AND l.name <> 'Current Returns'
    AND (v_target_list_id IS NULL OR m.list_id <> v_target_list_id);

  IF v_target_list_id IS NOT NULL THEN
    INSERT INTO public.prediction_segment_members_shadow
      (list_id, customer_phone, customer_name,
       trigger_order_id, trigger_event_at, trigger_price,
       last_paid_at, paid_count, lifetime_value, avg_package_price,
       assigned_agent_id, assigned_agent_name, assigned_at,
       last_call_at, last_call_outcome, in_call_again_until, call_again_since,
       is_completed, updated_at)
    VALUES
      (v_target_list_id, _phone, v_customer_name,
       v_trigger_order_id, v_trigger_at, v_trigger_price,
       v_last_paid_at, v_paid_count, v_lifetime, v_avg_package_price,
       c_assigned_agent_id, c_assigned_agent_name, c_assigned_at,
       c_last_call_at, c_last_call_outcome, c_in_call_again_until, c_call_again_since,
       COALESCE(c_is_completed, false), now())
    ON CONFLICT (list_id, customer_phone) DO UPDATE SET
      customer_name    = EXCLUDED.customer_name,
      trigger_order_id = EXCLUDED.trigger_order_id,
      trigger_event_at = EXCLUDED.trigger_event_at,
      trigger_price    = EXCLUDED.trigger_price,
      is_completed = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members_shadow.last_paid_at
                          THEN false ELSE prediction_segment_members_shadow.is_completed END,
      in_call_again_until = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members_shadow.last_paid_at
                                 THEN NULL ELSE prediction_segment_members_shadow.in_call_again_until END,
      call_again_since = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members_shadow.last_paid_at
                              THEN NULL ELSE prediction_segment_members_shadow.call_again_since END,
      last_paid_at      = EXCLUDED.last_paid_at,
      paid_count        = EXCLUDED.paid_count,
      lifetime_value    = EXCLUDED.lifetime_value,
      avg_package_price = EXCLUDED.avg_package_price,
      updated_at        = now();
  END IF;

  -- ADDITIVE "Current Returns"
  SELECT id INTO v_returns_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Current Returns' AND is_active = true;

  IF v_returns_list_id IS NOT NULL THEN
    IF v_newest_is_return THEN
      INSERT INTO public.prediction_segment_members_shadow
        (list_id, customer_phone, customer_name,
         trigger_order_id, trigger_event_at, trigger_price,
         last_paid_at, paid_count, lifetime_value, avg_package_price,
         assigned_agent_id, assigned_agent_name, assigned_at,
         is_completed, updated_at)
      VALUES
        (v_returns_list_id, _phone, v_customer_name,
         v_last_returned_order_id, v_last_returned_at, v_last_returned_price,
         v_last_paid_at, v_paid_count, v_lifetime, v_avg_package_price,
         NULL, NULL, NULL, false, now())
      ON CONFLICT (list_id, customer_phone) DO UPDATE SET
        customer_name     = EXCLUDED.customer_name,
        trigger_order_id  = EXCLUDED.trigger_order_id,
        trigger_event_at  = EXCLUDED.trigger_event_at,
        trigger_price     = EXCLUDED.trigger_price,
        last_paid_at      = EXCLUDED.last_paid_at,
        paid_count        = EXCLUDED.paid_count,
        lifetime_value    = EXCLUDED.lifetime_value,
        avg_package_price = EXCLUDED.avg_package_price,
        updated_at        = now();
    ELSE
      DELETE FROM public.prediction_segment_members_shadow
      WHERE list_id = v_returns_list_id AND customer_phone = _phone;
    END IF;
  END IF;

  -- ADDITIVE "Trashed"
  SELECT id INTO v_trashed_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Trashed' AND is_active = true;

  IF v_trashed_list_id IS NOT NULL THEN
    IF v_newest_is_wrong_trash THEN
      INSERT INTO public.prediction_segment_members_shadow
        (list_id, customer_phone, customer_name,
         trigger_order_id, trigger_event_at, trigger_price,
         last_paid_at, paid_count, lifetime_value, avg_package_price,
         assigned_agent_id, assigned_agent_name, assigned_at,
         last_call_outcome, is_completed, updated_at)
      VALUES
        (v_trashed_list_id, _phone, v_customer_name,
         v_newest_order_id, v_newest_order_at, v_newest_order_price,
         v_last_paid_at, v_paid_count, v_lifetime, v_avg_package_price,
         NULL, NULL, NULL, 'trash', false, now())
      ON CONFLICT (list_id, customer_phone) DO UPDATE SET
        customer_name     = EXCLUDED.customer_name,
        trigger_order_id  = EXCLUDED.trigger_order_id,
        trigger_event_at  = EXCLUDED.trigger_event_at,
        trigger_price     = EXCLUDED.trigger_price,
        last_paid_at      = EXCLUDED.last_paid_at,
        paid_count        = EXCLUDED.paid_count,
        lifetime_value    = EXCLUDED.lifetime_value,
        avg_package_price = EXCLUDED.avg_package_price,
        updated_at        = now();
    ELSE
      DELETE FROM public.prediction_segment_members_shadow
      WHERE list_id = v_trashed_list_id AND customer_phone = _phone;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments_v4(text) IS
'engine v4 SCAFFOLD 2026-06-26: faithful copy of v3.4 retargeted to prediction_segment_members_shadow. Phase 1 makes it config-driven (reads get_segment_engine_config); Phase 2 adds the additive package-based "Due to Reorder" list. Live engine remains recompute_customer_segments (v3.4) until the cutover migration flips active_engine.';

GRANT EXECUTE ON FUNCTION public.recompute_customer_segments_v4(TEXT) TO authenticated;

-- Bulk shadow recompute (mirrors recompute_all_segments).
CREATE OR REPLACE FUNCTION public.recompute_all_segments_v4()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT := 0;
  v_phone TEXT;
BEGIN
  FOR v_phone IN
    SELECT DISTINCT customer_phone FROM public.orders WHERE customer_phone <> ''
  LOOP
    PERFORM public.recompute_customer_segments_v4(v_phone);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_all_segments_v4() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_all_segments_v4() TO service_role;

COMMIT;

-- ── 4. Shadow nightly job ───────────────────────────────────────────────────
-- Runs 30 min after the live nightly recompute so both don't contend. This only
-- writes the shadow table; the live engine + its own cron are untouched.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-segment-recompute-shadow') THEN
    PERFORM cron.unschedule('nightly-segment-recompute-shadow');
  END IF;
END
$cron$;

SELECT cron.schedule(
  'nightly-segment-recompute-shadow',
  '30 0 * * *',
  $job$SELECT public.recompute_all_segments_v4();$job$
);

-- Populate the shadow table once now so the parity diff can run immediately.
SELECT public.recompute_all_segments_v4();
