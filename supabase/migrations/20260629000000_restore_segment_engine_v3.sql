-- ============================================================================
-- ENGINE v3 — restore + finish the prediction-segments classifier (2026-06-10)
-- ============================================================================
-- WHY: production was found running an OLD (early-June) function body even
-- though migrations through 20260628 were recorded as applied — someone/something
-- re-applied old SQL over the fixed versions. Damage verified on 2026-06-10:
--   • 57-120d customers matched a list name ("2-4m …") that no longer exists
--     -> 94 real customers deleted from every list (black hole),
--   • NEWCOMERS routing missing -> all 4 NEWCOMERS lists empty,
--   • asymmetric frequency buckets -> ~5,590 members in "26+ (3+ orders)" lists
--     with fewer than 3 paid orders; every "26+ (1-3 orders)" list empty,
--   • no monadon_legacy exclusion -> 1,555 imported Monadon-only phones inside
--     real calling lists,
--   • no Current Cancels parking -> cancellers kept being re-called,
--   • trigger_price/trigger_event_at never written by ANY June version
--     -> "Last order €0.00" on all 9,516 member rows.
--
-- THIS migration is the single canonical engine. It merges every operator-
-- approved rule and finishes the unfinished ones:
--   1. monadon_legacy excluded from every aggregation/lookup (20260627).
--   2. Current Cancels 30-day unassigned parking (20260616).
--   3. NEWCOMERS < 21 days routing + bands 21-57 / 57-120 / 120-180 / 180-365 /
--      365-730 / 730+ (20260608, operator re-confirmed 2026-06-10).
--   4. TRUTHFUL symmetric frequency labels on BOTH price sides (operator spec
--      2026-06-10, supersedes 20260610 boundaries): most specific true label
--      wins -> 1-2 -> "(1-3 orders)", 3-4 -> "(3+ orders)", 5-6 -> "(5+ orders)",
--      7+ -> "(7+ orders)". A "(3+)" list may never contain a sub-3 client.
--   5. trigger_order_id / trigger_event_at / trigger_price are FINALLY written
--      (completes the 20260611 intent): paid buckets show the most recent
--      non-zero paid order; cancel-category lists show the last cancelled order.
--   6. Agent-work carry-over on band moves (restores the 20260528 guarantee):
--      assignment, last-call info, completed and call-again state survive when
--      a customer ages/moves between lists. A NEW purchase resets
--      completed/call-again (fresh lifecycle).
--   7. Never-buyer in-flight guard (operator decision 2026-06-10): a phone with
--      paid_count = 0 and an order in pending/take/call_again/confirmed/
--      shipped/delivered is worked in the Pendings section -> NO calling list.
--      Customers WITH paid history keep their band lists while re-ordering.
--
-- The companion migration 20260630000000 schedules the nightly recompute
-- (pg_cron) that makes time-based drift work (band aging, 30-day un-parking).
-- NOTE: all non-ASCII characters needed for list-name matching are built with
-- chr() so this file survives any client encoding (chr(8804) = '≤').
-- ============================================================================

BEGIN;

-- Safety snapshot for cheap rollback (drop after a verified week).
DO $bk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'prediction_segment_members_backup_20260610'
  ) THEN
    CREATE TABLE public.prediction_segment_members_backup_20260610 AS
      SELECT * FROM public.prediction_segment_members;
  END IF;
