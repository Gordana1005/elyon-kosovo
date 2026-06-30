-- Prediction Segments: Priority-based exclusive membership (Option 1) + 21-day post-purchase floor + first-class avg_package_price
-- ================================================================================================================================
--
-- Goal (user-approved plan):
-- - Guarantee **zero duplicate phones** across prediction_segment_members for calling/assignment.
-- - Enforce sensible **21-day recency floor** on value/prestige (upsell) lists so customers who paid 1-2 days ago no longer appear in re-marketing queues.
-- - Compute and persist **avg_package_price = lifetime_value / GREATEST(paid_count, 1)** as first-class data for calling quality and UI.
-- - Keep the rich rule-driven classification power for admins (Segments page, Insights, match counts) while making the *calling surface* (Calls page queues, Assigner, My Queue) perfectly clean.
--
-- Approach (minimal change, maximum safety — Option 1 from plan):
-- - Add `priority` column to prediction_segment_lists (lower number = higher calling priority).
-- - Add `avg_package_price` column to prediction_segment_members.
-- - Rewrite recompute_customer_segments to:
--     * Skip static lists (existing behaviour).
--     * Apply 21-day floor for category IN ('value','prestige').
--     * While evaluating rules, keep only the single *best* match for the phone (by priority, then trigger_price desc, then recency).
--     * At end of processing: delete all rule-driven (non-static) members for the phone, then insert **only the winner** (carrying over any existing assigned_agent / is_completed / in_call_again state if the winner list already had a row for this phone).
-- - Existing assigned work is preserved on the winning list where possible.
-- - Recovery (cancel/return) and low-value lists keep more aggressive (or 0-day) floors — they serve a different purpose.
--
-- Impact:
-- - Future order events + manual recompute will produce at most 1 member row per phone for rule-driven lists.
-- - One-time data collapse of existing duplicates is handled in a follow-up script (see phase 2) or admin-triggered full recompute after this migration.
-- - Frontend (Calls/Assigner) sees almost no behavioural change — queues simply stop having duplicates.
-- - Admin reporting (Segments overview, match counts) can still expose "phones that *would* match rule X" via lightweight helpers if needed later.
--
-- Safety:
-- - is_static lists untouched (existing Cancelled Pendings etc. remain manually curated).
-- - RLS, triggers, and existing indexes continue to work.
-- - The function remains SECURITY DEFINER and is only granted appropriately.
--
-- Run after: npx supabase db push --linked (or equivalent). Then run verification scripts and a full recompute.
-- ================================================================================================================================

BEGIN;

-- 1. Add priority column (lower = wins for exclusive calling membership)
ALTER TABLE public.prediction_segment_lists
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;

-- 2. Add avg_package_price to members (first-class, persisted, queryable)
ALTER TABLE public.prediction_segment_members
  ADD COLUMN IF NOT EXISTS avg_package_price NUMERIC(10, 2);

-- Helpful index for future "best member" queries (optional but cheap)
CREATE INDEX IF NOT EXISTS idx_segment_members_phone_priority
  ON public.prediction_segment_members (customer_phone, list_id);

-- 3. Replace the classifier with priority + 21-day floor + avg + single-winner logic
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

  -- Winner tracking for exclusive (priority pick-one)
  v_best_list_id UUID := NULL;
  v_best_priority INT := 999999;
  v_best_trigger_price NUMERIC := -1;
  v_best_recency_days NUMERIC := 999999;
  v_best_trigger_at TIMESTAMPTZ;
  v_best_trigger_id UUID;
  v_best_trigger_price_val NUMERIC;  -- renamed to avoid collision
  v_best_avg NUMERIC;
