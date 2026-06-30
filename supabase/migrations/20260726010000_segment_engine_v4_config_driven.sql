-- ============================================================================
-- ENGINE v4 — config-driven classifier (Phase 1) — 2026-06-26
-- ============================================================================
-- Replaces the scaffold's faithful-copy body of recompute_customer_segments_v4
-- with one that reads its thresholds from segment_engine_config (the recency
-- day-bands, value brackets, frequency tiers, and the Current Cancels /
-- Never-Converted windows) instead of hard-coding them. Still writes ONLY to
-- the shadow table; the live engine (recompute_customer_segments, v3.4) is
-- untouched. Seeded config == exact v3.4 values, so the parity diff stays 0.
--
-- Also adds sync_segment_lists_from_config(): creates any list rows the config
-- needs so members have a home. IMPORTANT SAFETY RULE: while the live engine is
-- still v3.4 it ONLY ADDS lists — it never deactivates "orphan" lists, because
-- the live v3.4 engine still targets them by name; deactivating one would make
-- v3.4 nuke its members. Orphan cleanup only switches on once active_engine='v4'
-- (i.e. after cutover).
-- ============================================================================

BEGIN;

-- Package-based recall needs a per-product supply length. Default 15 days = the
-- common 30-capsule pack; a "4-pack" product is encoded as 60, etc. Added here
-- (not Phase 2) so the column always exists before v4's reorder block can run.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS days_of_supply_per_unit INT NOT NULL DEFAULT 15;

