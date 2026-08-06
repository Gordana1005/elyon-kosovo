-- ============================================================================
-- ENGINE v3.7-mk — STICKY TRASH (2026-08-06)
-- ============================================================================
-- OPERATOR DECISION (Macedonia): "Make sure the trashes stay in trashes, no
-- need to re-appear in the lists. Once it is trashed it is trashed for a reason
-- so it needs to stay in the trash list without automatically blending again in
-- the other prediction lists." Plus, on the measured data: "a paid order
-- releases them yes; if that customer comes as a new pending, then it goes into
-- pending and after the pending, whatever status it becomes, it goes there."
--
-- CHANGE vs v3.6 (20260731000000), applied identically to BOTH engines
-- (live recompute_customer_segments + shadow recompute_customer_segments_v4)
-- so live-vs-shadow parity stays 0:
--
--   BEFORE (v3.5-v3.6)                    AFTER (v3.7-mk)
--   ------------------------------------  ------------------------------------
--   Trash List = "newest order is a       Trash List = "has been trashed and
--   trash"; ANY newer order released      has not bought since". A newer
--   them — even a pending lead.           PENDING / CANCEL / RETURN does not
--                                         release; only a PAID order does.
--   Only wrong_number / wrong_person /    EVERY trash reason drops the phone
--   not_reachable dropped the phone from  from every calling band, EXCEPT
--   calling bands. rude / uncooperative / duplicate_order. rude, uncooperative
--   other stayed callable.                and other no longer stay callable.
--   No expiry.                            not_reachable parks 21 days from
--                                         orders.trashed_at, then releases
--                                         automatically (nightly recompute).
--   Current Returns kept a trashed        Sticky trash also suppresses the
--   customer callable — the nuclear       ADDITIVE Current Returns mirror.
--   delete spares that list by name.      (Current Cancels needs no guard: it
--                                         is reached via v_target_list_name,
--                                         which the trash branch already NULLs.)
--
-- TWO DELIBERATE DEVIATIONS FROM THE BULGARIAN v3.7 (do not "fix" them):
--   1. A PAID order dated after the trash releases the customer. Measured on
--      live MK data 2026-08-06: 13.784 currently-callable customers carry a
--      trash, and 2.391 of them went on to PAY us afterwards — nearly all
--      AlterCPA "wrong_person / did not order" tags on numbers that later
--      converted. Bulgaria deletes those 2.391 forever; Macedonia keeps them,
--      because money is better evidence than a disposition click.
--   2. duplicate_order is NOT a trash of the customer. It is our own double-lead
--      cleanup, so it neither drops them from a band nor shows in the Trash
--      List. Bulgaria treats it as permanent (and its own code comment says the
--      opposite of its SQL — that inconsistency is not carried over).
--
-- The 21-day timer needs orders.trashed_at — added by 20260913000100, which
-- MUST be applied first (backfill + BEFORE trigger). duplicate_order needs the
-- widened CHECK from 20260913000000.
--
-- SCOPE NOTE: this only governs PREDICTION lists. A trashed phone that sends a
-- brand-new lead still arrives as a normal pending order and is callable — the
-- rule stops us re-dialling junk out of the re-marketing lists, not new business.
--
-- After: node scripts/audit-segments-integrity.mjs (all PASS — check #11 was
--        rewritten for this invariant in the same commit) +
--        node scripts/segment-engine-parity.mjs (drift 0).
-- Never re-run older engine migration SQL over this. One version = one file.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_customer_segments(_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $ELYON$
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

  -- trashed (engine v3.7): STICKY trash — see the detection block below.
  v_newest_order_id UUID;                      -- the trash order holding them (not "newest order overall")
  v_newest_order_at TIMESTAMPTZ;
  v_newest_order_price NUMERIC;
  v_newest_order_status TEXT;
  v_newest_order_reason TEXT;
  v_perm_trashed BOOLEAN := false;             -- permanently trashed, and has not bought since
  v_perm_trash_at TIMESTAMPTZ;                 -- newest permanent-class trash (drives the release test)
  v_unreachable_trash_at TIMESTAMPTZ;          -- newest not_reachable trash → 21-day park
  v_parked_unreachable BOOLEAN := false;
  v_newest_is_trash BOOLEAN := false;          -- in the Trash List
  v_newest_is_nocall_trash BOOLEAN := false;   -- removed from every calling band (v3.7: same condition)
  v_trashed_list_id UUID;

  v_has_inflight BOOLEAN := false;
  v_has_monadon BOOLEAN := false;

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
  -- engine v3.7 (operator 2026-08-05): a trash is STICKY. It is no longer
  -- "the customer's newest order happens to be a trash" — placing a new order
  -- does NOT wash a trash away. Two classes:
  --   PERMANENT — wrong_number, wrong_person, rude, uncooperative, other, and
  --               legacy rows with no reason recorded. Removed from every
  --               calling band and held in the Trash List. The ONLY release is a
  --               paid order dated after the trash (see below).
  --   PARKED    — not_reachable only (the manual "Unreachable" pick and the
  --               9-no-answer auto-trash). Held 21 days from trashed_at, then
  --               released back into the normal bands by the nightly recompute.
  --               Permanent always beats parked.
  --   NOT A TRASH OF THE CUSTOMER — duplicate_order. MK deviation from Bulgaria
  --               (which treats it as permanent): de-duplicating our own double
  --               lead is housekeeping, not customer behaviour, so it neither
  --               drops them from a calling band nor puts them in the Trash List.
  SELECT max(COALESCE(trashed_at, created_at)) INTO v_perm_trash_at
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'trashed'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
    AND trash_reason IS DISTINCT FROM 'not_reachable'
    AND trash_reason IS DISTINCT FROM 'duplicate_order';

  -- THE ONE WAY OUT (MK, operator 2026-08-06): a PAID order dated after the
  -- trash releases them. Money proves the number is live and the person real,
  -- whatever an agent once tagged them — and 2.391 Macedonian customers had
  -- already paid us AFTER being trashed (mostly AlterCPA "did not order" leads
  -- on numbers that later converted). Without this test they would be deleted
  -- from re-marketing forever. NOTHING else releases: a later pending lead,
  -- cancel or return leaves the trash standing.
  v_perm_trashed := (v_perm_trash_at IS NOT NULL
                     AND (v_last_paid_at IS NULL OR v_last_paid_at <= v_perm_trash_at));

  SELECT max(COALESCE(trashed_at, created_at)) INTO v_unreachable_trash_at
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'trashed'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
    AND trash_reason = 'not_reachable';

  -- Same release test: someone who paid after we gave up reaching them is
  -- self-evidently reachable, so the 21-day park ends early.
  v_parked_unreachable := (NOT v_perm_trashed
                           AND v_unreachable_trash_at IS NOT NULL
                           AND (now() - v_unreachable_trash_at) < interval '21 days'
                           AND (v_last_paid_at IS NULL OR v_last_paid_at <= v_unreachable_trash_at));

  -- The trash order actually holding them — feeds the Trash List row's reason,
  -- date and price columns. Permanent reasons win over a parked unreachable.
  SELECT id, COALESCE(trashed_at, created_at), price, status, trash_reason
    INTO v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_status, v_newest_order_reason
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'trashed'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
    AND trash_reason IS DISTINCT FROM 'duplicate_order'
    AND ((v_perm_trashed AND trash_reason IS DISTINCT FROM 'not_reachable')
      OR (NOT v_perm_trashed AND trash_reason = 'not_reachable'))
  ORDER BY COALESCE(trashed_at, created_at) DESC
  LIMIT 1;

  -- Same two downstream consumers as v3.5/v3.6: v_newest_is_trash drives Trash
  -- List membership, v_newest_is_nocall_trash drives "drop from every calling
  -- band". Under v3.7 they are the SAME condition — a live trash of any reason
  -- (bar duplicate_order) is never called from a prediction list again.
  v_newest_is_trash := (v_perm_trashed OR v_parked_unreachable);
  v_newest_is_nocall_trash := v_newest_is_trash;

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone
      AND status IN ('pending','take','call_again','confirmed','shipped','delivered')
      AND source_type IS DISTINCT FROM 'monadon_legacy'
  ) INTO v_has_inflight;

  -- Is this phone a Monadon (competitor) legacy client? (i.e. in FULL MONAD LIST)
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone AND source_type = 'monadon_legacy'
  ) INTO v_has_monadon;

  -- Frequency label: literally true for every member; most specific wins.
  IF v_paid_count >= 7 THEN v_freq_bucket := '(7+ orders)';
  ELSIF v_paid_count >= 5 THEN v_freq_bucket := '(5+ orders)';
  ELSIF v_paid_count >= 3 THEN v_freq_bucket := '(3+ orders)';
  ELSE v_freq_bucket := '(1-3 orders)';
  END IF;

  IF v_newest_is_nocall_trash THEN
    -- v3.7: the customer has been trashed (any reason). Drop them from ALL
    -- calling bands (target NULL -> nuclear delete below) and place them in the
    -- static Trash List (additive block at the end). Permanent reasons never
    -- clear; a not_reachable park clears itself 21 days after trashed_at, on the
    -- next recompute.
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
    IF v_has_monadon THEN
      -- Monadon (competitor) legacy client who has since become an unconverted
      -- lead with us: keep them OUT of Never-Converted. They belong ONLY in the
      -- static "FULL MONAD LIST" re-marketing pool (operator decision 2026-07-09).
      -- If they ever actually buy (paid_count > 0) they graduate to a normal band.
      v_target_list_name := NULL;
    ELSE
      v_target_is_cancel := true;
      IF v_last_cancelled_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (now() - v_last_cancelled_at)) / 86400.0 <= 180 THEN
        v_target_list_name := 'Never-Converted Recent';
      ELSE
        v_target_list_name := 'Never-Converted Old';
      END IF;
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
    -- v3.7: Current Returns is ADDITIVE, so the nuclear delete above spares it
    -- by name — which means a trashed customer would otherwise stay callable
    -- here. Sticky trash has to win over the returns mirror too.
    IF v_newest_is_return AND NOT v_newest_is_trash THEN
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

  -- ADDITIVE "Trash List" membership (engine v3.7, operator 2026-08-05): the
  -- customer has been trashed and has not served out a not_reachable park.
  -- Static list, UNASSIGNED, is_completed=false so it is VISIBLE by default but
  -- never enters a calling queue. trigger_trash_reason carries the reason for
  -- the UI. Permanent reasons stay here until the customer actually BUYS again
  -- — a later pending/cancel/return no longer releases them. A not_reachable
  -- park also expires on its own (21 days). The DELETE below is what lets them
  -- out in either case.
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
$ELYON$;

