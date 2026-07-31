-- ============================================================================
-- ENGINE v3.5 — comprehensive "Trash List" (all reasons + reason) (2026-07-07)
-- ============================================================================
-- WHY: the v3.4 "Trashed" list only showed wrong_number / wrong_person trashes.
-- Every "didn't answer" auto-trash (reason 'not_reachable') and every rude /
-- uncooperative / other trash was invisible — customers vanished from the
-- calling lists with no explanation. Operator decision 2026-07-07: ONE
-- comprehensive list named "Trash List" that shows EVERY trashed customer WITH
-- the reason, so the team always sees who was trashed and why.
--
-- CHANGES vs v3.4 (20260725000000) and its v4 shadow mirror (20260726010000):
--   1. The "Trashed" list is renamed to "Trash List".
--   2. Trash List membership (additive, static, self-cleaning by newest order)
--      widens from wrong_number/wrong_person to ANY trashed newest order.
--   3. A new column prediction_segment_members(.shadow).trigger_trash_reason
--      carries the reason so the UI can show a "Reason" column.
--   4. Removal-from-calling-bands (the highest-precedence NULL-target branch)
--      widens from wrong_number/wrong_person to ALSO include 'not_reachable'
--      (a manual OR auto "Unreachable" trash is a dead number → stop calling).
--      rude / uncooperative / other stay callable as before (2026-06-25
--      operator decision) but are now VISIBLE in the Trash List.
--
-- Both the LIVE engine (recompute_customer_segments) and the SHADOW v4 engine
-- (recompute_customer_segments_v4) get the identical change so parity stays 0.
-- Also refreshes segment_engine_diff() and the audit/parity/cutover literals.
--
-- After applying: node scripts/audit-segments-integrity.mjs -> must stay all-PASS
-- (Trash List is static, excluded from the one-list-per-phone exclusivity check;
-- check #11 is updated to "newest order is a trash of ANY reason").
-- Never re-run older engine migration SQL over this. One version = one file.
-- ============================================================================

BEGIN;

-- Cheap rollback snapshot for this change (drop after a verified week).
DO $bk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'prediction_segment_members_backup_20260707_trashlist'
  ) THEN
    CREATE TABLE public.prediction_segment_members_backup_20260707_trashlist AS
      SELECT * FROM public.prediction_segment_members;
  END IF;
END
$bk$;

-- 1. Reason column on both the live and the shadow member tables.
ALTER TABLE public.prediction_segment_members
  ADD COLUMN IF NOT EXISTS trigger_trash_reason TEXT;
ALTER TABLE public.prediction_segment_members_shadow
  ADD COLUMN IF NOT EXISTS trigger_trash_reason TEXT;

-- 2. Rename "Trashed" -> "Trash List" and refresh its description. Idempotent:
--    matches whichever name currently exists; creates it if somehow missing.
UPDATE public.prediction_segment_lists
   SET name = 'Trash List',
       description = 'Every customer whose most recent order was TRASHED, with the reason (wrong number, wrong person, unreachable, rude, uncooperative, other). Static, informational (UNASSIGNED — nobody calls it). Dead-number reasons (wrong number / wrong person / unreachable) are also removed from every calling list; other reasons stay callable but are shown here too. Self-cleans: a newer order removes them automatically.'
 WHERE name IN ('Trashed', 'Trash List');

INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event, is_static, is_active, display_order)
SELECT 'Trash List',
       'Every customer whose most recent order was TRASHED, with the reason (wrong number, wrong person, unreachable, rude, uncooperative, other). Static, informational (UNASSIGNED — nobody calls it). Dead-number reasons (wrong number / wrong person / unreachable) are also removed from every calling list; other reasons stay callable but are shown here too. Self-cleans: a newer order removes them automatically.',
       'other', 'last_trashed', true, true, 310
WHERE NOT EXISTS (
  SELECT 1 FROM public.prediction_segment_lists WHERE name = 'Trash List'
);

