-- ============================================================================
-- ENGINE v3.3 — "Current Returns" additive tracking list (2026-06-23)
-- ============================================================================
-- WHY: operator wants returned orders tracked in a dedicated prediction list,
-- like Current Cancels, backfilled for everything returned (all current returns
-- arrived via BigArena sync from ~22 May on) and kept current for future returns.
--
-- DESIGN (operator decisions 2026-06-23):
--   * ADDITIVE, not exclusive. A customer whose NEWEST order is a return is
--     tracked in "Current Returns". If they ALSO have paid history they STILL
--     appear in their normal band (by last paid order) — i.e. dual membership.
--     A return-ONLY customer (no paid orders) appears ONLY in Current Returns
--     (not Never-Converted).
--   * RETENTION = until they order again: "newest order is a return" means no
--     order was created after their latest returned order. Once a newer order
--     exists they leave Current Returns and classify normally. No time window
--     (so it needs no return-date math — return timestamps are mostly missing).
--   * UNASSIGNED, so it never enters an agent's calling queue (queues filter on
--     assigned_agent_id) and the warehouse return state is purely informational.
--
-- This is the ONLY change vs 20260710000000 (engine v3.2): a Current Returns
-- branch + additive membership block. Current Returns is EXCLUDED from the
-- nuclear delete and the agent-state carry-over, so it coexists with the
-- calling list. Companion migration 20260713000000 fixes returned_at recording.
-- After applying: node scripts/audit-segments-integrity.mjs -> must be 10/10.
-- ============================================================================

BEGIN;

-- Cheap rollback snapshot for this change (drop after a verified week).
DO $bk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'prediction_segment_members_backup_20260623_returns'
  ) THEN
    CREATE TABLE public.prediction_segment_members_backup_20260623_returns AS
      SELECT * FROM public.prediction_segment_members;
  END IF;
END
$bk$;

-- The additive tracking list (created once; UNASSIGNED = nobody calls it).
INSERT INTO public.prediction_segment_lists
  (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order)
