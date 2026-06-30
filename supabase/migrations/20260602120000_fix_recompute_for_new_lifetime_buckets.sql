-- Fix recompute_customer_segments to properly populate the new lifetime-based lists
-- The previous function did not know how to classify into the new bucket names.

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
  v_last_paid_price NUMERIC;
  v_last_cancelled_at TIMESTAMPTZ;

  v_list RECORD;
  v_days_since_last_paid NUMERIC;
  v_value_bucket TEXT;
  v_freq_bucket TEXT;
  v_recency_bucket TEXT;
  v_target_list_name TEXT;
  v_target_list_id UUID;

  v_best_list_id UUID := NULL;
  v_best_priority INT := 999999;
BEGIN
  IF _phone IS NULL OR _phone = '' THEN RETURN; END IF;

  -- Get basic stats
  SELECT MAX(customer_name), COUNT(*) FILTER (WHERE status = 'paid'), COALESCE(SUM(price) FILTER (WHERE status = 'paid'), 0)
  INTO v_customer_name, v_paid_count, v_lifetime
  FROM public.orders WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members m USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  -- Get last paid and last cancelled
  SELECT created_at, price INTO v_last_paid_at, v_last_paid_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'paid'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at INTO v_last_cancelled_at
  FROM public.orders WHERE customer_phone = _phone AND status = 'cancelled'
  ORDER BY created_at DESC LIMIT 1;

  -- Determine buckets for this phone
  IF v_paid_count = 0 THEN
    -- Pure non-buyer → Never-Converted buckets
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
    -- Has paid history → use the new lifetime buckets
    IF v_last_paid_at IS NOT NULL THEN
      v_days_since_last_paid := EXTRACT(EPOCH FROM (now() - v_last_paid_at)) / 86400.0;

      -- 21-day protection for very recent paid (as per your earlier request)
      IF v_days_since_last_paid < 21 THEN
        -- Do not put into any normal prediction list yet (respect 21-day cooldown after paid)
        v_target_list_name := NULL;
      ELSE
        -- Determine recency bucket
        IF v_days_since_last_paid <= 21 THEN
          v_recency_bucket := '0-21d';
        ELSIF v_days_since_last_paid <= 57 THEN
          v_recency_bucket := '22-57d';
        ELSIF v_days_since_last_paid <= 120 THEN
          v_recency_bucket := '58-120d';
        ELSIF v_days_since_last_paid <= 180 THEN
          v_recency_bucket := '121-180d';
        ELSIF v_days_since_last_paid <= 365 THEN
          v_recency_bucket := '181-365d';
        ELSIF v_days_since_last_paid <= 730 THEN
          v_recency_bucket := '1-2yr';
        ELSE
          v_recency_bucket := '2yr+';
        END IF;

        -- Value bucket based on last paid price
        v_value_bucket := CASE WHEN v_last_paid_price <= 26 THEN '≤26' ELSE '26+' END;

        -- Frequency bucket
        IF v_paid_count <= 3 THEN
          v_freq_bucket := '1-3';
        ELSIF v_paid_count <= 5 THEN
          v_freq_bucket := '3-5';
        ELSIF v_paid_count <= 7 THEN
          v_freq_bucket := '5-7';
        ELSE
          v_freq_bucket := '7+';
        END IF;

        v_target_list_name := v_recency_bucket || ' ' || v_value_bucket || ' (' || v_freq_bucket || ')';
      END IF;
    END IF;
  END IF;

  -- Find the target list by name (if any)
  IF v_target_list_name IS NOT NULL THEN
    SELECT id INTO v_target_list_id
    FROM public.prediction_segment_lists
    WHERE name = v_target_list_name AND is_active = true AND is_static = false;

    IF v_target_list_id IS NOT NULL THEN
      -- Insert or update the membership (simple version for now)
      INSERT INTO public.prediction_segment_members (list_id, customer_phone, customer_name, last_paid_at, paid_count, lifetime_value, updated_at)
      VALUES (v_target_list_id, _phone, v_customer_name, v_last_paid_at, v_paid_count, v_lifetime, now())
      ON CONFLICT (list_id, customer_phone) DO UPDATE SET
        last_paid_at = EXCLUDED.last_paid_at,
        paid_count = EXCLUDED.paid_count,
        lifetime_value = EXCLUDED.lifetime_value,
        updated_at = now();
    END IF;
  END IF;

  -- Cleanup: remove this phone from any other non-static lists it shouldn't be in
  DELETE FROM public.prediction_segment_members m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id
    AND m.customer_phone = _phone
    AND l.is_static = false
    AND (v_target_list_id IS NULL OR m.list_id <> v_target_list_id);

END;
$$;

-- Reclassify everyone with the corrected logic
SELECT public.recompute_customer_segments(customer_phone)
FROM (
  SELECT DISTINCT customer_phone FROM public.orders WHERE customer_phone IS NOT NULL
) s;

COMMIT;