-- ============================================================================
-- 3. LIVE engine v3.5 — recompute_customer_segments (writes prediction_segment_members)
--    Copy of the v3.4 body (20260725000000) with the four Trash-List changes.
-- ============================================================================
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

  v_last_returned_order_id UUID;
  v_last_returned_at TIMESTAMPTZ;
  v_last_returned_price NUMERIC;
  v_newest_is_return BOOLEAN := false;
  v_returns_list_id UUID;

  -- trashed (engine v3.5): newest order overall + is-it-a-trash / is-it-a-dead-number-trash
  v_newest_order_id UUID;
  v_newest_order_at TIMESTAMPTZ;
  v_newest_order_price NUMERIC;
  v_newest_order_status TEXT;
  v_newest_order_reason TEXT;
  v_newest_is_trash BOOLEAN := false;          -- newest order is a trash of ANY reason (Trash List visibility)
  v_newest_is_nocall_trash BOOLEAN := false;   -- dead-number trash (wrong/wrong/unreachable) → also drop from calling bands
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

  -- Newest order overall (engine v3.5): drives the Trash List routing.
  SELECT id, created_at, price, status, trash_reason
    INTO v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_status, v_newest_order_reason
  FROM public.orders
  WHERE customer_phone = _phone
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  -- Any-reason trash → visible in Trash List. Dead-number reasons (bad number or
  -- unreachable) → ALSO removed from every calling band (target NULL below).
  v_newest_is_trash := (v_newest_order_status = 'trashed');
  v_newest_is_nocall_trash := (v_newest_order_status = 'trashed'
                               AND v_newest_order_reason IN ('wrong_number', 'wrong_person', 'not_reachable'));

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone
      AND status IN ('pending','take','call_again','confirmed','shipped','delivered')
      AND source_type IS DISTINCT FROM 'monadon_legacy'
  ) INTO v_has_inflight;

  -- Frequency label: literally true for every member; most specific wins.
  IF v_paid_count >= 7 THEN v_freq_bucket := '(7+ orders)';
  ELSIF v_paid_count >= 5 THEN v_freq_bucket := '(5+ orders)';
  ELSIF v_paid_count >= 3 THEN v_freq_bucket := '(3+ orders)';
  ELSE v_freq_bucket := '(1-3 orders)';
  END IF;

  IF v_newest_is_nocall_trash THEN
    -- Newest action is a dead-number trash (wrong number / wrong person /
    -- unreachable): drop them from ALL calling bands (target NULL -> nuclear
    -- delete below) and place them in the static Trash List (additive block at
    -- the end). Self-cleans once a newer order exists.
    v_target_list_name := NULL;

  ELSIF v_paid_count = 0 AND v_has_inflight THEN
    v_target_list_name := NULL;

  ELSIF v_newest_is_return AND v_paid_count = 0 THEN
    v_target_list_name := NULL;

  ELSIF (NOT v_newest_is_return)
     AND v_last_cancelled_at IS NOT NULL
     AND (v_last_paid_at IS NULL OR v_last_cancelled_at > v_last_paid_at)
     AND (now() - v_last_cancelled_at) < interval '14 days' THEN
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

  IF v_target_is_cancel THEN
    v_trigger_order_id := v_last_cancelled_order_id;
    v_trigger_at       := v_last_cancelled_at;
    v_trigger_price    := v_last_cancelled_price;
  ELSE
    v_trigger_order_id := v_disp_order_id;
    v_trigger_at       := v_disp_at;
    v_trigger_price    := v_disp_price;
  END IF;

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

  IF v_last_paid_at IS NOT NULL
     AND (c_prev_last_paid_at IS NULL OR v_last_paid_at > c_prev_last_paid_at) THEN
    c_is_completed := false;
    c_in_call_again_until := NULL;
    c_call_again_since := NULL;
  END IF;

  IF v_target_list_name = 'Current Cancels' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
    c_is_completed := false;
  END IF;

  IF v_target_list_name LIKE 'NEWCOMERS%' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
  END IF;

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

  -- ADDITIVE "Current Returns" membership (engine v3.3).
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

  -- ADDITIVE "Trash List" membership (engine v3.5, operator 2026-07-07): the
  -- customer's NEWEST non-legacy order is a trash of ANY reason. Static list,
  -- UNASSIGNED, is_completed=false so it is VISIBLE by default but never enters a
  -- calling queue. trigger_trash_reason carries the reason for the UI. Self-
  -- cleans: once a newer order exists, v_newest_is_trash is false and the row is
  -- removed here.
  SELECT id INTO v_trashed_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Trash List' AND is_active = true;

  IF v_trashed_list_id IS NOT NULL THEN
    IF v_newest_is_trash THEN
      INSERT INTO public.prediction_segment_members
        (list_id, customer_phone, customer_name,
         trigger_order_id, trigger_event_at, trigger_price, trigger_trash_reason,
         last_paid_at, paid_count, lifetime_value, avg_package_price,
         assigned_agent_id, assigned_agent_name, assigned_at,
         last_call_outcome, is_completed, updated_at)
      VALUES
        (v_trashed_list_id, _phone, v_customer_name,
         v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_reason,
         v_last_paid_at, v_paid_count, v_lifetime, v_avg_package_price,
         NULL, NULL, NULL, 'trash', false, now())
      ON CONFLICT (list_id, customer_phone) DO UPDATE SET
        customer_name        = EXCLUDED.customer_name,
        trigger_order_id     = EXCLUDED.trigger_order_id,
        trigger_event_at     = EXCLUDED.trigger_event_at,
        trigger_price        = EXCLUDED.trigger_price,
        trigger_trash_reason = EXCLUDED.trigger_trash_reason,
        last_paid_at         = EXCLUDED.last_paid_at,
        paid_count           = EXCLUDED.paid_count,
        lifetime_value       = EXCLUDED.lifetime_value,
        avg_package_price    = EXCLUDED.avg_package_price,
        updated_at           = now();
    ELSE
      DELETE FROM public.prediction_segment_members
      WHERE list_id = v_trashed_list_id AND customer_phone = _phone;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS
