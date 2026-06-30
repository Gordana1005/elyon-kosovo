-- Fix for overly broad 21-day cooldown that wiped out value/prestige lists
-- =====================================================================
--
-- Problem (introduced in 20260530 migration):
--   The global 21-day guard was placed too early and too broadly:
--     IF any protected status change in last 21 days → CONTINUE for the entire loop.
--   This caused almost every phone with recent activity to be excluded from
--   ALL prediction lists (value, prestige, cancel, etc.) on full recompute.
--
-- Fix:
--   Make the 21-day protection **category-aware** and targeted:
--
--   - For value / prestige lists:
--       Block if the phone had a recent (last 21 days) `paid`, `confirmed`, or `shipped`.
--       (This protects recent buyers from immediate upsell re-targeting.)
--
--   - For cancel lists:
--       Block if the phone had a recent (last 21 days) `cancelled`.
--       (This implements the user's request: don't immediately call back after a cancellation.)
--
--   - Return lists: keep current behavior (no additional 21-day from the global rule).
--
--   - The existing per-cancel "if paid_count > 0 then never in cancel" guard remains.
--
--   - Call Again and Personal List remain completely unaffected.
--
-- After this migration, run a full "Recompute all segments" from the UI.
-- Most of your value/prestige members should come back (except those genuinely
-- within 21 days of a recent purchase/confirmation/shipment).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_customer_segments(_phone TEXT)
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
  v_last_paid_id UUID;
  v_last_paid_price NUMERIC;

  v_last_cancelled_at TIMESTAMPTZ;
  v_last_cancelled_id UUID;
  v_last_cancelled_price NUMERIC;

  v_last_returned_at TIMESTAMPTZ;
  v_last_returned_id UUID;
  v_last_returned_price NUMERIC;

  -- Targeted last protected events
  v_last_paid_or_confirmed_or_shipped_at TIMESTAMPTZ;
  v_last_cancelled_at_for_cooldown TIMESTAMPTZ;

  v_list RECORD;
  v_trigger_at TIMESTAMPTZ;
  v_trigger_id UUID;
  v_trigger_price NUMERIC;
  v_recency_days NUMERIC;
  v_in_recency BOOLEAN;
  v_in_price_band BOOLEAN;
  v_premium_match BOOLEAN;
  v_in_lifetime BOOLEAN;
  v_matches BOOLEAN;
  v_avg_package_price NUMERIC;

  v_best_list_id UUID := NULL;
  v_best_priority INT := 999999;
  v_best_trigger_price NUMERIC := -1;
  v_best_recency_days NUMERIC := 999999;
  v_best_trigger_at TIMESTAMPTZ;
  v_best_trigger_id UUID;
  v_best_trigger_price_val NUMERIC;
  v_best_avg NUMERIC;