COMMENT ON FUNCTION public.recompute_customer_segments(text) IS $C$engine v3.7-mk 2026-08-06: STICKY TRASH — a phone with ANY trashed order whose reason is not 'not_reachable' and not 'duplicate_order' is removed from every calling band and held in the Trash List; a later pending, cancel or return no longer releases them, and the ONLY release is a PAID order dated after that trash. A 'not_reachable' trash parks them for 21 days from orders.trashed_at (or until they pay) and then releases automatically on the nightly recompute. 'duplicate_order' is lead-de-duplication housekeeping: the customer keeps their normal band and never enters the Trash List (MK deviation from Bulgaria, which treats it as permanent). Supersedes the v3.5 "newest order is a trash" routing and the dead-number-only band removal. All other v3.6 rules retained, namely — engine v3.6 2026-07-09: identical to v3.5 EXCEPT a Monadon (FULL MONAD LIST) legacy client who has since become an unconverted lead (paid_count=0) is kept OUT of Never-Converted Recent/Old (target NULL) so they live ONLY in the static FULL MONAD LIST re-marketing pool; if they ever actually buy they graduate to a normal paid band. All v3.5 rules retained. Canonical file: 20260731000000_monadon_excluded_from_never_converted.sql (supersedes 20260730000000). Do NOT re-run older engine SQL over this.$C$;