CREATE OR REPLACE FUNCTION public.recompute_customer_segments_v4(_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg JSONB;
  v_b RECORD;
  v_max NUMERIC;
  v_holding BOOLEAN;
  v_mc INT;
  v_best INT;
  v_cancels_days INT;
  v_nc_recent_days INT;

  -- package-based "Due to Reorder" (engine v4)
  v_reorder_enabled BOOLEAN;
  v_reorder_buffer INT;
  v_reorder_default_supply INT;
  v_reorder_agg TEXT;
  v_reorder_list_name TEXT;
  v_reorder_list_id UUID;
  v_supply_days NUMERIC;
  v_runs_out_on TIMESTAMPTZ;
  v_call_from TIMESTAMPTZ;

  v_customer_name TEXT;
  v_paid_count INT;
  v_lifetime NUMERIC;
  v_last_paid_id UUID;
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
  v_recency_is_holding BOOLEAN := false;
  v_recency_strip BOOLEAN := false;
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

  v_cfg := public.get_segment_engine_config();
  v_cancels_days   := COALESCE((v_cfg->'windows'->>'current_cancels_days')::int, 14);
  v_nc_recent_days := COALESCE((v_cfg->'windows'->>'never_converted_recent_days')::int, 180);
  v_reorder_enabled        := COALESCE((v_cfg->'reorder'->>'enabled')::boolean, false);
  v_reorder_buffer         := COALESCE((v_cfg->'reorder'->>'buffer_days')::int, 8);
  v_reorder_default_supply := COALESCE((v_cfg->'reorder'->>'default_days_of_supply_per_unit')::int, 15);
  v_reorder_agg            := COALESCE(v_cfg->'reorder'->>'aggregation', 'longest');  -- 'longest' | 'earliest'
  v_reorder_list_name      := COALESCE(v_cfg->'reorder'->>'list_name', 'Due to Reorder');

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

  SELECT id, created_at, price INTO v_last_paid_id, v_last_paid_at, v_last_paid_price
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

  -- ── Frequency label (config-driven; most specific min_count wins) ──
  v_freq_bucket := NULL; v_best := -1;
  FOR v_b IN SELECT value FROM jsonb_array_elements(v_cfg->'frequency_bands') AS value LOOP
    v_mc := COALESCE((v_b.value->>'min_count')::int, 0);
    IF v_paid_count >= v_mc AND v_mc > v_best THEN
      v_best := v_mc;
      v_freq_bucket := v_b.value->>'label';
    END IF;
  END LOOP;
  IF v_freq_bucket IS NULL THEN
    v_freq_bucket := (v_cfg->'frequency_bands'->0->>'label');
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
     AND (now() - v_last_cancelled_at) < (interval '1 day' * v_cancels_days) THEN
    v_target_list_name := 'Current Cancels';
    v_target_is_cancel := true;
  ELSIF v_paid_count = 0 THEN
    v_target_is_cancel := true;
    IF v_last_cancelled_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (now() - v_last_cancelled_at)) / 86400.0 <= v_nc_recent_days THEN
      v_target_list_name := 'Never-Converted Recent';
    ELSE
      v_target_list_name := 'Never-Converted Old';
    END IF;
  ELSIF v_last_paid_at IS NOT NULL THEN
    v_days := EXTRACT(EPOCH FROM (now() - v_last_paid_at)) / 86400.0;

    -- ── Recency band (config-driven; first match wins) ──
    -- holding-pen bands (NEWCOMERS) use a strict < boundary, like v3.4; standard
    -- bands use <=; a null max_days is the open-ended catch-all (e.g. 2yr+).
    v_recency_bucket := NULL; v_recency_is_holding := false; v_recency_strip := false;
    FOR v_b IN
      SELECT value FROM jsonb_array_elements(v_cfg->'recency_bands') AS value
    LOOP
      v_holding := COALESCE((v_b.value->>'holding_pen')::boolean, false);
      IF (v_b.value->>'max_days') IS NULL THEN
        v_recency_bucket := v_b.value->>'label';
        v_recency_is_holding := v_holding;
        v_recency_strip := COALESCE((v_b.value->>'strip_assignment')::boolean, false);
        EXIT;
      END IF;
      v_max := (v_b.value->>'max_days')::numeric;
      IF (v_holding AND v_days < v_max) OR (NOT v_holding AND v_days <= v_max) THEN
        v_recency_bucket := v_b.value->>'label';
        v_recency_is_holding := v_holding;
        v_recency_strip := COALESCE((v_b.value->>'strip_assignment')::boolean, false);
        EXIT;
      END IF;
    END LOOP;

    IF v_recency_is_holding THEN
      -- NEWCOMERS-style: no value bucket in the name (holding pen).
      v_target_list_name := v_recency_bucket || ' ' || v_freq_bucket;
    ELSE
      -- ── Value band (config-driven; first match by max_price) ──
      v_value_bucket := NULL;
      FOR v_b IN SELECT value FROM jsonb_array_elements(v_cfg->'value_bands') AS value LOOP
        IF (v_b.value->>'max_price') IS NULL THEN
          v_value_bucket := v_b.value->>'label'; EXIT;
        END IF;
        IF COALESCE(v_last_paid_price, 0) <= (v_b.value->>'max_price')::numeric THEN
          v_value_bucket := v_b.value->>'label'; EXIT;
        END IF;
      END LOOP;

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

  -- Holding-pen recency bands (NEWCOMERS) strip auto-inherited assignment on entry.
  IF v_recency_strip THEN
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

  -- ADDITIVE "Current Returns" (unchanged from v3.3/v3.4)
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

  -- ADDITIVE "Trashed" (unchanged from v3.4)
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

  -- ADDITIVE "Due to Reorder" (engine v4 — package-based recall). Static list,
  -- UNASSIGNED. supply_days = Σ(qty × product days_of_supply_per_unit) over the
  -- customer's most recent paid order; we call them reorder_buffer_days BEFORE
  -- they run out. Self-cleaning: once they re-order, the new order's supply
  -- pushes runs_out_on forward and they drop out until due again. Dormant while
  -- reorder.enabled = false (the seeded default).
  SELECT id INTO v_reorder_list_id
  FROM public.prediction_segment_lists
  WHERE name = v_reorder_list_name AND is_active = true;

  IF v_reorder_list_id IS NOT NULL THEN
    v_supply_days := NULL;
    IF v_reorder_enabled AND v_last_paid_id IS NOT NULL THEN
      -- Supply per PRODUCT (packages of the same product are sequential), then
      -- aggregate ACROSS products: different products are parallel treatments, so
      -- 2×Diabetol + 2×Prostatol = 1 month (not 2). 'longest' = supplied until the
      -- last treatment runs out (MAX); 'earliest' = call when the first runs low (MIN).
      SELECT CASE WHEN v_reorder_agg = 'earliest' THEN MIN(prod_supply) ELSE MAX(prod_supply) END
        INTO v_supply_days
      FROM (
        SELECT SUM(oi.quantity * COALESCE(p.days_of_supply_per_unit, v_reorder_default_supply)) AS prod_supply
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = v_last_paid_id
        GROUP BY oi.product_id
      ) per_product;
    END IF;

    IF v_reorder_enabled AND COALESCE(v_supply_days, 0) > 0 THEN
      v_runs_out_on := v_last_paid_at + (interval '1 day' * v_supply_days);
      v_call_from   := v_runs_out_on - (interval '1 day' * v_reorder_buffer);
      IF now() >= v_call_from THEN
        INSERT INTO public.prediction_segment_members_shadow
          (list_id, customer_phone, customer_name,
           trigger_order_id, trigger_event_at, trigger_price,
           last_paid_at, paid_count, lifetime_value, avg_package_price,
           assigned_agent_id, assigned_agent_name, assigned_at,
           is_completed, updated_at)
        VALUES
          (v_reorder_list_id, _phone, v_customer_name,
           v_disp_order_id, v_disp_at, v_disp_price,
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
        WHERE list_id = v_reorder_list_id AND customer_phone = _phone;
      END IF;
    ELSE
      DELETE FROM public.prediction_segment_members_shadow
      WHERE list_id = v_reorder_list_id AND customer_phone = _phone;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments_v4(text) IS
'engine v4 config-driven 2026-06-26: reads thresholds from segment_engine_config (recency day-bands, value brackets, frequency tiers, Current Cancels & Never-Converted windows) — no hard-coded numbers. Writes prediction_segment_members_shadow only. Seeded config == exact v3.4 values so parity stays 0. All sacred behaviour preserved: one calling list/phone, carry-over, NEWCOMERS/Current Cancels assignment strip, additive Current Returns & Trashed, monadon_legacy excluded. Live engine remains recompute_customer_segments (v3.4) until cutover flips active_engine.';

-- ── List sync: make sure every list the config needs exists ─────────────────
-- ADD-only while live engine is v3.4 (deactivating a list v3.4 still targets
-- would make it nuke members). Orphan deactivation switches on at cutover
-- (active_engine='v4').
CREATE OR REPLACE FUNCTION public.sync_segment_lists_from_config()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg JSONB := public.get_segment_engine_config();
  v_r JSONB; v_v JSONB; v_f JSONB;
  v_name TEXT;
  v_expected TEXT[] := ARRAY[]::TEXT[];
  v_order INT := 1000;
BEGIN
  -- Build the full expected set of calling-list names from the matrix.
  FOR v_r IN SELECT value FROM jsonb_array_elements(v_cfg->'recency_bands') AS value LOOP
    IF COALESCE((v_r->>'holding_pen')::boolean, false) THEN
      FOR v_f IN SELECT value FROM jsonb_array_elements(v_cfg->'frequency_bands') AS value LOOP
        v_name := (v_r->>'label') || ' ' || (v_f->>'label');
        v_expected := array_append(v_expected, v_name);
      END LOOP;
    ELSE
      FOR v_v IN SELECT value FROM jsonb_array_elements(v_cfg->'value_bands') AS value LOOP
        FOR v_f IN SELECT value FROM jsonb_array_elements(v_cfg->'frequency_bands') AS value LOOP
          v_name := (v_r->>'label') || ' ' || (v_v->>'label') || ' ' || (v_f->>'label');
          v_expected := array_append(v_expected, v_name);
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  -- Insert any missing matrix lists (active, last_paid, value category).
  FOREACH v_name IN ARRAY v_expected LOOP
    INSERT INTO public.prediction_segment_lists
      (name, description, category, trigger_event, is_static, is_active, display_order)
    SELECT v_name, '', 'value', 'last_paid', false, true, v_order
    WHERE NOT EXISTS (SELECT 1 FROM public.prediction_segment_lists WHERE name = v_name);
    v_order := v_order + 1;
  END LOOP;

  -- Ensure the package-based "Due to Reorder" list exists. Modeled on "Trashed":
  -- is_static=true so the engine's exclusivity / nuclear-delete / carry-over all
  -- skip it; the engine writes it via its own additive block. The row exists even
  -- when reorder is disabled (it just stays empty).
  v_name := COALESCE(v_cfg->'reorder'->>'list_name', 'Due to Reorder');
  INSERT INTO public.prediction_segment_lists
    (name, description, category, trigger_event, is_static, is_active, display_order)
  SELECT v_name,
    'Customers due to re-order soon, based on how many packages they last bought (supply running low). Additive, UNASSIGNED — informational calling list.',
    'other', 'last_paid', true, true, 320
  WHERE NOT EXISTS (SELECT 1 FROM public.prediction_segment_lists WHERE name = v_name);

  -- Orphan cleanup — ONLY when v4 is live. Deactivates matrix lists (last_paid,
  -- non-static) that the config no longer produces, leaving the protected
  -- special/additive lists alone.
  IF public.get_active_segment_engine() = 'v4' THEN
    UPDATE public.prediction_segment_lists
    SET is_active = false
    WHERE is_static = false
      AND trigger_event = 'last_paid'
      AND name <> ALL (v_expected)
      AND name NOT IN ('Current Cancels', 'Never-Converted Recent', 'Never-Converted Old', 'Current Returns');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_segment_lists_from_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_segment_lists_from_config() TO service_role;

-- ── Atomic config save ──────────────────────────────────────────────────────
-- Deactivate the current version + insert the new active one (the partial unique
-- index allows only one is_active), preserving active_engine, then sync lists and
-- recompute the SHADOW table (v4 feeds shadow until cutover). Returns new version.
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
  v_engine := COALESCE(v_engine, 'v3_4');
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_ver FROM public.segment_engine_config;

  UPDATE public.segment_engine_config SET is_active = false WHERE is_active = true;
  INSERT INTO public.segment_engine_config (version, config, active_engine, is_active, note, created_by)
  VALUES (v_ver, _config, v_engine, true, COALESCE(_note, ''), _actor);

  PERFORM public.sync_segment_lists_from_config();
  PERFORM public.recompute_all_segments_v4();
  RETURN v_ver;
END;
$$;

REVOKE ALL ON FUNCTION public.set_segment_engine_config(JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_segment_engine_config(JSONB, TEXT, UUID) TO service_role;

-- ── Live (v3.4) vs shadow (v4) diff, per list + overall drift ───────────────
-- Scoped to ENGINE-MANAGED lists only: is_static=false plus the additive static
-- lists the engine writes (Trashed, Due to Reorder). The externally-imported
-- static lists (FULL MONAD LIST, Cancelled Pendings) are NOT written by the engine
-- and never land in shadow, so counting them would show permanent phantom drift.
CREATE OR REPLACE FUNCTION public.segment_engine_diff()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH live AS (
    SELECT list_id, count(*) c FROM public.prediction_segment_members GROUP BY list_id
  ), shadow AS (
    SELECT list_id, count(*) c FROM public.prediction_segment_members_shadow GROUP BY list_id
  )
  SELECT jsonb_build_object(
    'lists', COALESCE(jsonb_agg(jsonb_build_object(
        'list_id', l.id, 'name', l.name, 'is_static', l.is_static, 'is_active', l.is_active,
        'live', COALESCE(lv.c, 0), 'shadow', COALESCE(sh.c, 0)
      ) ORDER BY l.display_order)
      FILTER (WHERE l.is_static = false OR l.name IN ('Trashed', 'Due to Reorder')), '[]'::jsonb),
    'drift',
      (SELECT count(*) FROM (
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trashed', 'Due to Reorder')
         EXCEPT
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members_shadow m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trashed', 'Due to Reorder')) a)
      + (SELECT count(*) FROM (
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members_shadow m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trashed', 'Due to Reorder')
         EXCEPT
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trashed', 'Due to Reorder')) b),
    'live_total', (SELECT count(*) FROM public.prediction_segment_members m
       JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id WHERE l2.is_static = false OR l2.name IN ('Trashed', 'Due to Reorder')),
    'shadow_total', (SELECT count(*) FROM public.prediction_segment_members_shadow m
       JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id WHERE l2.is_static = false OR l2.name IN ('Trashed', 'Due to Reorder'))
  )
  FROM public.prediction_segment_lists l
  LEFT JOIN live lv ON lv.list_id = l.id
  LEFT JOIN shadow sh ON sh.list_id = l.id;
$$;

REVOKE ALL ON FUNCTION public.segment_engine_diff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.segment_engine_diff() TO service_role;

COMMIT;

-- Make sure the seeded config's lists all exist, then refresh the shadow table.
SELECT public.sync_segment_lists_from_config();
SELECT public.recompute_all_segments_v4();