BEGIN
  IF _phone IS NULL OR _phone = '' THEN RETURN; END IF;

  SELECT
    MAX(customer_name),
    COUNT(*) FILTER (WHERE status = 'paid'),
    COALESCE(SUM(price) FILTER (WHERE status = 'paid'), 0)
  INTO v_customer_name, v_paid_count, v_lifetime
  FROM public.orders WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members m
    USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  -- Last paid / cancelled / returned
  SELECT created_at, id, price INTO v_last_paid_at, v_last_paid_id, v_last_paid_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'paid'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at, id, price INTO v_last_cancelled_at, v_last_cancelled_id, v_last_cancelled_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'cancelled'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at, id, price INTO v_last_returned_at, v_last_returned_id, v_last_returned_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'returned'
  ORDER BY created_at DESC LIMIT 1;

  -- Most recent "buyer/seller" protected event (for value/prestige protection)
  SELECT MAX(updated_at) INTO v_last_paid_or_confirmed_or_shipped_at
  FROM public.orders
  WHERE customer_phone = _phone
    AND status IN ('paid', 'confirmed', 'shipped');

  -- Most recent cancellation (for cancel list protection)
  SELECT MAX(updated_at) INTO v_last_cancelled_at_for_cooldown
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'cancelled';

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  FOR v_list IN
    SELECT * FROM public.prediction_segment_lists
    WHERE is_active AND NOT is_static
    ORDER BY priority ASC, display_order ASC
  LOOP
    -- Existing hard rule: never put paid customers into cancel lists
    IF v_list.category = 'cancel' AND v_paid_count > 0 THEN
      CONTINUE;
    END IF;

    -- === TARGETED 21-DAY COOLDOWNS (fixed version) ===

    -- For value/prestige: protect recent buyers (paid/confirmed/shipped)
    IF v_list.category IN ('value', 'prestige')
       AND v_last_paid_or_confirmed_or_shipped_at IS NOT NULL
       AND (now() - v_last_paid_or_confirmed_or_shipped_at) < interval '21 days'
    THEN
      CONTINUE;
    END IF;

    -- For cancel lists: protect recent cancellations (don't spam right after cancel)
    IF v_list.category = 'cancel'
       AND v_last_cancelled_at_for_cooldown IS NOT NULL
       AND (now() - v_last_cancelled_at_for_cooldown) < interval '21 days'
    THEN
      CONTINUE;
    END IF;

    -- Determine trigger
    IF v_list.trigger_event = 'last_paid' THEN
      v_trigger_at := v_last_paid_at; v_trigger_id := v_last_paid_id; v_trigger_price := v_last_paid_price;
    ELSIF v_list.trigger_event = 'last_cancelled' THEN
      v_trigger_at := v_last_cancelled_at; v_trigger_id := v_last_cancelled_id; v_trigger_price := v_last_cancelled_price;
    ELSIF v_list.trigger_event = 'last_returned' THEN
      v_trigger_at := v_last_returned_at; v_trigger_id := v_last_returned_id; v_trigger_price := v_last_returned_price;
    ELSE
      v_trigger_at := NULL;
    END IF;

    IF v_trigger_at IS NULL THEN CONTINUE; END IF;

    v_recency_days := EXTRACT(EPOCH FROM (now() - v_trigger_at)) / 86400.0;

    v_in_recency := TRUE;
    IF v_list.recency_months_min IS NOT NULL AND v_recency_days < v_list.recency_months_min * 30 THEN v_in_recency := FALSE; END IF;
    IF v_list.recency_months_max IS NOT NULL AND v_recency_days >= v_list.recency_months_max * 30 THEN v_in_recency := FALSE; END IF;

    -- Legacy per-category 21-day (now mostly redundant but kept for safety)
    IF v_list.category IN ('value', 'prestige') AND v_recency_days < 21 THEN
      v_in_recency := FALSE;
    END IF;

    v_in_price_band := TRUE;
    IF v_list.single_price_min IS NOT NULL AND (v_trigger_price IS NULL OR v_trigger_price < v_list.single_price_min) THEN v_in_price_band := FALSE; END IF;
    IF v_list.single_price_max IS NOT NULL AND (v_trigger_price IS NULL OR v_trigger_price >= v_list.single_price_max) THEN v_in_price_band := FALSE; END IF;

    IF v_list.min_paid_count IS NOT NULL THEN
      v_premium_match := v_in_price_band OR (v_paid_count >= v_list.min_paid_count);
    ELSIF v_list.single_price_min IS NOT NULL OR v_list.single_price_max IS NOT NULL THEN
      v_premium_match := v_in_price_band;
    ELSE
      v_premium_match := TRUE;
    END IF;

    v_in_lifetime := TRUE;
    IF v_list.lifetime_min IS NOT NULL AND v_lifetime < v_list.lifetime_min THEN v_in_lifetime := FALSE; END IF;

    v_matches := v_in_recency AND v_premium_match AND v_in_lifetime;

    IF v_matches THEN
      IF v_list.priority < v_best_priority
         OR (v_list.priority = v_best_priority AND COALESCE(v_trigger_price, 0) > v_best_trigger_price)
         OR (v_list.priority = v_best_priority AND COALESCE(v_trigger_price, 0) = v_best_trigger_price AND v_recency_days < v_best_recency_days)
      THEN
        v_best_list_id := v_list.id;
        v_best_priority := v_list.priority;
        v_best_trigger_price := COALESCE(v_trigger_price, 0);
        v_best_recency_days := v_recency_days;
        v_best_trigger_at := v_trigger_at;
        v_best_trigger_id := v_trigger_id;
        v_best_trigger_price_val := v_trigger_price;
        v_best_avg := v_avg_package_price;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.prediction_segment_members m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;

  IF v_best_list_id IS NOT NULL THEN
    INSERT INTO public.prediction_segment_members (
      list_id, customer_phone, customer_name,
      trigger_order_id, trigger_event_at, trigger_price,
      last_paid_at, paid_count, lifetime_value,
      avg_package_price, updated_at
    )
    SELECT
      v_best_list_id, _phone, v_customer_name,
      v_best_trigger_id, v_best_trigger_at, v_best_trigger_price_val,
      v_last_paid_at, v_paid_count, v_lifetime,
      v_best_avg, now()
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
  END IF;
END;
$$;

-- Reclassify everyone so the corrected logic takes effect
SELECT public.recompute_customer_segments(customer_phone)
FROM (
  SELECT DISTINCT customer_phone
  FROM public.orders
  WHERE status IN ('paid', 'confirmed', 'shipped', 'cancelled', 'returned')
    AND customer_phone IS NOT NULL
) s;

COMMIT;

-- After applying this fix:
--   1. Go to Prediction Lists → click "Recompute all segments" again.
--   2. Your value and prestige tiers should repopulate with the correct customers
--      (everyone except those who had a protected status change in the last 21 days).
--   3. The 4 simple cancel lists will only contain pure non-buyers who are outside
--      their 21-day post-cancellation window.
--
-- This version of the 21-day rule matches your original intent much more closely.