CREATE OR REPLACE FUNCTION public.recompute_customer_segments_v4(_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $ELYON$
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
  v_perm_trashed BOOLEAN := false;
  v_perm_trash_at TIMESTAMPTZ;
  v_unreachable_trash_at TIMESTAMPTZ;
  v_parked_unreachable BOOLEAN := false;
  v_newest_is_trash BOOLEAN := false;
  v_newest_is_nocall_trash BOOLEAN := false;
  v_trashed_list_id UUID;

  v_has_inflight BOOLEAN := false;
  v_has_monadon BOOLEAN := false;

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

  -- engine v3.7 (operator 2026-08-05): a trash is STICKY. It is no longer
  -- "the customer's newest order happens to be a trash" — placing a new order
  -- does NOT wash a trash away. Two classes:
  --   PERMANENT — wrong_number, wrong_person, rude, uncooperative, other, and
  --               legacy rows with no reason recorded. Removed from every
  --               calling band and held in the Trash List. The ONLY release is a
  --               paid order dated after the trash (see below).
  --   PARKED    — not_reachable only (the manual "Unreachable" pick and the
  --               9-no-answer auto-trash). Held 21 days from trashed_at, then
  --               released back into the normal bands by the nightly recompute.
  --               Permanent always beats parked.
  --   NOT A TRASH OF THE CUSTOMER — duplicate_order. MK deviation from Bulgaria
  --               (which treats it as permanent): de-duplicating our own double
  --               lead is housekeeping, not customer behaviour, so it neither
  --               drops them from a calling band nor puts them in the Trash List.
  SELECT max(COALESCE(trashed_at, created_at)) INTO v_perm_trash_at
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'trashed'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
    AND trash_reason IS DISTINCT FROM 'not_reachable'
    AND trash_reason IS DISTINCT FROM 'duplicate_order';

  -- THE ONE WAY OUT (MK, operator 2026-08-06): a PAID order dated after the
  -- trash releases them. Money proves the number is live and the person real,
  -- whatever an agent once tagged them — and 2.391 Macedonian customers had
  -- already paid us AFTER being trashed (mostly AlterCPA "did not order" leads
  -- on numbers that later converted). Without this test they would be deleted
  -- from re-marketing forever. NOTHING else releases: a later pending lead,
  -- cancel or return leaves the trash standing.
  v_perm_trashed := (v_perm_trash_at IS NOT NULL
                     AND (v_last_paid_at IS NULL OR v_last_paid_at <= v_perm_trash_at));

  SELECT max(COALESCE(trashed_at, created_at)) INTO v_unreachable_trash_at
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'trashed'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
    AND trash_reason = 'not_reachable';

  -- Same release test: someone who paid after we gave up reaching them is
  -- self-evidently reachable, so the 21-day park ends early.
  v_parked_unreachable := (NOT v_perm_trashed
                           AND v_unreachable_trash_at IS NOT NULL
                           AND (now() - v_unreachable_trash_at) < interval '21 days'
                           AND (v_last_paid_at IS NULL OR v_last_paid_at <= v_unreachable_trash_at));

  -- The trash order actually holding them — feeds the Trash List row's reason,
  -- date and price columns. Permanent reasons win over a parked unreachable.
  SELECT id, COALESCE(trashed_at, created_at), price, status, trash_reason
    INTO v_newest_order_id, v_newest_order_at, v_newest_order_price, v_newest_order_status, v_newest_order_reason
  FROM public.orders
  WHERE customer_phone = _phone
    AND status = 'trashed'
    AND source_type IS DISTINCT FROM 'monadon_legacy'
    AND trash_reason IS DISTINCT FROM 'duplicate_order'
    AND ((v_perm_trashed AND trash_reason IS DISTINCT FROM 'not_reachable')
      OR (NOT v_perm_trashed AND trash_reason = 'not_reachable'))
  ORDER BY COALESCE(trashed_at, created_at) DESC
  LIMIT 1;

  -- Same two downstream consumers as v3.5/v3.6: v_newest_is_trash drives Trash
  -- List membership, v_newest_is_nocall_trash drives "drop from every calling
  -- band". Under v3.7 they are the SAME condition — no trash of any reason is
  -- ever called from a prediction list again.
  v_newest_is_trash := (v_perm_trashed OR v_parked_unreachable);
  v_newest_is_nocall_trash := v_newest_is_trash;

  v_avg_package_price := CASE WHEN v_paid_count > 0 THEN v_lifetime / v_paid_count ELSE NULL END;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone
      AND status IN ('pending','take','call_again','confirmed','shipped','delivered')
      AND source_type IS DISTINCT FROM 'monadon_legacy'
  ) INTO v_has_inflight;

  -- Is this phone a Monadon (competitor) legacy client? (i.e. in FULL MONAD LIST)
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_phone = _phone AND source_type = 'monadon_legacy'
  ) INTO v_has_monadon;

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
    IF v_has_monadon THEN
      -- Monadon (competitor) legacy client who has since become an unconverted
      -- lead with us: keep them OUT of Never-Converted. They belong ONLY in the
      -- static "FULL MONAD LIST" re-marketing pool (operator decision 2026-07-09).
      -- If they ever actually buy (paid_count > 0) they graduate to a normal band.
      v_target_list_name := NULL;
    ELSE
      v_target_is_cancel := true;
      IF v_last_cancelled_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (now() - v_last_cancelled_at)) / 86400.0 <= v_nc_recent_days THEN
        v_target_list_name := 'Never-Converted Recent';
      ELSE
        v_target_list_name := 'Never-Converted Old';
      END IF;
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
    -- v3.7: Current Returns is ADDITIVE, so the nuclear delete above spares it
    -- by name — which means a trashed customer would otherwise stay callable
    -- here. Sticky trash has to win over the returns mirror too.
    IF v_newest_is_return AND NOT v_newest_is_trash THEN
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

  -- ADDITIVE "Trash List" (engine v3.7 — sticky trash; not_reachable expires 21d)
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
$ELYON$;

