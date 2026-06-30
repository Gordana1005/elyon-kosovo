-- Simplify Cancel Lists (user request May 2026)
-- =================================================================
-- Business rule change:
-- - Anyone with ANY paid order history (paid_count > 0) must NEVER be in a cancel list.
--   They belong in the normal value/prestige prediction lists based on their purchase behavior.
-- - Only pure non-buyers (never paid anything, only cancelled/pending) should be in cancel lists.
-- - For these pure non-buyers, we only need simple time-based buckets (no price differentiation needed).
--
-- Changes:
-- 1. Delete all 16 price-banded granular cancel lists (the mirrors).
-- 2. Insert 4 simple time-based cancel lists:
--    - 0-3m Cancel
--    - 3-6m Cancel
--    - 6+m Cancel (6-12m)
--    - 1y+ Cancel
-- 3. Update recompute_customer_segments to explicitly skip ALL cancel lists for any phone that has paid_count > 0.
-- 4. The 4 new lists use only recency on last_cancelled. No price_min/max.
-- 5. "Cancelled Pendings" static list is untouched (different use case).
--
-- After this migration + cleanup script:
-- - The 211+ phones with paid history will be removed from cancel lists and reclassified into proper value/prestige lists on next recompute.
-- - Only phones with zero paid orders will remain in the 4 simple cancel lists.
--
-- Note: Return lists are left unchanged for now (user request was specific to cancel lists).
-- =================================================================

BEGIN;

-- 1. Delete the 16 granular price-banded cancel lists.
--    (Names are stable from the mirror migrations.)
DELETE FROM public.prediction_segment_lists
WHERE category = 'cancel'
  AND is_static = false
  AND name LIKE '%Cancel%';

-- 2. Insert the 4 simple time-based cancel lists (only for pure non-buyers).
--    Priority set low (65) so value/prestige lists always win for anyone with purchases.
INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event,
   recency_months_min, recency_months_max,
   single_price_min, single_price_max,  -- deliberately NULL = no price filter
   min_paid_count, lifetime_min, display_order, priority)
VALUES
  ('0-3m Cancel', 'Cancelled in last 3 months (pure non-buyers only)', 'cancel', 'last_cancelled', 0, 3, NULL, NULL, NULL, NULL, 60, 65),
  ('3-6m Cancel', 'Cancelled 3-6 months ago (pure non-buyers only)', 'cancel', 'last_cancelled', 3, 6, NULL, NULL, NULL, NULL, 61, 65),
  ('6+m Cancel',  'Cancelled 6-12 months ago (pure non-buyers only)', 'cancel', 'last_cancelled', 6, 12, NULL, NULL, NULL, NULL, 62, 65),
  ('1y+ Cancel',  'Cancelled 12+ months ago (pure non-buyers only)',  'cancel', 'last_cancelled', 12, NULL, NULL, NULL, NULL, NULL, 63, 65);

-- 3. Modify the recompute function to enforce the new business rule:
--    Phones with any paid history are never eligible for *any* cancel list.
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

  SELECT created_at, id, price INTO v_last_paid_at, v_last_paid_id, v_last_paid_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'paid'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at, id, price INTO v_last_cancelled_at, v_last_cancelled_id, v_last_cancelled_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'cancelled'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at, id, price INTO v_last_returned_at, v_last_returned_id, v_last_returned_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'returned'
  ORDER BY created_at DESC LIMIT 1;

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  FOR v_list IN
    SELECT * FROM public.prediction_segment_lists
    WHERE is_active AND NOT is_static
    ORDER BY priority ASC, display_order ASC
  LOOP
    -- NEW BUSINESS RULE: Never put anyone with paid history into cancel lists
    IF v_list.category = 'cancel' AND v_paid_count > 0 THEN
      CONTINUE;
    END IF;

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

-- 4. (Optional but recommended) Reclassify affected phones.
--    This will be driven more reliably by the dedicated cleanup script after this migration.
--    We still call it for the phones we know have cancelled orders.
SELECT public.recompute_customer_segments(customer_phone)
FROM (
  SELECT DISTINCT customer_phone
  FROM public.orders
  WHERE status IN ('cancelled', 'returned')
    AND customer_phone IS NOT NULL
) s;

COMMIT;

-- After running this migration:
--   1. Run the new cleanup script: node scripts/cleanup-cancel-lists-for-payers.mjs
--      (This will remove everyone with paid history from the remaining cancel lists
--       and force them into their proper value/prestige lists.)
--   2. Trigger a full "Recompute all segments" from the admin UI.
--   3. Verify with scripts/verify-segments.mjs that only pure non-buyers remain in the 4 simple cancel lists.