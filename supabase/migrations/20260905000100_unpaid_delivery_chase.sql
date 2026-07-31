-- ============================================================================
-- Unpaid-delivery chase alerts (2026-09-05)
-- ============================================================================
-- WHY: most returns are avoidable. A parcel ships, the client never collects it
-- from the office, nobody calls, and days later the courier sends it back and we
-- eat the shipping both ways. The signal already exists in the data — an order
-- sitting in `shipped` with no `paid` — but nothing pushes it at anyone. The
-- agent only sees it if they happen to open Dashboard -> My Orders -> Shipped.
--
-- Measured on prod the day this was written (2026-07-22): 38 orders in
-- `shipped`, of which 20 were unpaid for 3+ days, across 10 agents, the oldest
-- (ORD-33533) shipped 2026-06-25 — 27 days uncollected. The BigArena status
-- sync had run that same afternoon, so those were genuinely stuck parcels, not
-- sync lag.
--
-- WHAT: every morning, each order that has been shipped >= `unpaid_chase_days`
-- and is still unpaid pings its OWNING agent, and every superadmin gets ONE
-- digest instead of a copy per order. Repeats daily until the order leaves
-- `shipped` (operator's explicit choice) or ages past `unpaid_chase_stop_days`.
--
-- DESIGN NOTES
--   * The job NEVER writes to `orders`. All state lives in the ledger table
--     below, so it cannot disturb the status / shipped_at / paid_at / history
--     triggers or bump `updated_at` on 38 rows every morning.
--   * `(order_id, alert_date)` is the primary key, and that IS the idempotency
--     guarantee: run the job once or five times in a morning, each order still
--     produces exactly one ping.
--   * Scheduled hourly but gated to 09:00-11:00 Europe/Skopje, so a missed 09:00
--     tick (DB restart, cron blip) self-heals at 10:00 without double-sending.
--     DST-proof, unlike a fixed UTC hour.
--   * Owner = COALESCE(confirmed_by_agent_id, assigned_agent_id) — byte-for-byte
--     the salesOwnerId() rule the edge function uses for My Orders and for
--     commissions. If those ever disagree, the wrong agent gets chased.
--   * NO blanket exception swallow at function level. Unlike the notification
--     TRIGGERS (which must never roll back a business write), this job writes
--     nothing business-critical, so a genuine failure must surface in
--     cron.job_run_details instead of silently reporting success. Each order is
--     still wrapped individually so one bad row cannot kill the whole run.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Ledger: what we have already pinged about, and when.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_unpaid_alerts (
  order_id     uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  alert_date   date        NOT NULL,           -- Europe/Skopje calendar day
  days_shipped int         NOT NULL,
  owner_id     uuid,                           -- agent notified (NULL = unowned order)
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, alert_date)           -- one ping per order per day, always
);

CREATE INDEX IF NOT EXISTS idx_order_unpaid_alerts_date
  ON public.order_unpaid_alerts (alert_date);

COMMENT ON TABLE public.order_unpaid_alerts IS
  '2026-09: append-only record of unpaid-delivery chase pings. The (order_id, alert_date) PK makes notify_unpaid_shipped_orders() idempotent per day. Internal only — no client ever reads this.';