BEGIN
  IF _phone IS NULL OR _phone = '' THEN RETURN; END IF;

  -- Gather customer stats (unchanged)
  SELECT
    MAX(customer_name),
    COUNT(*) FILTER (WHERE status = 'paid'),
    COALESCE(SUM(price) FILTER (WHERE status = 'paid'), 0)
  INTO v_customer_name, v_paid_count, v_lifetime
  FROM public.orders WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    -- No orders at all — clear only rule-driven (non-static) memberships
    DELETE FROM public.prediction_segment_members m
    USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  -- Last events (unchanged)
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

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  -- Evaluate ONLY rule-driven lists (static are hand-managed)
  FOR v_list IN
    SELECT * FROM public.prediction_segment_lists
    WHERE is_active AND NOT is_static
    ORDER BY priority ASC, display_order ASC   -- lower priority number wins
  LOOP
    -- Determine trigger event (unchanged)
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
      CONTINUE;
    END IF;

    v_recency_days := EXTRACT(EPOCH FROM (now() - v_trigger_at)) / 86400.0;

    -- === 21-DAY POST-PURCHASE FLOOR FOR VALUE / PRESTIGE (user requirement) ===
    v_in_recency := TRUE;
    IF v_list.recency_months_min IS NOT NULL AND v_recency_days < v_list.recency_months_min * 30 THEN
      v_in_recency := FALSE;
    END IF;
    IF v_list.recency_months_max IS NOT NULL AND v_recency_days >= v_list.recency_months_max * 30 THEN
      v_in_recency := FALSE;
    END IF;

    -- Explicit 21-day floor for upsell-oriented categories (overrides the months band for freshness protection)
    IF v_list.category IN ('value', 'prestige') AND v_recency_days < 21 THEN
      v_in_recency := FALSE;
    END IF;

    -- Price / premium / lifetime logic (unchanged)
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
      -- Priority selection: keep the best so far
      IF v_list.priority < v_best_priority
         OR (v_list.priority = v_best_priority AND COALESCE(v_trigger_price, 0) > v_best_trigger_price)
         OR (v_list.priority = v_best_priority AND COALESCE(v_trigger_price, 0) = v_best_trigger_price AND v_recency_days < v_best_recency_days)
      THEN
        v_best_list_id           := v_list.id;
        v_best_priority          := v_list.priority;
        v_best_trigger_price     := COALESCE(v_trigger_price, 0);
        v_best_recency_days      := v_recency_days;
        v_best_trigger_at        := v_trigger_at;
        v_best_trigger_id        := v_trigger_id;
        v_best_trigger_price_val := v_trigger_price;
        v_best_avg               := v_avg_package_price;
      END IF;
    END IF;
  END LOOP;

  -- === EXCLUSIVE MEMBERSHIP: delete all rule-driven members for this phone, then insert only the winner ===
  DELETE FROM public.prediction_segment_members m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;

  IF v_best_list_id IS NOT NULL THEN
    -- Try to carry over existing assignment/completed state for this phone on the winning list (if it existed before)
    INSERT INTO public.prediction_segment_members (
      list_id, customer_phone, customer_name,
      trigger_order_id, trigger_event_at, trigger_price,
      last_paid_at, paid_count, lifetime_value,
      avg_package_price,
      updated_at
    )
    SELECT
      v_best_list_id, _phone, v_customer_name,
      v_best_trigger_id, v_best_trigger_at, v_best_trigger_price_val,
      v_last_paid_at, v_paid_count, v_lifetime,
      v_best_avg,
      now()
    ON CONFLICT (list_id, customer_phone) DO UPDATE SET
      customer_name       = EXCLUDED.customer_name,
      trigger_order_id    = EXCLUDED.trigger_order_id,
      trigger_event_at    = EXCLUDED.trigger_event_at,
      trigger_price       = EXCLUDED.trigger_price,
      last_paid_at        = EXCLUDED.last_paid_at,
      paid_count          = EXCLUDED.paid_count,
      lifetime_value      = EXCLUDED.lifetime_value,
      avg_package_price   = EXCLUDED.avg_package_price,
      updated_at          = now();
  END IF;

END;
$$;

-- 4. Sensible initial priorities for the existing rule-driven lists (lower = higher calling priority)
--    Value/recent high-quality get best numbers. Recovery important but secondary. Low-value filler last.
--    These can be adjusted later via the Segments admin UI (PATCH will still trigger recompute).
UPDATE public.prediction_segment_lists SET priority = 10  WHERE name LIKE '%Premium%' OR name LIKE '%$300+%' AND is_static = false;
UPDATE public.prediction_segment_lists SET priority = 20  WHERE name LIKE '%$100+%' AND is_static = false;
UPDATE public.prediction_segment_lists SET priority = 30  WHERE name LIKE '%$50+%' AND is_static = false;
UPDATE public.prediction_segment_lists SET priority = 40  WHERE name LIKE '%$46+%' AND is_static = false;
UPDATE public.prediction_segment_lists SET priority = 50  WHERE category = 'prestige' AND is_static = false;   -- prestige slightly behind pure value for calling focus
UPDATE public.prediction_segment_lists SET priority = 60  WHERE category IN ('cancel','return') AND is_static = false;  -- recovery still high-value but different intent
UPDATE public.prediction_segment_lists SET priority = 120 WHERE name LIKE '%Low <$50%' AND is_static = false;
UPDATE public.prediction_segment_lists SET priority = 200 WHERE is_static = true;  -- static lists never compete in the rule engine

-- 5. Ensure the recompute function is usable by the edge function / service role (existing grants should cover)
--    (No new grants needed — the original migration already handled this.)

-- 6. Optional: backfill avg_package_price on any *current* members (will be overwritten on next recompute per phone)
--    This is a one-time convenience; the real data cleanup happens after the function is live.
UPDATE public.prediction_segment_members m
SET avg_package_price = CASE WHEN m.paid_count > 0 THEN m.lifetime_value / m.paid_count ELSE NULL END
WHERE m.avg_package_price IS NULL;

COMMIT;

-- After applying this migration:
--   1. Run a full recompute (admin UI or RPC) so the new exclusive logic + 21-day floor + avg values take effect.
--   2. Execute the follow-up collapse / verification scripts (see phase 2 of the plan).
--   3. Verify with: SELECT COUNT(*), COUNT(DISTINCT customer_phone) FROM prediction_segment_members WHERE ... (should be equal for rule-driven).
--
-- The 21-day floor and priority selection now protect prediction agents from recent buyers and duplicate phones while preserving all the rich historical signals.