'engine v3.5 2026-07-07: comprehensive static "Trash List" — a customer whose NEWEST non-legacy order is trashed for ANY reason is parked there (UNASSIGNED, visible, trigger_trash_reason shows why) and self-cleans once a newer order exists. Dead-number trashes (wrong_number/wrong_person/not_reachable) are ALSO removed from every calling band; rude/uncooperative/other stay callable but are shown in Trash List. All v3.4 rules retained: ADDITIVE Current Returns, Current Cancels 14d park on created_at, NEWCOMERS unassigned holding pen, truthful symmetric freq buckets (1-2/3-4/5-6/7+), bands 21-57/57-120/120-180/180-365/365-730/730+, never-buyer in-flight guard, monadon_legacy fully excluded, trigger_* written, agent-state carry-over on band moves, new-purchase resets completed/call-again. Canonical file: 20260730000000_trash_list_engine_v3_5.sql (supersedes 20260725000000). Do NOT re-run older migration SQL over this.';

-- ============================================================================
-- 4. SHADOW engine v4 mirror — recompute_customer_segments_v4 (writes _shadow)
--    Identical Trash-List change so live-vs-shadow parity stays 0.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recompute_customer_segments_v4(_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg JSONB;
  v_b RECORD;
  v_max NUMERIC;
  v_holding BOOLEAN;
  v_mc INT;
  v_best INT;
  v_cancels_days INT;
  v_nc_recent_days INT;

  v_reorder_enabled BOOLEAN;
  v_reorder_buffer INT;
  v_reorder_default_supply INT;
  v_reorder_agg TEXT;
  v_reorder_list_name TEXT;
  v_reorder_list_id UUID;
  v_supply_days NUMERIC;
  v_runs_out_on TIMESTAMPTZ;
  v_call_from TIMESTAMPTZ;

  v_customer_name TEXT;
  v_paid_count INT;
  v_lifetime NUMERIC;
  v_last_paid_id UUID;
  v_last_paid_at TIMESTAMPTZ;
  v_last_paid_price NUMERIC;

  v_disp_order_id UUID;
  v_disp_at TIMESTAMPTZ;
  v_disp_price NUMERIC;

  v_last_cancelled_order_id UUID;
  v_last_cancelled_at TIMESTAMPTZ;
  v_last_cancelled_price NUMERIC;

  v_last_returned_order_id UUID;
  v_last_returned_at TIMESTAMPTZ;
  v_last_returned_price NUMERIC;
  v_newest_is_return BOOLEAN := false;
  v_returns_list_id UUID;

  v_newest_order_id UUID;
  v_newest_order_at TIMESTAMPTZ;
  v_newest_order_price NUMERIC;
  v_newest_order_status TEXT;
  v_newest_order_reason TEXT;
  v_newest_is_trash BOOLEAN := false;
  v_newest_is_nocall_trash BOOLEAN := false;
  v_trashed_list_id UUID;

  v_has_inflight BOOLEAN := false;

  v_days NUMERIC;
  v_recency_bucket TEXT;
  v_recency_is_holding BOOLEAN := false;
  v_recency_strip BOOLEAN := false;
  v_value_bucket TEXT;
  v_freq_bucket TEXT;
  v_target_list_name TEXT;
  v_target_list_id UUID;
  v_target_is_cancel BOOLEAN := false;

  v_avg_package_price NUMERIC;

  v_trigger_order_id UUID;
  v_trigger_at TIMESTAMPTZ;
  v_trigger_price NUMERIC;

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

  v_cfg := public.get_segment_engine_config();
  v_cancels_days   := COALESCE((v_cfg->'windows'->>'current_cancels_days')::int, 14);
  v_nc_recent_days := COALESCE((v_cfg->'windows'->>'never_converted_recent_days')::int, 180);
  v_reorder_enabled        := COALESCE((v_cfg->'reorder'->>'enabled')::boolean, false);
  v_reorder_buffer         := COALESCE((v_cfg->'reorder'->>'buffer_days')::int, 8);
  v_reorder_default_supply := COALESCE((v_cfg->'reorder'->>'default_days_of_supply_per_unit')::int, 15);
  v_reorder_agg            := COALESCE(v_cfg->'reorder'->>'aggregation', 'longest');
  v_reorder_list_name      := COALESCE(v_cfg->'reorder'->>'list_name', 'Due to Reorder');

  SELECT MAX(customer_name) FILTER (WHERE source_type IS DISTINCT FROM 'monadon_legacy'),
         COUNT(*)            FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'),
         COALESCE(SUM(price) FILTER (WHERE status = 'paid' AND source_type IS DISTINCT FROM 'monadon_legacy'), 0)
    INTO v_customer_name, v_paid_count, v_lifetime
    FROM public.orders
   WHERE customer_phone = _phone;

  IF v_customer_name IS NULL THEN
    DELETE FROM public.prediction_segment_members_shadow m
    USING public.prediction_segment_lists l
    WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false;
    RETURN;
  END IF;

  SELECT id, created_at, price INTO v_last_paid_id, v_last_paid_at, v_last_paid_price
  FROM public.orders
  WHERE customer_phone = _phone AND status = 'paid'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

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

  SELECT id, created_at, price, status, trash_reason
    INTO v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_status, v_newest_order_reason
  FROM public.orders
  WHERE customer_phone = _phone
    AND source_type IS DISTINCT FROM 'monadon_legacy'
  ORDER BY created_at DESC LIMIT 1;

  v_newest_is_trash := (v_newest_order_status = 'trashed');
  v_newest_is_nocall_trash := (v_newest_order_status = 'trashed'
                               AND v_newest_order_reason IN ('wrong_number', 'wrong_person', 'not_reachable'));

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone
      AND status IN ('pending','take','call_again','confirmed','shipped','delivered')
      AND source_type IS DISTINCT FROM 'monadon_legacy'
  ) INTO v_has_inflight;

  v_freq_bucket := NULL; v_best := -1;
  FOR v_b IN SELECT value FROM jsonb_array_elements(v_cfg->'frequency_bands') AS value LOOP
    v_mc := COALESCE((v_b.value->>'min_count')::int, 0);
    IF v_paid_count >= v_mc AND v_mc > v_best THEN
      v_best := v_mc;
      v_freq_bucket := v_b.value->>'label';
    END IF;
  END LOOP;
  IF v_freq_bucket IS NULL THEN
    v_freq_bucket := (v_cfg->'frequency_bands'->0->>'label');
  END IF;

  IF v_newest_is_nocall_trash THEN
    v_target_list_name := NULL;
  ELSIF v_paid_count = 0 AND v_has_inflight THEN
    v_target_list_name := NULL;
  ELSIF v_newest_is_return AND v_paid_count = 0 THEN
    v_target_list_name := NULL;
  ELSIF (NOT v_newest_is_return)
     AND v_last_cancelled_at IS NOT NULL
     AND (v_last_paid_at IS NULL OR v_last_cancelled_at > v_last_paid_at)
     AND (now() - v_last_cancelled_at) < (interval '1 day' * v_cancels_days) THEN
    v_target_list_name := 'Current Cancels';
    v_target_is_cancel := true;
  ELSIF v_paid_count = 0 THEN
    v_target_is_cancel := true;
    IF v_last_cancelled_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (now() - v_last_cancelled_at)) / 86400.0 <= v_nc_recent_days THEN
      v_target_list_name := 'Never-Converted Recent';
    ELSE
      v_target_list_name := 'Never-Converted Old';
    END IF;
  ELSIF v_last_paid_at IS NOT NULL THEN
    v_days := EXTRACT(EPOCH FROM (now() - v_last_paid_at)) / 86400.0;

    v_recency_bucket := NULL; v_recency_is_holding := false; v_recency_strip := false;
    FOR v_b IN
      SELECT value FROM jsonb_array_elements(v_cfg->'recency_bands') AS value
    LOOP
      v_holding := COALESCE((v_b.value->>'holding_pen')::boolean, false);
      IF (v_b.value->>'max_days') IS NULL THEN
        v_recency_bucket := v_b.value->>'label';
        v_recency_is_holding := v_holding;
        v_recency_strip := COALESCE((v_b.value->>'strip_assignment')::boolean, false);
        EXIT;
      END IF;
      v_max := (v_b.value->>'max_days')::numeric;
      IF (v_holding AND v_days < v_max) OR (NOT v_holding AND v_days <= v_max) THEN
        v_recency_bucket := v_b.value->>'label';
        v_recency_is_holding := v_holding;
        v_recency_strip := COALESCE((v_b.value->>'strip_assignment')::boolean, false);
        EXIT;
      END IF;
    END LOOP;

    IF v_recency_is_holding THEN
      v_target_list_name := v_recency_bucket || ' ' || v_freq_bucket;
    ELSE
      v_value_bucket := NULL;
      FOR v_b IN SELECT value FROM jsonb_array_elements(v_cfg->'value_bands') AS value LOOP
        IF (v_b.value->>'max_price') IS NULL THEN
          v_value_bucket := v_b.value->>'label'; EXIT;
        END IF;
        IF COALESCE(v_last_paid_price, 0) <= (v_b.value->>'max_price')::numeric THEN
          v_value_bucket := v_b.value->>'label'; EXIT;
        END IF;
      END LOOP;

      v_target_list_name := v_recency_bucket || ' ' || v_value_bucket || ' ' || v_freq_bucket;
    END IF;
  END IF;

  IF v_target_list_name IS NOT NULL THEN
    SELECT id INTO v_target_list_id
    FROM public.prediction_segment_lists
    WHERE name = v_target_list_name AND is_active = true AND is_static = false;
  END IF;

  IF v_target_is_cancel THEN
    v_trigger_order_id := v_last_cancelled_order_id;
    v_trigger_at       := v_last_cancelled_at;
    v_trigger_price    := v_last_cancelled_price;
  ELSE
    v_trigger_order_id := v_disp_order_id;
    v_trigger_at       := v_disp_at;
    v_trigger_price    := v_disp_price;
  END IF;

  SELECT m.assigned_agent_id, m.assigned_agent_name, m.assigned_at,
         m.last_call_at, m.last_call_outcome, m.in_call_again_until,
         m.call_again_since, m.is_completed, m.last_paid_at
    INTO c_assigned_agent_id, c_assigned_agent_name, c_assigned_at,
         c_last_call_at, c_last_call_outcome, c_in_call_again_until,
         c_call_again_since, c_is_completed, c_prev_last_paid_at
  FROM public.prediction_segment_members_shadow m
  JOIN public.prediction_segment_lists l ON l.id = m.list_id AND l.is_static = false
   AND l.name <> 'Current Returns'
  WHERE m.customer_phone = _phone
  ORDER BY (m.assigned_agent_id IS NOT NULL) DESC, m.updated_at DESC
  LIMIT 1;

  IF v_last_paid_at IS NOT NULL
     AND (c_prev_last_paid_at IS NULL OR v_last_paid_at > c_prev_last_paid_at) THEN
    c_is_completed := false;
    c_in_call_again_until := NULL;
    c_call_again_since := NULL;
  END IF;

  IF v_target_list_name = 'Current Cancels' THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
    c_is_completed := false;
  END IF;

  IF v_recency_strip THEN
    c_assigned_agent_id := NULL;
    c_assigned_agent_name := NULL;
    c_assigned_at := NULL;
  END IF;

  DELETE FROM public.prediction_segment_members_shadow m
  USING public.prediction_segment_lists l
  WHERE m.list_id = l.id AND m.customer_phone = _phone AND l.is_static = false
    AND l.name <> 'Current Returns'
    AND (v_target_list_id IS NULL OR m.list_id <> v_target_list_id);

  IF v_target_list_id IS NOT NULL THEN
    INSERT INTO public.prediction_segment_members_shadow
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
      is_completed = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members_shadow.last_paid_at
                          THEN false ELSE prediction_segment_members_shadow.is_completed END,
      in_call_again_until = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members_shadow.last_paid_at
                                 THEN NULL ELSE prediction_segment_members_shadow.in_call_again_until END,
      call_again_since = CASE WHEN EXCLUDED.last_paid_at IS DISTINCT FROM prediction_segment_members_shadow.last_paid_at
                              THEN NULL ELSE prediction_segment_members_shadow.call_again_since END,
      last_paid_at      = EXCLUDED.last_paid_at,
      paid_count        = EXCLUDED.paid_count,
      lifetime_value    = EXCLUDED.lifetime_value,
      avg_package_price = EXCLUDED.avg_package_price,
      updated_at        = now();
  END IF;

  -- ADDITIVE "Current Returns" (unchanged from v3.3/v3.4)
  SELECT id INTO v_returns_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Current Returns' AND is_active = true;

  IF v_returns_list_id IS NOT NULL THEN
    IF v_newest_is_return THEN
      INSERT INTO public.prediction_segment_members_shadow
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
      DELETE FROM public.prediction_segment_members_shadow
      WHERE list_id = v_returns_list_id AND customer_phone = _phone;
    END IF;
  END IF;

  -- ADDITIVE "Trash List" (engine v3.5 — any-reason trash + reason column)
  SELECT id INTO v_trashed_list_id
  FROM public.prediction_segment_lists
  WHERE name = 'Trash List' AND is_active = true;

  IF v_trashed_list_id IS NOT NULL THEN
    IF v_newest_is_trash THEN
      INSERT INTO public.prediction_segment_members_shadow
        (list_id, customer_phone, customer_name,
         trigger_order_id, trigger_event_at, trigger_price, trigger_trash_reason,
         last_paid_at, paid_count, lifetime_value, avg_package_price,
         assigned_agent_id, assigned_agent_name, assigned_at,
         last_call_outcome, is_completed, updated_at)
      VALUES
        (v_trashed_list_id, _phone, v_customer_name,
         v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_reason,
         v_last_paid_at, v_paid_count, v_lifetime, v_avg_package_price,
         NULL, NULL, NULL, 'trash', false, now())
      ON CONFLICT (list_id, customer_phone) DO UPDATE SET
        customer_name        = EXCLUDED.customer_name,
        trigger_order_id     = EXCLUDED.trigger_order_id,
        trigger_event_at     = EXCLUDED.trigger_event_at,
        trigger_price        = EXCLUDED.trigger_price,
        trigger_trash_reason = EXCLUDED.trigger_trash_reason,
        last_paid_at         = EXCLUDED.last_paid_at,
        paid_count           = EXCLUDED.paid_count,
        lifetime_value       = EXCLUDED.lifetime_value,
        avg_package_price    = EXCLUDED.avg_package_price,
        updated_at           = now();
    ELSE
      DELETE FROM public.prediction_segment_members_shadow
      WHERE list_id = v_trashed_list_id AND customer_phone = _phone;
    END IF;
  END IF;

  -- ADDITIVE "Due to Reorder" (engine v4 — package-based recall; unchanged).
  SELECT id INTO v_reorder_list_id
  FROM public.prediction_segment_lists
  WHERE name = v_reorder_list_name AND is_active = true;

  IF v_reorder_list_id IS NOT NULL THEN
    v_supply_days := NULL;
    IF v_reorder_enabled AND v_last_paid_id IS NOT NULL THEN
      SELECT CASE WHEN v_reorder_agg = 'earliest' THEN MIN(prod_supply) ELSE MAX(prod_supply) END
        INTO v_supply_days
      FROM (
        SELECT SUM(oi.quantity * COALESCE(p.days_of_supply_per_unit, v_reorder_default_supply)) AS prod_supply
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = v_last_paid_id
        GROUP BY oi.product_id
      ) per_product;
    END IF;

    IF v_reorder_enabled AND COALESCE(v_supply_days, 0) > 0 THEN
      v_runs_out_on := v_last_paid_at + (interval '1 day' * v_supply_days);
      v_call_from   := v_runs_out_on - (interval '1 day' * v_reorder_buffer);
      IF now() >= v_call_from THEN
        INSERT INTO public.prediction_segment_members_shadow
          (list_id, customer_phone, customer_name,
           trigger_order_id, trigger_event_at, trigger_price,
           last_paid_at, paid_count, lifetime_value, avg_package_price,
           assigned_agent_id, assigned_agent_name, assigned_at,
           is_completed, updated_at)
        VALUES
          (v_reorder_list_id, _phone, v_customer_name,
           v_disp_order_id, v_disp_at, v_disp_price,
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
        DELETE FROM public.prediction_segment_members_shadow
        WHERE list_id = v_reorder_list_id AND customer_phone = _phone;
      END IF;
    ELSE
      DELETE FROM public.prediction_segment_members_shadow
      WHERE list_id = v_reorder_list_id AND customer_phone = _phone;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.recompute_customer_segments_v4(text) IS
'engine v4 (shadow) 2026-07-07: config-driven bands + comprehensive static "Trash List" mirror of engine v3.5 — newest-order-is-a-trash (ANY reason) is parked in Trash List with trigger_trash_reason; dead-number trashes (wrong_number/wrong_person/not_reachable) also removed from calling bands. Writes prediction_segment_members_shadow. Keep in lockstep with recompute_customer_segments (v3.5) so segment_engine_diff drift stays 0.';

-- ============================================================================
-- 5. Live-vs-shadow diff RPC — refresh the engine-managed-lists literal.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.segment_engine_diff()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH live AS (
    SELECT list_id, count(*) c FROM public.prediction_segment_members GROUP BY list_id
  ), shadow AS (
    SELECT list_id, count(*) c FROM public.prediction_segment_members_shadow GROUP BY list_id
  )
  SELECT jsonb_build_object(
    'lists', COALESCE(jsonb_agg(jsonb_build_object(
        'list_id', l.id, 'name', l.name, 'is_static', l.is_static, 'is_active', l.is_active,
        'live', COALESCE(lv.c, 0), 'shadow', COALESCE(sh.c, 0)
      ) ORDER BY l.display_order)
      FILTER (WHERE l.is_static = false OR l.name IN ('Trash List', 'Due to Reorder')), '[]'::jsonb),
    'drift',
      (SELECT count(*) FROM (
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trash List', 'Due to Reorder')
         EXCEPT
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members_shadow m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trash List', 'Due to Reorder')) a)
      + (SELECT count(*) FROM (
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members_shadow m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trash List', 'Due to Reorder')
         EXCEPT
         SELECT m.customer_phone, m.list_id FROM public.prediction_segment_members m
           JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id
           WHERE l2.is_static = false OR l2.name IN ('Trash List', 'Due to Reorder')) b),
    'live_total', (SELECT count(*) FROM public.prediction_segment_members m
       JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id WHERE l2.is_static = false OR l2.name IN ('Trash List', 'Due to Reorder')),
    'shadow_total', (SELECT count(*) FROM public.prediction_segment_members_shadow m
       JOIN public.prediction_segment_lists l2 ON l2.id = m.list_id WHERE l2.is_static = false OR l2.name IN ('Trash List', 'Due to Reorder'))
  )
  FROM public.prediction_segment_lists l
  LEFT JOIN live lv ON lv.list_id = l.id
  LEFT JOIN shadow sh ON sh.list_id = l.id;
$$;

REVOKE ALL ON FUNCTION public.segment_engine_diff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.segment_engine_diff() TO service_role;

-- ============================================================================
-- 6. Call-Again window extended 3d -> 6d so the paced 2/day × 9-attempt schedule
--    (spanning ~5 calling days) is never cut short by the lazy revert-to-pending.
--    The 9-no-answer auto-trash (POST /call-logs) is now the real terminator;
--    this window is only the eventual backstop.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expire_call_again_window()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
     SET status = 'pending',
         call_again_since = NULL,
         next_call_after = NULL
   WHERE status = 'call_again'
     AND call_again_since IS NOT NULL
     AND call_again_since < now() - interval '6 days';

  UPDATE public.prediction_segment_members
     SET call_again_since = NULL,
         in_call_again_until = NULL
   WHERE call_again_since IS NOT NULL
     AND call_again_since < now() - interval '6 days'
     AND is_completed = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_call_again_window() TO authenticated;

COMMIT;

-- Full repair pass with the updated engines (outside the DDL transaction).
-- Populates Trash List for every customer whose newest order is a trash of any
-- reason (with reason), removes dead-number trashes from calling bands, and
-- keeps the v4 shadow table in lockstep.
SELECT public.recompute_all_segments();
SELECT public.recompute_all_segments_v4();