-- Internal bookkeeping: nobody but the SECURITY DEFINER function (and
-- service_role) may touch it. RLS with zero policies denies everything, and the
-- REVOKE closes the direct-grant path that the 2026-07-22 sweep found wide open
-- on the backup tables. REVOKE FROM PUBLIC, not just anon — `authenticated`
-- inherits PUBLIC, and an affiliate login is `authenticated` too.
ALTER TABLE public.order_unpaid_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_unpaid_alerts FROM PUBLIC;
REVOKE ALL ON public.order_unpaid_alerts FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Operator-tunable knobs (Settings -> Notifications)
-- ────────────────────────────────────────────────────────────────────────────
-- unpaid_chase_days      = first ping on day N after shipping (operator: 3)
-- unpaid_chase_stop_days = stop pinging once the order is older than this. This
--                          is the ONLY place alerts go quiet — raise it to 999
--                          to chase forever.
INSERT INTO public.app_settings (key, value) VALUES
  ('unpaid_chase_days',      '3'::jsonb),
  ('unpaid_chase_stop_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) The job
-- ────────────────────────────────────────────────────────────────────────────
-- _force   = ignore the 09:00-11:00 Sofia window (manual/test run)
-- _dry_run = count what WOULD be sent, write absolutely nothing
CREATE OR REPLACE FUNCTION public.notify_unpaid_shipped_orders(
  _force   boolean DEFAULT false,
  _dry_run boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  _threshold   int;
  _stop        int;
  _skopje_now   timestamp := now() AT TIME ZONE 'Europe/Skopje';
  _today       date;
  _day_start   timestamptz;
  _sent        int := 0;   -- agent notifications inserted
  _new_today   int := 0;   -- orders crossing the threshold for the FIRST time
  _total       int := 0;   -- ALL orders unpaid >= threshold (digest headline)
  _sync_age    int;        -- hours since the last BigArena status sync
  _oldest_id   text;
  _oldest_days int;
  _who         text;
  _r           record;
BEGIN
  _today     := _skopje_now::date;
  _day_start := _today::timestamp AT TIME ZONE 'Europe/Skopje';

  -- Morning window only, unless forced. Hourly schedule + this gate + the
  -- ledger PK = self-healing without double-sending.
  IF NOT _force AND EXTRACT(hour FROM _skopje_now)::int NOT BETWEEN 9 AND 11 THEN
    RETURN 0;
  END IF;

  -- app_settings.value is jsonb: `value::int` is NOT a valid cast, the `#>> '{}'`
  -- unwrap to text is required. Getting this wrong fails at runtime, not at
  -- migration time.
  SELECT (value #>> '{}')::int INTO _threshold FROM public.app_settings WHERE key = 'unpaid_chase_days';
  SELECT (value #>> '{}')::int INTO _stop      FROM public.app_settings WHERE key = 'unpaid_chase_stop_days';
  _threshold := GREATEST(COALESCE(_threshold, 3), 1);
  _stop      := GREATEST(COALESCE(_stop, 30), _threshold);

  -- ── per-order pings ──────────────────────────────────────────────────────
  FOR _r IN
    SELECT o.id,
           COALESCE(o.display_id, left(o.id::text, 8)) AS label,
           o.customer_name,
           o.customer_phone,
           COALESCE(o.confirmed_by_agent_id, o.assigned_agent_id) AS owner_id,
           (_today - (o.shipped_at AT TIME ZONE 'Europe/Skopje')::date) AS days
    FROM public.orders o
    WHERE o.status IN ('shipped', 'delivered')   -- `delivered` is dead (0 rows) but eligible in the BigArena sync, so keep it
      AND o.shipped_at IS NOT NULL               -- ~11k legacy imports have no event time; NULL = unknown, never guess
      AND o.duplicated_from IS NULL              -- admin-only order copies are never agent-attributed
      AND o.source_type IS DISTINCT FROM 'monadon_legacy'
      AND (_today - (o.shipped_at AT TIME ZONE 'Europe/Skopje')::date) BETWEEN _threshold AND _stop
    ORDER BY o.shipped_at ASC
  LOOP
    BEGIN
      -- Already handled today? (cheap pre-check; the INSERT below is the
      -- race-safe authority)
      IF EXISTS (
        SELECT 1 FROM public.order_unpaid_alerts a
        WHERE a.order_id = _r.id AND a.alert_date = _today
      ) THEN
        CONTINUE;
      END IF;

      -- First time this order has EVER been chased.
      IF NOT EXISTS (
        SELECT 1 FROM public.order_unpaid_alerts a
        WHERE a.order_id = _r.id AND a.alert_date < _today
      ) THEN
        _new_today := _new_today + 1;
      END IF;

      IF _dry_run THEN
        IF _r.owner_id IS NOT NULL THEN _sent := _sent + 1; END IF;
        CONTINUE;
      END IF;

      INSERT INTO public.order_unpaid_alerts (order_id, alert_date, days_shipped, owner_id)
      VALUES (_r.id, _today, _r.days, _r.owner_id)
      ON CONFLICT (order_id, alert_date) DO NOTHING;
      IF NOT FOUND THEN
        CONTINUE;  -- a concurrent run won the race
      END IF;

      -- Agent copy. Skipped for unowned or deactivated-agent orders — those
      -- still show up in the admin digest, so nothing goes unwatched.
      IF _r.owner_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _r.owner_id AND p.is_active)
      THEN
        _who := COALESCE(NULLIF(_r.customer_name, ''), _r.customer_phone, '');
        INSERT INTO public.notifications (user_id, type, title, message, link, meta)
        VALUES (
          _r.owner_id,
          'shipped_unpaid',
          'Delivery not picked up',
          'Order ' || _r.label || ' (' || _who || ') shipped ' || _r.days::text
            || ' days ago and is still unpaid — call the client.',
          '/?tab=shipped',
          jsonb_build_object(
            'i18n',     'notif.shippedUnpaid',
            'order',    _r.label,
            'customer', _who,
            'days',     _r.days,
            'phone',    _r.customer_phone,
            'orderId',  _r.id
          )
        );
        _sent := _sent + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- One malformed row must not abort the morning run. The subtransaction
      -- rolls back this order's ledger row, so it is retried tomorrow.
      CONTINUE;
    END;
  END LOOP;

  IF _dry_run THEN
    RETURN _sent;
  END IF;

  -- ── admin digest ─────────────────────────────────────────────────────────
  -- Headline counts the FULL problem (every order unpaid >= threshold, with no
  -- upper bound), not just the ones that pinged an agent today — otherwise
  -- orders aged past `unpaid_chase_stop_days` would silently vanish from
  -- oversight, which is exactly the kind of blind spot this feature exists to
  -- remove.
  SELECT count(*)::int,
         (array_agg(COALESCE(o.display_id, left(o.id::text, 8)) ORDER BY o.shipped_at ASC))[1],
         max(_today - (o.shipped_at AT TIME ZONE 'Europe/Skopje')::date)
    INTO _total, _oldest_id, _oldest_days
  FROM public.orders o
  WHERE o.status IN ('shipped', 'delivered')
    AND o.shipped_at IS NOT NULL
    AND o.duplicated_from IS NULL
    AND o.source_type IS DISTINCT FROM 'monadon_legacy'
    AND (_today - (o.shipped_at AT TIME ZONE 'Europe/Skopje')::date) >= _threshold;

  IF COALESCE(_total, 0) = 0 THEN
    RETURN _sent;
  END IF;

  -- How fresh is the data behind those numbers? The BigArena tracking upload is
  -- a MANUAL daily job; if it was skipped, orders already collected still look
  -- unpaid and the digest overstates the problem. Report the staleness rather
  -- than muting the alerts — muting would hide real returns.
  BEGIN
    SELECT (EXTRACT(epoch FROM (now() - max(created_at))) / 3600)::int
      INTO _sync_age
    FROM public.audit_log
    WHERE action = 'order.bigarena_status_sync';
  EXCEPTION WHEN OTHERS THEN
    _sync_age := NULL;
  END;

  INSERT INTO public.notifications (user_id, type, title, message, link, meta)
  SELECT ur.user_id,
         'unpaid_digest',
         'Unpaid deliveries',
         _total::text || ' shipped orders are still unpaid after ' || _threshold::text
           || '+ days (' || _new_today::text || ' new today). Oldest: '
           || COALESCE(_oldest_id, '—') || ' — ' || COALESCE(_oldest_days, 0)::text || ' days.',
         '/orders',
         jsonb_build_object(
           'i18n',         'notif.unpaidDigest',
           'total',        _total,
           'new',          _new_today,
           'days',         _threshold,
           'oldestOrder',  _oldest_id,
           'oldestDays',   _oldest_days,
           'syncAgeHours', _sync_age
         )
  FROM public.user_roles ur
  JOIN public.profiles p ON p.user_id = ur.user_id AND p.is_active
  WHERE ur.role = 'admin'
    -- one digest per admin per Sofia day, even if the job runs at 9, 10 and 11
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = ur.user_id
        AND n.type = 'unpaid_digest'
        AND n.created_at >= _day_start
    );

  RETURN _sent;
END;
$fn$;

COMMENT ON FUNCTION public.notify_unpaid_shipped_orders(boolean, boolean) IS
  '2026-09: daily unpaid-delivery chase. Pings the owning agent per stale shipped order + one digest per superadmin. Idempotent via order_unpaid_alerts(order_id, alert_date). Returns the number of agent notifications sent. (_force) skips the 09-11 Sofia gate, (_dry_run) writes nothing.';

-- Default on any new function is EXECUTE TO PUBLIC — precisely the hole the
-- 2026-07-22 sweep closed on the maintenance RPCs. Only pg_cron (postgres) and
-- service_role should ever run this.
REVOKE ALL ON FUNCTION public.notify_unpaid_shipped_orders(boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_unpaid_shipped_orders(boolean, boolean) FROM anon, authenticated;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Schedule — hourly, self-gated to the 09:00-11:00 Sofia window.
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent: replace any previous schedule with the same name.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'unpaid-delivery-chase') THEN
    PERFORM cron.unschedule('unpaid-delivery-chase');
  END IF;
END
$cron$;

SELECT cron.schedule(
  'unpaid-delivery-chase',
  '0 * * * *',
  $job$SELECT public.notify_unpaid_shipped_orders();$job$
);
