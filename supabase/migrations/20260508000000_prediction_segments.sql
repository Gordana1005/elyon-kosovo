-- ============================================================
-- Prediction Segments — rule-driven customer segmentation
-- ============================================================
-- Lists are defined as RULES (not static rows). Customer membership in each
-- list is computed from order history by recompute_customer_segments(phone),
-- which fires automatically when an order is inserted, deleted, or has its
-- status changed.
--
-- Boundary semantics: inclusive lower, exclusive upper.
--   recency_months_min=1, recency_months_max=3 → days_since_event in [30, 90)
--   single_price_min=50, single_price_max=100 → price in [50, 100)
--
-- Premium override: when min_paid_count is set, list matches if EITHER the
-- price band matches OR the customer has >= min_paid_count paid orders.
-- Combined with recency: AND.
-- ============================================================

CREATE TABLE public.prediction_segment_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('value', 'prestige', 'cancel', 'return', 'other')),

  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('last_paid', 'last_cancelled', 'last_returned')),

  recency_months_min INT,
  recency_months_max INT,

  single_price_min NUMERIC(10, 2),
  single_price_max NUMERIC(10, 2),

  min_paid_count INT,
  lifetime_min NUMERIC(10, 2),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.prediction_segment_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view segment lists"
  ON public.prediction_segment_lists FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins/Managers manage segment lists"
  ON public.prediction_segment_lists FOR ALL
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));

-- ── Members table ──
CREATE TABLE public.prediction_segment_members (
  list_id UUID NOT NULL REFERENCES public.prediction_segment_lists(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,

  customer_name TEXT,
  trigger_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  trigger_event_at TIMESTAMPTZ,
  trigger_price NUMERIC(10, 2),

  last_paid_at TIMESTAMPTZ,
  paid_count INT NOT NULL DEFAULT 0,
  lifetime_value NUMERIC(10, 2) NOT NULL DEFAULT 0,

  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_agent_name TEXT,
  assigned_at TIMESTAMPTZ,

  last_call_at TIMESTAMPTZ,
  last_call_outcome TEXT,
  in_call_again_until TIMESTAMPTZ,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (list_id, customer_phone)
);

CREATE INDEX idx_segment_members_phone ON public.prediction_segment_members(customer_phone);
CREATE INDEX idx_segment_members_agent_active
  ON public.prediction_segment_members(assigned_agent_id, is_completed)
  WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_segment_members_list_completion
  ON public.prediction_segment_members(list_id, is_completed);

ALTER TABLE public.prediction_segment_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents see assigned members"
  ON public.prediction_segment_members FOR SELECT
  TO authenticated
  USING (assigned_agent_id = auth.uid() OR public.is_admin_or_manager(auth.uid()));

CREATE POLICY "Agents update own assignments"
  ON public.prediction_segment_members FOR UPDATE
  TO authenticated
  USING (assigned_agent_id = auth.uid())
  WITH CHECK (assigned_agent_id = auth.uid());

CREATE POLICY "Admins/Managers manage members"
  ON public.prediction_segment_members FOR ALL
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));

-- ── Classification function: recompute one customer's memberships ──
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
    DELETE FROM public.prediction_segment_members WHERE customer_phone = _phone;
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

  FOR v_list IN SELECT * FROM public.prediction_segment_lists WHERE is_active LOOP
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

    -- Premium logic: when min_paid_count is set, match if EITHER price band OR paid count
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
      -- Drop assignment along with membership when the customer ages out
      DELETE FROM public.prediction_segment_members
      WHERE list_id = v_list.id AND customer_phone = _phone;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_customer_segments(TEXT) TO authenticated;

-- Bulk recompute for bootstrap and on-demand use.
CREATE OR REPLACE FUNCTION public.recompute_all_segments()
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
    PERFORM public.recompute_customer_segments(v_phone);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_all_segments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_all_segments() TO service_role;

-- ── Triggers ──
CREATE OR REPLACE FUNCTION public.trg_orders_recompute_segments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_customer_segments(OLD.customer_phone);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_customer_segments(NEW.customer_phone);

  -- If the phone moved, recompute the old phone too
  IF TG_OP = 'UPDATE' AND NEW.customer_phone IS DISTINCT FROM OLD.customer_phone THEN
    PERFORM public.recompute_customer_segments(OLD.customer_phone);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_segments_insert
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_orders_recompute_segments();

CREATE TRIGGER trg_orders_segments_delete
AFTER DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_orders_recompute_segments();

-- Only fire on meaningful changes — avoid every trivial UPDATE
CREATE TRIGGER trg_orders_segments_status
AFTER UPDATE OF status, price, customer_phone ON public.orders
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.price IS DISTINCT FROM NEW.price
  OR OLD.customer_phone IS DISTINCT FROM NEW.customer_phone
)
EXECUTE FUNCTION public.trg_orders_recompute_segments();

