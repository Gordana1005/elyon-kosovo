-- ============================================================================
-- ENGINE v3.4 — "Trashed" static list for wrong-number / wrong-person (2026-06-25)
-- ============================================================================
-- WHY: trashed customers silently vanished from every calling list. A member is
-- hidden from a list's default "Not yet called" view when is_completed=true (the
-- 5-no-answer auto-trash sets is_completed=true + last_call_outcome='trash'), and
-- the engine carries that flag over forever. There was no list anywhere that
-- showed trashed people. The one-time backlog restore (un-hiding everything that
-- was NOT a wrong-number/wrong-person trash) is done by
-- scripts/restore-trashed-to-lists.mjs. THIS migration makes the wrong-number /
-- wrong-person side self-maintaining.
--
-- DESIGN (operator decisions 2026-06-25):
--   * Only wrong_number + wrong_person trashes belong in the Trashed list. Every
--     other trash reason (didn't-pick-up / rude / uncooperative / other / blank)
--     is restored to its original calling list by the companion script.
--   * The Trashed list is STATIC (is_static=true) so the rule engine's nuclear
--     delete, agent-state carry-over, and the exclusivity audit all skip it
--     (they operate on is_static=false only).
--   * ADDITIVE + self-cleaning, exactly like "Current Returns": a customer is in
--     Trashed iff their NEWEST non-legacy order is a wrong_number/wrong_person
--     trash. Keying on the newest order means once they place a newer order the
--     number can't be wrong, so they leave Trashed and reclassify normally —
--     no date math, no manual cleanup.
--   * UNASSIGNED + is_completed=false so the members are VISIBLE in the list's
--     default view but never enter an agent's calling queue (queues filter on
--     assigned_agent_id). When their newest order is a wrong-trash they are also
--     removed from every calling band (target list = NULL -> nuclear delete).
--
-- This is the ONLY behavioural change vs 20260712000000 (engine v3.3): a
-- highest-precedence "newest is wrong-trash" branch + an additive Trashed block.
-- After applying: node scripts/audit-segments-integrity.mjs -> must stay 11/11
-- (Trashed is static, so it is excluded from the one-list-per-phone check).
-- ============================================================================

BEGIN;

-- Cheap rollback snapshot for this change (drop after a verified week).
DO $bk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'prediction_segment_members_backup_20260625_trashed'
  ) THEN
    CREATE TABLE public.prediction_segment_members_backup_20260625_trashed AS
      SELECT * FROM public.prediction_segment_members;
  END IF;
END
$bk$;

-- Allow a 'last_trashed' list-level trigger label (additive to the existing CHECK,
-- same approach as the orders.trash_reason CHECK extension in 20260702000000).
ALTER TABLE public.prediction_segment_lists
  DROP CONSTRAINT IF EXISTS prediction_segment_lists_trigger_event_check;
ALTER TABLE public.prediction_segment_lists
  ADD CONSTRAINT prediction_segment_lists_trigger_event_check
  CHECK (trigger_event IN ('last_paid', 'last_cancelled', 'last_returned', 'last_trashed'));

-- The static Trashed list (created once; UNASSIGNED = nobody calls it).
INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event, is_static, is_active, display_order)
SELECT 'Trashed',
       'Customers whose most recent order was trashed as a WRONG NUMBER or WRONG PERSON. Static, informational list (UNASSIGNED — nobody calls it): the number is bad, so they are kept out of every calling list and parked here. They leave automatically if a newer order ever appears.',
       'other', 'last_trashed', true, true, 310
WHERE NOT EXISTS (
  SELECT 1 FROM public.prediction_segment_lists WHERE name = 'Trashed'
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

  -- trashed (engine v3.4): newest order overall + "is it a wrong-number/person trash"
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

  -- Newest order overall (engine v3.4): drives the wrong-number/person Trashed
  -- routing. Self-cleaning — if the newest order is anything other than a
  -- wrong_number/wrong_person trash, the customer is NOT in Trashed.
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

  -- Frequency label: literally true for every member; most specific wins.
  -- 1-2 -> (1-3) | 3-4 -> (3+) | 5-6 -> (5+) | 7+ -> (7+)
  IF v_paid_count >= 7 THEN v_freq_bucket := '(7+ orders)';
  ELSIF v_paid_count >= 5 THEN v_freq_bucket := '(5+ orders)';
  ELSIF v_paid_count >= 3 THEN v_freq_bucket := '(3+ orders)';
  ELSE v_freq_bucket := '(1-3 orders)';
  END IF;

  IF v_newest_is_wrong_trash THEN
    -- Newest action is a wrong_number / wrong_person trash: the number is bad.
    -- Drop them from ALL calling bands (target NULL -> nuclear delete below) and
    -- place them in the static Trashed list (additive block at the end). Self-
    -- cleans once a newer order exists.
    v_target_list_name := NULL;

  ELSIF v_paid_count = 0 AND v_has_inflight THEN
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

  -- ADDITIVE "Trashed" membership (engine v3.4, operator 2026-06-25): the
  -- customer's NEWEST non-legacy order is a wrong_number/wrong_person trash.
  -- Static list, UNASSIGNED, is_completed=false so it is VISIBLE by default but
  -- never enters a calling queue. Self-cleans: once a newer order exists,
  -- v_newest_is_wrong_trash is false and the row is removed here.
  SELECT id INTO v_trashed_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Trashed' AND is_active = true;

  IF v_trashed_list_id IS NOT NULL THEN
    IF v_newest_is_wrong_trash THEN
      INSERT INTO public.prediction_segment_members
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
      DELETE FROM public.prediction_segment_members
      WHERE list_id = v_trashed_list_id AND customer_phone = _phone;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS
'engine v3.4 2026-06-25: ADDITIVE static "Trashed" list — a customer whose NEWEST non-legacy order is a wrong_number/wrong_person trash is parked there (UNASSIGNED, visible) and removed from every calling band; self-cleans once a newer order exists. All v3.3 rules retained: ADDITIVE Current Returns, Current Cancels 14d park on created_at, NEWCOMERS unassigned holding pen, truthful symmetric freq buckets (1-2/3-4/5-6/7+), bands 21-57/57-120/120-180/180-365/365-730/730+, never-buyer in-flight guard, monadon_legacy fully excluded, trigger_* written, agent-state carry-over on band moves, new-purchase resets completed/call-again. Canonical file: 20260725000000_trashed_list_engine_v3_4.sql (supersedes 20260712000000). Do NOT re-run older migration SQL over this.';

-- Keep the description current even if the list row already existed.
UPDATE public.prediction_segment_lists
SET description = 'Customers whose most recent order was trashed as a WRONG NUMBER or WRONG PERSON. Static, informational list (UNASSIGNED — nobody calls it): the number is bad, so they are kept out of every calling list and parked here. They leave automatically if a newer order ever appears.'
WHERE name = 'Trashed';

COMMIT;

-- Full repair pass with the updated engine (outside the DDL transaction).
-- Populates Trashed for every customer whose newest order is a wrong-number/
-- person trash, and removes those customers from their calling bands.
SELECT public.recompute_all_segments();