END
$bk$;

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
  v_last_cancelled_at TIMESTAMPTZ;
  v_last_cancelled_price NUMERIC;

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

  ELSIF v_last_cancelled_at IS NOT NULL
     AND (v_last_paid_at IS NULL OR v_last_cancelled_at > v_last_paid_at)
     AND (now() - v_last_cancelled_at) < interval '30 days' THEN
    -- Most recent action is a fresh cancellation: park for 30 days.
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
  SELECT m.assigned_agent_id, m.assigned_agent_name, m.assigned_at,
         m.last_call_at, m.last_call_outcome, m.in_call_again_until,
         m.call_again_since, m.is_completed, m.last_paid_at
    INTO c_assigned_agent_id, c_assigned_agent_name, c_assigned_at,
         c_last_call_at, c_last_call_outcome, c_in_call_again_until,
         c_call_again_since, c_is_completed, c_prev_last_paid_at
  FROM public.prediction_segment_members m
  JOIN public.prediction_segment_lists l ON l.id = m.list_id AND l.is_static = false
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

  -- Nuclear delete keeps the one-list-per-phone invariant for rule lists.
  DELETE FROM public.prediction_segment_members m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false
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

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS
'engine v3 2026-06-10: truthful symmetric freq buckets (1-2/3-4/5-6/7+), NEWCOMERS<21d, bands 21-57/57-120/120-180/180-365/365-730/730+, Current Cancels 30d unassigned park, never-buyer in-flight guard, monadon_legacy fully excluded, trigger_* fields written (real Last order), agent-state carry-over on moves, new-purchase resets completed/call-again. Canonical file: 20260629000000_restore_segment_engine_v3.sql. Do NOT re-run older migration SQL over this.';

-- Self-explaining list descriptions (shown in the UI) so names cannot mislead.
DO $desc$
DECLARE
  r RECORD;
  v_rec TEXT;
  v_val TEXT;
  v_freq TEXT;
  v_desc TEXT;
BEGIN
  FOR r IN SELECT id, name FROM public.prediction_segment_lists WHERE is_static = false LOOP
    v_desc := NULL;
    IF r.name = 'Current Cancels' THEN
      v_desc := 'Most recent action was a cancellation within the last 30 days. Parked here UNASSIGNED and out of every calling list; returns to the normal bucket automatically after 30 days (nightly recompute).';
    ELSIF r.name = 'Never-Converted Recent' THEN
      v_desc := 'Never bought anything; last cancellation within the last 180 days. Phones with an order currently in progress are excluded (they live in the Pendings section).';
    ELSIF r.name = 'Never-Converted Old' THEN
      v_desc := 'Never bought anything; no cancellation in the last 180 days (or none at all). Phones with an order currently in progress are excluded.';
    ELSE
      v_rec := CASE
        WHEN r.name LIKE 'NEWCOMERS%' THEN 'Paid within the last 21 days'
        WHEN r.name LIKE '21d%'   THEN 'Last paid 21-57 days ago'
        WHEN r.name LIKE '57d%'   THEN 'Last paid 57-120 days ago (about 2-4 months)'
        WHEN r.name LIKE '4-6m%'  THEN 'Last paid 4-6 months ago (120-180 days)'
        WHEN r.name LIKE '6-12m%' THEN 'Last paid 6-12 months ago'
        WHEN r.name LIKE '1-2yr%' THEN 'Last paid 1-2 years ago'
        WHEN r.name LIKE '2yr+%'  THEN 'Last paid over 2 years ago'
        ELSE NULL END;
      v_val := CASE
        WHEN r.name LIKE '%26+%' THEN 'last paid order over ' || chr(8364) || '26'
        WHEN position(chr(8804) in r.name) > 0 THEN 'last paid order ' || chr(8364) || '26 or under'
        ELSE NULL END;
      v_freq := CASE
        WHEN r.name LIKE '%(1-3 orders)%' THEN '1-2 lifetime paid orders'
        WHEN r.name LIKE '%(3+ orders)%'  THEN '3-4 lifetime paid orders (always at least 3)'
        WHEN r.name LIKE '%(5+ orders)%'  THEN '5-6 lifetime paid orders (always at least 5)'
        WHEN r.name LIKE '%(7+ orders)%'  THEN '7 or more lifetime paid orders'
        ELSE NULL END;
      IF v_rec IS NOT NULL THEN
        v_desc := v_rec || COALESCE(' | ' || v_val, '') || COALESCE(' | ' || v_freq, '');
      END IF;
    END IF;
    IF v_desc IS NOT NULL THEN
      UPDATE public.prediction_segment_lists SET description = v_desc WHERE id = r.id;
    END IF;
  END LOOP;
END
$desc$;

COMMIT;

-- Full repair pass with the fixed engine (outside the DDL transaction).
SELECT public.recompute_all_segments();