-- updated_at maintenance
CREATE TRIGGER trg_segment_lists_updated_at
BEFORE UPDATE ON public.prediction_segment_lists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_segment_members_updated_at
BEFORE UPDATE ON public.prediction_segment_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Seed: 27 list rules ──
-- Naming convention matches the user's spec.
INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event, recency_months_min, recency_months_max, single_price_min, single_price_max, min_paid_count, lifetime_min, display_order)
VALUES
  -- Value tier: single-order price band, by recency since last paid
  ('1-3m $50+',     'Last paid 1-3m ago, order €50-€99.99',          'value',    'last_paid', 1, 3,  50, 100, NULL, NULL,  10),
  ('1-3m $100+',    'Last paid 1-3m ago, order €100-€199.99',        'value',    'last_paid', 1, 3, 100, 200, NULL, NULL,  11),
  ('1-3m Premium',  'Last paid 1-3m ago, €200+ order OR 3+ paid',    'value',    'last_paid', 1, 3, 200, NULL,    3, NULL,  12),

  ('3-6m $50+',     'Last paid 3-6m ago, order €50-€99.99',          'value',    'last_paid', 3, 6,  50, 100, NULL, NULL,  20),
  ('3-6m $100+',    'Last paid 3-6m ago, order €100-€199.99',        'value',    'last_paid', 3, 6, 100, 200, NULL, NULL,  21),
  ('3-6m Premium',  'Last paid 3-6m ago, €200+ order OR 3+ paid',    'value',    'last_paid', 3, 6, 200, NULL,    3, NULL,  22),

  ('6+m $50+',      'Last paid 6-12m ago, order €50-€99.99',         'value',    'last_paid', 6, 12,  50, 100, NULL, NULL, 30),
  ('6+m $100+',     'Last paid 6-12m ago, order €100-€199.99',       'value',    'last_paid', 6, 12, 100, 200, NULL, NULL, 31),
  ('6+m Premium',   'Last paid 6-12m ago, €200+ order OR 3+ paid',   'value',    'last_paid', 6, 12, 200, NULL,    3, NULL, 32),

  ('1y+ $50+',      'Last paid 12m+ ago, order €50-€99.99',          'value',    'last_paid', 12, NULL,  50, 100, NULL, NULL, 40),
  ('1y+ $100+',     'Last paid 12m+ ago, order €100-€199.99',        'value',    'last_paid', 12, NULL, 100, 200, NULL, NULL, 41),
  ('1y+ Premium',   'Last paid 12m+ ago, €200+ order OR 3+ paid',    'value',    'last_paid', 12, NULL, 200, NULL,    3, NULL, 42),

  -- Prestige
  ('1-3m $300+',    'Last paid 1-3m ago, order €300+',               'prestige', 'last_paid', 1, 3,  300, NULL, NULL, NULL, 50),
  ('3-6m $300+',    'Last paid 3-6m ago, order €300+',               'prestige', 'last_paid', 3, 6,  300, NULL, NULL, NULL, 51),
  ('1y+ $300+',     'Last paid 12m+ ago, order €300+',               'prestige', 'last_paid', 12, NULL, 300, NULL, NULL, NULL, 52),

  -- Cancel (recency since last cancelled)
  ('1-3m Cancel',   'Cancelled 1-3m ago',                             'cancel',   'last_cancelled', 1, 3,    NULL, NULL, NULL, NULL, 60),
  ('3-6m Cancel',   'Cancelled 3-6m ago',                             'cancel',   'last_cancelled', 3, 6,    NULL, NULL, NULL, NULL, 61),
  ('6+m Cancel',    'Cancelled 6-12m ago',                            'cancel',   'last_cancelled', 6, 12,   NULL, NULL, NULL, NULL, 62),
  ('1y+ Cancel',    'Cancelled 12m+ ago',                             'cancel',   'last_cancelled', 12, NULL, NULL, NULL, NULL, NULL, 63),

  -- Return (recency since last returned)
  ('1-3m Return',   'Returned 1-3m ago',                              'return',   'last_returned', 1, 3,    NULL, NULL, NULL, NULL, 70),
  ('3-6m Return',   'Returned 3-6m ago',                              'return',   'last_returned', 3, 6,    NULL, NULL, NULL, NULL, 71),
  ('6+m Return',    'Returned 6-12m ago',                             'return',   'last_returned', 6, 12,   NULL, NULL, NULL, NULL, 72),
  ('1y+ Return',    'Returned 12m+ ago',                              'return',   'last_returned', 12, NULL, NULL, NULL, NULL, NULL, 73),

  -- Other (low-value, kept separate so high-value lists stay clean)
  ('1-3m Low <$50', 'Last paid 1-3m ago, order under €50',           'other',    'last_paid', 1, 3, 0,  50, NULL, NULL, 80),
  ('3-6m Low <$50', 'Last paid 3-6m ago, order under €50',           'other',    'last_paid', 3, 6, 0,  50, NULL, NULL, 81),
  ('6+m Low <$50',  'Last paid 6-12m ago, order under €50',          'other',    'last_paid', 6, 12, 0,  50, NULL, NULL, 82),
  ('1y+ Low <$50',  'Last paid 12m+ ago, order under €50',           'other',    'last_paid', 12, NULL, 0, 50, NULL, NULL, 83);

-- Bootstrap classification across all existing customers.
SELECT public.recompute_all_segments();
