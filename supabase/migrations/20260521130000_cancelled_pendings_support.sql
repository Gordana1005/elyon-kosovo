-- "Cancelled Pendings" support: park brand-new-customer pending orders
-- (customers who only ever showed interest, never bought) into a dedicated
-- static list so they stop cluttering the live Pendings, while keeping their
-- phone + name + product so an agent can call them back later.
--
-- This migration adds the infrastructure; the actual 991-order cancel + list
-- population is done by scripts/cancel-new-customer-pendings.mjs.

-- 1. Static lists: a manually-curated prediction list whose membership is NOT
--    managed by the recompute engine (so it never reshuffles itself away).
ALTER TABLE public.prediction_segment_lists
  ADD COLUMN IF NOT EXISTS is_static boolean NOT NULL DEFAULT false;

-- 2. Per-member product (the product the customer left a pending for). Only
--    populated for static lists like Cancelled Pendings; NULL elsewhere.
ALTER TABLE public.prediction_segment_members
  ADD COLUMN IF NOT EXISTS product_name text;

-- 3. Allow a distinct cancellation reason for the bulk pending cleanup so the
--    whole batch is findable / reversible as one set. (The agent-facing reason
--    picker is a separate hardcoded list, so this won't appear there.)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancellation_reason_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR cancellation_reason IN (
    'no_money', 'changed_mind', 'wrong_product', 'bought_elsewhere',
    'family_refused', 'duplicate_order', 'price_too_high', 'other',
    'pending_cleanup'
  ));

-- 4. Teach the recompute engine to SKIP static lists, so manually-curated
--    membership (Cancelled Pendings) is never touched. Only this one line
--    changes vs the existing function (the FOR-loop WHERE clause); the rest is
--    reproduced verbatim.
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
BEGIN
  IF _phone IS NULL OR _phone = '' THEN RETURN; END IF;

  SELECT
    MAX(customer_name),
    COUNT(*) FILTER (WHERE status = 'paid'),
    COALESCE(SUM(price) FILTER (WHERE status = 'paid'), 0)
  INTO v_customer_name, v_paid_count, v_lifetime
  FROM public.orders WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    -- Customer has no orders at all — clear only rule-driven memberships,
    -- leave static (manually curated) lists alone.
    DELETE FROM public.prediction_segment_members m
    USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  SELECT created_at, id, price
  INTO v_last_paid_at, v_last_paid_id, v_last_paid_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'paid'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at, id, price
  INTO v_last_cancelled_at, v_last_cancelled_id, v_last_cancelled_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'cancelled'
  ORDER BY created_at DESC LIMIT 1;

  SELECT created_at, id, price
  INTO v_last_returned_at, v_last_returned_id, v_last_returned_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'returned'
  ORDER BY created_at DESC LIMIT 1;

  -- Only rule-driven lists; static lists are managed by hand.
  FOR v_list IN SELECT * FROM public.prediction_segment_lists WHERE is_active AND NOT is_static LOOP
    IF v_list.trigger_event = 'last_paid' THEN
      v_trigger_at := v_last_paid_at; v_trigger_id := v_last_paid_id; v_trigger_price := v_last_paid_price;
    ELSIF v_list.trigger_event = 'last_cancelled' THEN
      v_trigger_at := v_last_cancelled_at; v_trigger_id := v_last_cancelled_id; v_trigger_price := v_last_cancelled_price;
    ELSIF v_list.trigger_event = 'last_returned' THEN
      v_trigger_at := v_last_returned_at; v_trigger_id := v_last_returned_id; v_trigger_price := v_last_returned_price;
    ELSE
      v_trigger_at := NULL;
    END IF;

    IF v_trigger_at IS NULL THEN
      DELETE FROM public.prediction_segment_members
      WHERE list_id = v_list.id AND customer_phone = _phone;
      CONTINUE;
    END IF;

    v_recency_days := EXTRACT(EPOCH FROM (now() - v_trigger_at)) / 86400.0;

    v_in_recency := TRUE;
    IF v_list.recency_months_min IS NOT NULL AND v_recency_days < v_list.recency_months_min * 30 THEN
      v_in_recency := FALSE;
    END IF;
    IF v_list.recency_months_max IS NOT NULL AND v_recency_days >= v_list.recency_months_max * 30 THEN
      v_in_recency := FALSE;
    END IF;

    v_in_price_band := TRUE;
    IF v_list.single_price_min IS NOT NULL AND (v_trigger_price IS NULL OR v_trigger_price < v_list.single_price_min) THEN
      v_in_price_band := FALSE;
    END IF;
    IF v_list.single_price_max IS NOT NULL AND (v_trigger_price IS NULL OR v_trigger_price >= v_list.single_price_max) THEN
      v_in_price_band := FALSE;
    END IF;

    IF v_list.min_paid_count IS NOT NULL THEN
      v_premium_match := v_in_price_band OR (v_paid_count >= v_list.min_paid_count);
    ELSIF v_list.single_price_min IS NOT NULL OR v_list.single_price_max IS NOT NULL THEN
      v_premium_match := v_in_price_band;
    ELSE
      v_premium_match := TRUE;
    END IF;

    v_in_lifetime := TRUE;
    IF v_list.lifetime_min IS NOT NULL AND v_lifetime < v_list.lifetime_min THEN
      v_in_lifetime := FALSE;
    END IF;

    v_matches := v_in_recency AND v_premium_match AND v_in_lifetime;

    IF v_matches THEN
      INSERT INTO public.prediction_segment_members (
        list_id, customer_phone, customer_name,
        trigger_order_id, trigger_event_at, trigger_price,
        last_paid_at, paid_count, lifetime_value, updated_at
      ) VALUES (
        v_list.id, _phone, v_customer_name,
        v_trigger_id, v_trigger_at, v_trigger_price,
        v_last_paid_at, v_paid_count, v_lifetime, now()
      )
      ON CONFLICT (list_id, customer_phone) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        trigger_order_id = EXCLUDED.trigger_order_id,
        trigger_event_at = EXCLUDED.trigger_event_at,
        trigger_price = EXCLUDED.trigger_price,
        last_paid_at = EXCLUDED.last_paid_at,
        paid_count = EXCLUDED.paid_count,
        lifetime_value = EXCLUDED.lifetime_value,
        updated_at = now();
    ELSE
      DELETE FROM public.prediction_segment_members
      WHERE list_id = v_list.id AND customer_phone = _phone;
    END IF;
  END LOOP;
END;
$$;

-- 5. Create the (empty) static list. The script fills it.
INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event, is_static, is_active, display_order)
VALUES
  ('Cancelled Pendings',
   'New customers who left a pending for a product but never ordered — their pending was cancelled to declutter, kept here with phone + name + product so they can be called back.',
   'cancel', 'last_cancelled', true, true, 300)
ON CONFLICT DO NOTHING;
