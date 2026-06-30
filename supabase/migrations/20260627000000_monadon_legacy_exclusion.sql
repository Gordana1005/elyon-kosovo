-- Monadon legacy import — keep another company's historical paid orders OUT of the
-- prediction engine. These orders are inserted with source_type='monadon_legacy' and
-- status='paid' (so a client's history shows what they bought), but they must NEVER:
--   • count toward paid_count / lifetime_value,
--   • set last_paid_at / recency (they carry a synthetic 2026-05-01 date),
--   • pull a phone into any rule-driven calling list.
-- They live ONLY in the hand-curated static "FULL MONAD LIST" segment.
--
-- This redefinition is byte-for-byte the 2026-06-16 version (current_cancels_list) with
-- one change: every paid-history aggregation/lookup adds
--   AND source_type IS DISTINCT FROM 'monadon_legacy'
-- (and MAX(customer_name) is likewise filtered, so a phone whose ONLY orders are legacy
-- yields NULL → the function deletes non-static members and returns, i.e. no rule list).
--
-- Financial/commission/insights exclusion of monadon_legacy is handled in the edge
-- function (supabase/functions/api/index.ts). Static lists are already untouched by this
-- engine (WHERE l.is_static = false), so FULL MONAD LIST is safe regardless.
-- ============================================================================

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
  v_display_last_paid_price NUMERIC;
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

  -- Exclude monadon_legacy from name detection AND paid aggregation. A phone whose only
  -- orders are legacy → v_customer_name NULL → early delete+return (no rule membership).
  SELECT MAX(customer_name) FILTER (WHERE source_type IS DISTINCT FROM 'monadon_legacy'),
         COUNT(*) FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'),
         COALESCE(SUM(price) FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'), 0)
  INTO v_customer_name, v_paid_count, v_lifetime
  FROM public.orders WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members m USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  SELECT created_at, price INTO v_last_paid_at, v_last_paid_price
  FROM public.orders WHERE customer_phone = _phone AND status = 'paid'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  SELECT price INTO v_display_last_paid_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'paid' AND price > 0
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;
  IF v_display_last_paid_price IS NULL THEN
    v_display_last_paid_price := v_last_paid_price;
  END IF;

  SELECT created_at INTO v_last_cancelled_at
  FROM public.orders WHERE customer_phone = _phone AND status = 'cancelled'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  -- NEW: a recent cancellation (most recent action, within 30 days) parks the
  -- customer in "Current Cancels" — out of every normal list. After 30 days this
  -- no longer matches and they re-enter their normal bucket below.
  IF v_last_cancelled_at IS NOT NULL
     AND (v_last_paid_at IS NULL OR v_last_cancelled_at > v_last_paid_at)
     AND (now() - v_last_cancelled_at) < interval '30 days'
  THEN
    v_target_list_name := 'Current Cancels';

  ELSIF v_paid_count = 0 THEN
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
'2026-06-27: identical to 2026-06-16 (Current Cancels) but every paid-history aggregation/lookup excludes source_type=''monadon_legacy'' (incl. MAX(customer_name)), so legacy-only phones get no rule-driven membership and legacy paids never affect recency/lifetime. FULL MONAD LIST is static and untouched by this engine.';

-- Index to keep the new source_type filter fast in recompute (per-phone scans).
CREATE INDEX IF NOT EXISTS idx_orders_phone_source_status
  ON public.orders (customer_phone, source_type, status);

COMMIT;