SELECT 'Current Returns', 'return', 'last_returned', 0, 1, 1, 6
WHERE NOT EXISTS (
  SELECT 1 FROM public.prediction_segment_lists WHERE name = 'Current Returns'
);

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

  v_disp_order_id UUID;          -- most recent paid order with price > 0
  v_disp_at TIMESTAMPTZ;
  v_disp_price NUMERIC;

  v_last_cancelled_order_id UUID;
  v_last_cancelled_at TIMESTAMPTZ;          -- the cancelled order's created_at (parking anchor + "most recent action" test)
  v_last_cancelled_price NUMERIC;

  -- returns (engine v3.3): latest returned order + "is the return their newest action"
  v_last_returned_order_id UUID;
  v_last_returned_at TIMESTAMPTZ;           -- the returned order's created_at (shown as "Last order")
  v_last_returned_price NUMERIC;
  v_newest_is_return BOOLEAN := false;
  v_returns_list_id UUID;

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

  -- agent-work state carried across list moves
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

  -- monadon_legacy orders are history-only: they never count. A phone whose
  -- ONLY orders are legacy yields NULL name -> rule rows removed, static kept.
  SELECT MAX(customer_name) FILTER (WHERE source_type IS DISTINCT FROM 'monadon_legacy'),
         COUNT(*)            FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'),
         COALESCE(SUM(price) FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'), 0)
    INTO v_customer_name, v_paid_count, v_lifetime
    FROM public.orders
   WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members m
    USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  SELECT created_at, price INTO v_last_paid_at, v_last_paid_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'paid'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  -- "Last order" shown to agents: most recent paid order with a real price,
  -- falling back to the true most recent paid one.
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

  -- Latest returned order + whether it is the customer's NEWEST activity
  -- ("until they order again" = no order created after their last return).
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

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone
      AND status IN ('pending','take','call_again','confirmed','shipped','delivered')
      AND source_type IS DISTINCT FROM 'monadon_legacy'
  ) INTO v_has_inflight;

  -- Frequency label: literally true for every member; most specific wins.
  -- 1-2 -> (1-3) | 3-4 -> (3+) | 5-6 -> (5+) | 7+ -> (7+)
  IF v_paid_count >= 7 THEN v_freq_bucket := '(7+ orders)';
  ELSIF v_paid_count >= 5 THEN v_freq_bucket := '(5+ orders)';
  ELSIF v_paid_count >= 3 THEN v_freq_bucket := '(3+ orders)';
  ELSE v_freq_bucket := '(1-3 orders)';
  END IF;

  IF v_paid_count = 0 AND v_has_inflight THEN
    -- Never-buyer with an order in flight: handled in the Pendings workflow,
    -- never by calling lists. The status trigger re-classifies on resolution.
    v_target_list_name := NULL;

  ELSIF v_newest_is_return AND v_paid_count = 0 THEN
    -- Return-ONLY customer: lives ONLY in Current Returns (additive block below),
    -- never in a calling list (NOT Never-Converted). Operator decision 2026-06-23.
    v_target_list_name := NULL;

  ELSIF (NOT v_newest_is_return)
     AND v_last_cancelled_at IS NOT NULL
     AND (v_last_paid_at IS NULL OR v_last_cancelled_at > v_last_paid_at)
     AND (now() - v_last_cancelled_at) < interval '14 days' THEN
    -- Most recent action is a fresh cancellation: park for 14 days.
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
    -- Paid customers (including those whose newest action is a return — they keep
    -- their band AND get Current Returns additively below).
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

  -- Trigger fields = the order that justifies the membership.
  IF v_target_is_cancel THEN
    v_trigger_order_id := v_last_cancelled_order_id;
    v_trigger_at       := v_last_cancelled_at;
    v_trigger_price    := v_last_cancelled_price;
  ELSE
    v_trigger_order_id := v_disp_order_id;
    v_trigger_at       := v_disp_at;
    v_trigger_price    := v_disp_price;
  END IF;

  -- Carry agent work across moves: prefer an assigned row, else the newest.
  -- Current Returns is excluded — it is additive/unassigned and its state must
  -- never carry onto a calling list.
  SELECT m.assigned_agent_id, m.assigned_agent_name, m.assigned_at,
         m.last_call_at, m.last_call_outcome, m.in_call_again_until,
         m.call_again_since, m.is_completed, m.last_paid_at
    INTO c_assigned_agent_id, c_assigned_agent_name, c_assigned_at,
         c_last_call_at, c_last_call_outcome, c_in_call_again_until,
         c_call_again_since, c_is_completed, c_prev_last_paid_at
  FROM public.prediction_segment_members m
  JOIN public.prediction_segment_lists l ON l.id = m.list_id AND l.is_static = false
   AND l.name <> 'Current Returns'
  WHERE m.customer_phone = _phone
  ORDER BY (m.assigned_agent_id IS NOT NULL) DESC, m.updated_at DESC
  LIMIT 1;

  -- A NEW purchase starts a fresh lifecycle: the customer becomes callable
  -- again on the normal NEWCOMERS -> bands path.
  IF v_last_paid_at IS NOT NULL
     AND (c_prev_last_paid_at IS NULL OR v_last_paid_at > c_prev_last_paid_at) THEN
    c_is_completed := false;
    c_in_call_again_until := NULL;
    c_call_again_since := NULL;
  END IF;

  -- Current Cancels is an UNASSIGNED holding pen by design (2026-06-16).
  IF v_target_list_name = 'Current Cancels' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
    c_is_completed := false;
  END IF;

  -- NEWCOMERS are an UNASSIGNED holding pen too (engine v3.1, 2026-06-18):
  -- a customer who just paid (recency < 21d) must be DISTRIBUTED deliberately
  -- by a manager, never inherit an agent automatically via carry-over from a
  -- prior band. This strips ONLY the automatic carry-over on ENTRY. A manager's
  -- explicit assignment still sticks: it lives on the existing member row and
  -- the ON CONFLICT DO UPDATE below never overwrites assigned_agent_*.
  IF v_target_list_name LIKE 'NEWCOMERS%' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
  END IF;

  -- Nuclear delete keeps one CALLING list per phone. Current Returns is excluded
  -- so an additive returns row survives calling-list reclassification.
  DELETE FROM public.prediction_segment_members m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false
    AND l.name <> 'Current Returns'
    AND (v_target_list_id IS NULL OR m.list_id <> v_target_list_id);

  IF v_target_list_id IS NOT NULL THEN
    INSERT INTO public.prediction_segment_members
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
      -- a new purchase resets done/retry even when the list stays the same
      is_completed = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members.last_paid_at
                          THEN false ELSE prediction_segment_members.is_completed END,
      in_call_again_until = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members.last_paid_at
                                 THEN NULL ELSE prediction_segment_members.in_call_again_until END,
      call_again_since = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members.last_paid_at
                              THEN NULL ELSE prediction_segment_members.call_again_since END,
      last_paid_at      = EXCLUDED.last_paid_at,
      paid_count        = EXCLUDED.paid_count,
      lifetime_value    = EXCLUDED.lifetime_value,
      avg_package_price = EXCLUDED.avg_package_price,
      updated_at        = now();
  END IF;

  -- ADDITIVE "Current Returns" membership (engine v3.3, operator 2026-06-23):
  -- independent of the calling list above. Present iff the customer's newest
  -- order is a return; trigger fields = that returned order (its created_at is
  -- the date shown in the Orders list). UNASSIGNED so it never enters a queue.
  SELECT id INTO v_returns_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Current Returns' AND is_active = true;

  IF v_returns_list_id IS NOT NULL THEN
    IF v_newest_is_return THEN
      INSERT INTO public.prediction_segment_members
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
      DELETE FROM public.prediction_segment_members
      WHERE list_id = v_returns_list_id AND customer_phone = _phone;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS
'engine v3.3 2026-06-23: ADDITIVE "Current Returns" tracking list — a customer whose NEWEST order is a return is tracked there (UNASSIGNED) until they order again; if they also have paid history they keep their band too (dual membership), and a return-only customer is ONLY in Current Returns (not Never-Converted). Current Returns is excluded from the nuclear delete + carry-over. All v3.2 rules retained: Current Cancels 14d park on created_at, NEWCOMERS unassigned holding pen, truthful symmetric freq buckets (1-2/3-4/5-6/7+), bands 21-57/57-120/120-180/180-365/365-730/730+, never-buyer in-flight guard, monadon_legacy fully excluded, trigger_* written (real Last order), agent-state carry-over on band moves, new-purchase resets completed/call-again. Canonical file: 20260712000000_returns_list_engine_v3_3.sql (supersedes 20260710000000). Do NOT re-run older migration SQL over this.';

-- UI card description (shown on /segments comes from this column).
UPDATE public.prediction_segment_lists
SET description = 'Customers whose most recent order was a RETURN. Additive tracking list (UNASSIGNED, nobody calls it): a customer here also stays in their normal calling list if they have paid history. They leave automatically once they place a newer order. Shows the returned order''s date.'
WHERE name = 'Current Returns';

COMMIT;

-- Full repair pass with the updated engine (outside the DDL transaction).
-- Populates Current Returns for every customer whose newest order is a return.
SELECT public.recompute_all_segments();