COMMENT ON FUNCTION public.recompute_customer_segments_v4(text) IS $C$engine v4 (shadow) 2026-08-06: carries the v3.7-mk sticky-trash rule — paid-order release, duplicate_order carve-out and all (mirror of recompute_customer_segments). Previously — engine v4 (shadow) 2026-07-09: config-driven bands + the v3.6 Monadon-excluded-from-Never-Converted rule (mirror of recompute_customer_segments). Writes prediction_segment_members_shadow. Keep in lockstep so segment_engine_diff drift stays 0.$C$;

COMMIT;

-- Targeted recompute (outside the DDL txn). Two sets, in both engines so
-- live+shadow stay in lockstep (parity 0):
--   1. every phone that has ever been trashed — they must now leave their
--      calling band and enter/stay in the Trash List (or, for an expired
--      not_reachable, leave the Trash List and rejoin a band);
--   2. every phone currently sitting in the Trash List — so anyone the new rule
--      releases is actually removed.
-- Everything else is untouched.
-- Inlined (not a TEMP table): these statements run OUTSIDE the DDL transaction,
-- so a `CREATE TEMP TABLE ... ON COMMIT DROP` would be dropped by its own
-- implicit commit before the next statement could read it.
SELECT public.recompute_customer_segments(customer_phone)
  FROM (
    SELECT DISTINCT customer_phone FROM public.orders WHERE status = 'trashed'
    UNION
    SELECT DISTINCT m.customer_phone
      FROM public.prediction_segment_members m
      JOIN public.prediction_segment_lists l ON l.id = m.list_id
     WHERE l.name = 'Trash List'
  ) s;

SELECT public.recompute_customer_segments_v4(customer_phone)
  FROM (
    SELECT DISTINCT customer_phone FROM public.orders WHERE status = 'trashed'
    UNION
    SELECT DISTINCT m.customer_phone
      FROM public.prediction_segment_members m
      JOIN public.prediction_segment_lists l ON l.id = m.list_id
     WHERE l.name = 'Trash List'
  ) s;
