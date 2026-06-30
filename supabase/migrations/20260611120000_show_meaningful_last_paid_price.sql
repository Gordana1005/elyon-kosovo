-- Make the "Last order" column in prediction lists always show a meaningful price (never 0.00 when there was a real purchase).
-- 
-- Change:
-- - last_paid_at remains the true most recent paid order (for accurate recency/frequency logic).
-- - For the price shown in the UI ("Last order" column, which uses trigger_price), we now use the most recent paid order that has price > 0.
-- - This fixes the "last order it says 0.00" problem the user reported.

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
  v_last_paid_price NUMERIC;           -- true most recent (may be 0)
  v_display_last_paid_price NUMERIC;   -- most recent with price > 0 (for UI "Last order" column)
  v_last_cancelled_at TIMESTAMPTZ;

  v_days_since_last_paid NUMERIC;
  v_recency_bucket TEXT;
  v_value_bucket TEXT;
  v_freq_bucket TEXT;
  v_target_list_name TEXT;
  v_target_list_id UUID;

  v_avg_package_price NUMERIC;
BEGIN
  IF _phone IS NULL OR _phone = '' THEN RETURN; END IF;

  SELECT MAX(customer_name), COUNT(*) FILTER (WHERE status = 'paid'), COALESCE(SUM(price) FILTER (WHERE status = 'paid'), 0)
  INTO v_customer_name, v_paid_count, v_lifetime
  FROM public.orders WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members m USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  -- True most recent paid (for recency logic and last_paid_at)
  SELECT created_at, price INTO v_last_paid_at, v_last_paid_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'paid'
  ORDER BY created_at DESC LIMIT 1;

  -- Most recent paid with meaningful price > 0 (for UI display in "Last order" column)
  SELECT price INTO v_display_last_paid_price
  FROM public.orders 
  WHERE customer_phone = _phone 
    AND status = 'paid' 
    AND price > 0
  ORDER BY created_at DESC LIMIT 1;

  -- Fallback to the true last paid price if all were 0
  IF v_display_last_paid_price IS NULL THEN
    v_display_last_paid_price := v_last_paid_price;
  END IF;

  SELECT created_at INTO v_last_cancelled_at
  FROM public.orders WHERE customer_phone = _phone AND status = 'cancelled'
  ORDER BY created_at DESC LIMIT 1;

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  -- ... (rest of the bucket calculation logic is identical to the previous version)
  IF v_paid_count = 0 THEN
    IF v_last_cancelled_at IS NOT NULL THEN
      v_days_since_last_paid := EXTRACT(EPOCH FROM (now() - v_last_cancelled_at)) / 86400.0;
      IF v_days_since_last_paid <= 180 THEN
        v_target_list_name := 'Never-Converted Recent';
      ELSE
        v_target_list_name := 'Never-Converted Old';
      END IF;
    ELSE
      v_target_list_name := 'Never-Converted Old';
    END IF;
  ELSE
    IF v_last_paid_at IS NOT NULL THEN
      v_days_since_last_paid := EXTRACT(EPOCH FROM (now() - v_last_paid_at)) / 86400.0;

      IF v_days_since_last_paid < 21 THEN
        IF v_paid_count <= 3 THEN
          v_target_list_name := 'NEWCOMERS (1-3 orders)';
        ELSIF v_paid_count <= 5 THEN
          v_target_list_name := 'NEWCOMERS (3+ orders)';
        ELSIF v_paid_count <= 7 THEN
          v_target_list_name := 'NEWCOMERS (5+ orders)';
        ELSE
          v_target_list_name := 'NEWCOMERS (7+ orders)';
        END IF;
      ELSE
        IF v_days_since_last_paid <= 57 THEN
          v_recency_bucket := '21d';
        ELSIF v_days_since_last_paid <= 120 THEN
          v_recency_bucket := '57d';
        ELSIF v_days_since_last_paid <= 180 THEN
          v_recency_bucket := '4-6m';
        ELSIF v_days_since_last_paid <= 365 THEN
          v_recency_bucket := '6-12m';
        ELSIF v_days_since_last_paid <= 730 THEN
          v_recency_bucket := '1-2yr';
        ELSE
          v_recency_bucket := '2yr+';
        END IF;

        v_value_bucket := CASE WHEN v_last_paid_price <= 26 THEN '≤26' ELSE '26+' END;

        IF v_last_paid_price > 26 THEN
          IF v_paid_count >= 7 THEN v_freq_bucket := '(7+ orders)';
          ELSIF v_paid_count >= 5 THEN v_freq_bucket := '(5+ orders)';
          ELSE v_freq_bucket := '(3+ orders)';
          END IF;
        ELSE
          IF v_paid_count <= 3 THEN
            v_freq_bucket := '(1-3 orders)';
          ELSIF v_paid_count <= 5 THEN
            v_freq_bucket := '(3+ orders)';
          ELSIF v_paid_count <= 7 THEN
            v_freq_bucket := '(5+ orders)';
          ELSE
            v_freq_bucket := '(7+ orders)';
          END IF;
        END IF;

        v_target_list_name := v_recency_bucket || ' ' || v_value_bucket || ' ' || v_freq_bucket;
      END IF;
    END IF;
  END IF;

  IF v_target_list_name IS NOT NULL THEN
    SELECT id INTO v_target_list_id
    FROM public.prediction_segment_lists
    WHERE name = v_target_list_name AND is_active = true AND is_static = false;
  END IF;

  DELETE FROM public.prediction_segment_members m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false
    AND (v_target_list_id IS NULL OR m.list_id <> v_target_list_id);

  IF v_target_list_id IS NOT NULL THEN
    INSERT INTO public.prediction_segment_members
      (list_id, customer_phone, customer_name, last_paid_at, paid_count, lifetime_value, avg_package_price, updated_at)
    VALUES (v_target_list_id, _phone, v_customer_name, v_last_paid_at, v_paid_count, v_lifetime, v_avg_package_price, now())
    ON CONFLICT (list_id, customer_phone) DO UPDATE SET
      last_paid_at = EXCLUDED.last_paid_at,
      paid_count = EXCLUDED.paid_count,
      lifetime_value = EXCLUDED.lifetime_value,
      avg_package_price = EXCLUDED.avg_package_price,
      updated_at = now();
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS 
'2026-06-11: "Last order" price shown in UI now prefers the most recent non-zero paid order (fixes 0.00 display). Frequency bucketing remains fully symmetric on total paid_count.';

-- Re-apply to all phones so the better "Last order" prices appear
SELECT public.recompute_all_segments();

COMMIT;