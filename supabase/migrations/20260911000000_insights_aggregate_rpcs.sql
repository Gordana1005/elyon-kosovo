-- ============================================================================
-- INSIGHTS AGGREGATE RPCs (2026-08-05) — phase 2 of the reporting performance work
--
-- GET /management-insights streamed every matching order (plus its order_items)
-- into the edge function 1000 rows at a time and aggregated ~630 lines of
-- JavaScript over them. At a 12-month range that is ~65 sequential round-trips,
-- tens of MB of JSON, and measured 28-42 seconds wall clock.
--
-- These functions do the same arithmetic as GROUP BY. Measured on live data the
-- underlying scans cost 47-95 ms each.
--
-- ── THE RULE THAT MAKES THIS SAFE ──────────────────────────────────────────
-- Only the four O(n) ROW LOOPS move. Everything downstream — every .sort(),
-- topN(), r2(), floorPriceFor(), pctl(), and the final json({...}) literal —
-- stays in TypeScript, untouched. These functions return exactly the
-- intermediate maps those loops built (statusDist, trend, cityMap, prodMap,
-- agMap, paidProdMap, logisticsMap, plMap, ...), so the response is assembled by
-- the same code as before and its SHAPE cannot drift.
--
-- Three consequences worth stating explicitly:
--   * normAgent() is NEVER ported. SQL groups by the RAW operator name and the
--     existing TS function merges. Postgres has no \p{L}; the nearest
--     equivalent [[:alpha:]] is lc_ctype-dependent, so under a C-ish ctype
--     "Елена Т." would NOT collapse to "Елена" and the Agents tab would split
--     into two half-revenue rows. Grouping raw side-steps that entirely.
--   * NOTHING IS ROUNDED HERE. r2() = Math.round(n*100)/100 is not
--     round(numeric,2): for 12.345 the former yields 12.34 (the nearest double
--     is 12.34499999999999975) and the latter 12.35. Rounding in SQL would move
--     cents unpredictably. Raw values out; TS rounds.
--   * The paid basis computes in float8, not numeric, because those values flow
--     into r2() and numeric division has different tie behaviour.
--
-- SET TimeZone='UTC' is load-bearing: it pins the existing UTC bucketing (and
-- makes 'YYYY-MM-DD' bounds resolve to UTC midnight exactly as PostgREST does)
-- regardless of any future role/session timezone change. This is deliberately
-- NOT Europe/Skopje — moving report buckets to local time is a separate,
-- user-visible decision that re-buckets every historical chart.
--
-- Read-side only. No writes, no schema changes.
-- ============================================================================

-- ── helpers ────────────────────────────────────────────────────────────────

-- JS Math.round(): ties go toward +Infinity, on IEEE-754 doubles.
-- NOT floor(x+0.5), which mis-rounds 0.49999999999999994 up to 1.
CREATE OR REPLACE FUNCTION public.js_round(x double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN x IS NULL THEN NULL
              WHEN x - floor(x) >= 0.5 THEN floor(x) + 1
              ELSE floor(x) END
$$;

-- The EXACT 0-based index the TS pctl() picks:
--   Math.min(len-1, Math.max(0, Math.round((p/100)*(len-1))))
-- percentile_disc is NOT this: it picks ceil(f*N)-1. At N=4, f=0.5 that is
-- index 1 where JS picks index 2 — a different value.
CREATE OR REPLACE FUNCTION public.js_pctl_index(p int, n bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN n <= 0 THEN 0
              ELSE least(n - 1, greatest(0, round((p::numeric / 100) * (n - 1))::bigint)) END
$$;


-- ── 1. insights_orders_rollup ──────────────────────────────────────────────
-- Replaces the main order loop (the statusDist / trend / city / delivery /
-- source / agent / returns / cancels / logistics / prediction blocks) and the
-- per-agent triple filter.
--
-- Agents come back at RAW-name grain plus the payout counters, so TS applies
-- normAgent once for the bucket key and twice for the payout key — reproducing
-- the existing (non-idempotent) double normalisation verbatim.
CREATE OR REPLACE FUNCTION public.insights_orders_rollup(p_from text, p_to_end text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET TimeZone = 'UTC' SET work_mem = '64MB'
AS $$
WITH base AS (
  -- Exactly the legacy filter. Project only what is needed: `g` is referenced
  -- many times so Postgres materialises it, and SELECT * would spill ~60 wide
  -- columns × 75k rows to a temp file on a small instance.
  SELECT o.id, o.status::text AS status, o.price, o.quantity,
         o.customer_city, o.courier_office_city, o.delivery_type, o.home_courier,
         o.assigned_agent_name, o.confirmed_by_name, o.cancelled_by_agent_id,
         o.source_type, o.created_at, o.cancellation_reason, o.return_reason,
         o.prediction_list_id, o.prediction_list_name, o.prediction_list_type,
         o.prediction_list_category
  FROM public.orders o
  WHERE (o.source_type IS NULL OR o.source_type <> 'monadon_legacy')
    AND (nullif(p_from, '')   IS NULL OR o.created_at >= nullif(p_from, '')::timestamptz)
    AND (nullif(p_to_end, '') IS NULL OR o.created_at <= nullif(p_to_end, '')::timestamptz)
),
it AS (
  SELECT i.order_id,
         count(*)::int                    AS n_items,
         coalesce(sum(i.quantity), 0)::int AS q_sum,
         -- orderPackageBonus items branch: packageBonusRate(price_per_unit) * quantity
         coalesce(sum(
           (CASE WHEN coalesce(i.price_per_unit, 0) >= 35 THEN 3
                 WHEN coalesce(i.price_per_unit, 0) >  25 THEN 2
                 ELSE 1 END) * coalesce(i.quantity, 0)), 0)::int AS bonus_items
  FROM public.order_items i JOIN base b ON b.id = i.order_id
  GROUP BY i.order_id
),
g AS (
  SELECT b.*,
         coalesce(t.n_items, 0) AS n_items,
         -- unitsOf(): items.length ? Σqty : (num(quantity) || 1)
         CASE WHEN coalesce(t.n_items, 0) > 0 THEN coalesce(t.q_sum, 0)
              WHEN coalesce(b.quantity, 0) = 0 THEN 1 ELSE b.quantity END AS units,
         (b.status IN ('confirmed','shipped','delivered','paid','returned')) AS is_real,
         (b.status IN ('confirmed','shipped','delivered','paid'))            AS is_sold,
         (b.status = 'paid')                                                 AS is_paid,
         -- ownerOf() BEFORE normAgent. JS `??` skips null/undefined but NOT '',
         -- which is exactly what coalesce does.
         coalesce(b.confirmed_by_name, b.assigned_agent_name) AS owner_raw,
         -- (customer_city || courier_office_city || '').trim() || 'Unknown'
         -- JS `||` is falsy-based, so '' is skipped too — hence nullif.
         coalesce(nullif(btrim(coalesce(nullif(b.customer_city, ''),
                                        nullif(b.courier_office_city, ''), '')), ''),
                  'Unknown') AS city,
         -- resolveCourierService(): delivery_type wins over home_courier
         CASE WHEN b.delivery_type = 'speedy_office' THEN 'speedy'
              WHEN b.delivery_type = 'econt_office'  THEN 'econt'
              WHEN b.home_courier IN ('speedy','econt') THEN b.home_courier END AS courier,
         CASE WHEN b.delivery_type IN ('speedy_office','econt_office') THEN 'office'
              WHEN b.home_courier IN ('speedy','econt') THEN 'door' END          AS service,
         -- orderPackageBonus(). Legacy branch divides then compares, exactly as
         -- the TS does, so float behaviour matches.
         CASE WHEN b.status <> 'paid' THEN 0
              WHEN coalesce(t.n_items, 0) > 0 THEN coalesce(t.bonus_items, 0)
              ELSE (CASE WHEN coalesce(b.price,0)::float8
                            / (CASE WHEN coalesce(b.quantity,0)=0 THEN 1 ELSE b.quantity END)::float8 >= 35 THEN 3
                         WHEN coalesce(b.price,0)::float8
                            / (CASE WHEN coalesce(b.quantity,0)=0 THEN 1 ELSE b.quantity END)::float8 >  25 THEN 2
                         ELSE 1 END)
                   * (CASE WHEN coalesce(b.quantity,0)=0 THEN 1 ELSE b.quantity END)
         END::int AS bonus
  FROM base b LEFT JOIN it t ON t.order_id = b.id
),
span AS (
  -- (maxMs - minMs) / 86400000, then Math.max(1, ...). floor(epoch*1000)
  -- reproduces V8 truncating microseconds to milliseconds.
  SELECT CASE WHEN count(*) = 0 THEN 1::float8
              ELSE greatest(1::float8,
                   ((floor(extract(epoch FROM max(created_at)) * 1000)
                   - floor(extract(epoch FROM min(created_at)) * 1000))::float8) / 86400000::float8)
         END AS span_days
  FROM g
),
gran AS (
  SELECT CASE WHEN span_days <= 92 THEN 'day'
              WHEN span_days <= 400 THEN 'week' ELSE 'month' END AS granularity FROM span
),
trend AS (
  -- UTC ISO slices; date_trunc('week') starts Monday, matching
  -- `getUTCDay() || 7; setUTCDate(d - day + 1)`.
  SELECT CASE (SELECT granularity FROM gran)
           WHEN 'day'   THEN to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
           WHEN 'month' THEN to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM')
           ELSE to_char(date_trunc('week', g.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
         END AS bucket,
         sum(g.price) AS revenue, count(*)::int AS orders
  FROM g WHERE g.is_sold GROUP BY 1
),
statusdist AS (SELECT g.status, count(*)::int AS count, sum(g.price) AS value FROM g GROUP BY 1),
cities AS (SELECT g.city, count(*)::int AS orders, sum(g.price) AS revenue FROM g WHERE g.is_sold GROUP BY 1),
deliv  AS (SELECT coalesce(nullif(g.delivery_type, ''), 'home') AS delivery,
                  count(*)::int AS orders, sum(g.price) AS revenue FROM g WHERE g.is_sold GROUP BY 1),
srcs   AS (SELECT coalesce(nullif(g.source_type, ''), 'manual') AS source,
                  count(*)::int AS orders, sum(g.price) AS revenue FROM g WHERE g.is_sold GROUP BY 1),
agents AS (
  SELECT g.owner_raw,
    count(*) FILTER (WHERE g.is_real)::int                           AS orders,
    count(*) FILTER (WHERE g.is_real AND g.is_sold)::int             AS sold,
    count(*) FILTER (WHERE g.is_real AND g.is_paid)::int             AS paid,
    count(*) FILTER (WHERE g.is_real AND g.status = 'returned')::int AS returned,
    -- trashed is credited to ownerOf() and is NOT gated on is_real (see :13543)
    count(*) FILTER (WHERE g.status = 'trashed')::int                AS trashed,
    coalesce(sum(g.price) FILTER (WHERE g.is_real AND g.is_sold), 0)      AS revenue,
    coalesce(sum(g.units) FILTER (WHERE g.is_real AND g.is_sold), 0)::int AS units,
    -- payout inputs. PAID ⊂ REAL_ORDER so is_paid alone is faithful.
    coalesce(sum(g.price) FILTER (WHERE g.is_paid), 0)               AS paid_revenue,
    coalesce(sum(g.bonus) FILTER (WHERE g.is_paid), 0)::int          AS bonus_sum,
    coalesce(sum(g.units) FILTER (WHERE g.is_paid), 0)::int          AS pkgs_paid,
    coalesce(sum(g.units) FILTER (WHERE g.is_real
             AND g.status IN ('confirmed','shipped','delivered')), 0)::int AS pkgs_awaiting,
    coalesce(sum(g.units) FILTER (WHERE g.is_real AND g.status = 'returned'), 0)::int AS pkgs_returned
  FROM g GROUP BY 1
),
cancels AS (
  -- nameById[cancelled_by_agent_id] ?? confirmed_by_name ?? assigned_agent_name
  SELECT coalesce(pr.full_name, g.confirmed_by_name, g.assigned_agent_name) AS canceller_raw,
         count(*)::int AS cancelled
  FROM g LEFT JOIN public.profiles pr ON pr.user_id = g.cancelled_by_agent_id
  WHERE g.status = 'cancelled' GROUP BY 1
),
retreason AS (SELECT coalesce(nullif(g.return_reason, ''), '(unspecified)') AS reason,
                     count(*)::int AS count FROM g WHERE g.status = 'returned' GROUP BY 1),
retcity   AS (SELECT g.city, count(*)::int AS count FROM g WHERE g.status = 'returned' GROUP BY 1),
canreason AS (SELECT coalesce(nullif(g.cancellation_reason, ''), '(unspecified)') AS reason,
                     count(*)::int AS count FROM g WHERE g.status = 'cancelled' GROUP BY 1),
logi AS (
  -- counts only; the editable rate card is applied in TS so loadCourierRates()
  -- stays the single source of truth for money.
  SELECT coalesce(g.courier, 'unknown') AS courier,
         coalesce(g.service, '—')       AS service,
         (g.courier IS NOT NULL)        AS known,
         count(*) FILTER (WHERE g.status IN ('shipped','delivered','paid'))::int AS delivered,
         count(*) FILTER (WHERE g.status = 'returned')::int                      AS returned
  FROM g WHERE g.status IN ('shipped','delivered','paid','returned') GROUP BY 1,2,3
),
plists AS (
  -- extra owner_raw grain so TS can apply the agentNames gate to bonus_paid
  SELECT g.prediction_list_id AS list_id, g.prediction_list_name AS name,
         g.prediction_list_type AS type, g.prediction_list_category AS category,
         g.owner_raw,
         count(*)::int                                                AS orders,
         count(*) FILTER (WHERE g.is_real)::int                       AS confirmed,
         count(*) FILTER (WHERE g.is_paid)::int                       AS paid,
         count(*) FILTER (WHERE g.status = 'returned')::int           AS returned,
         count(*) FILTER (WHERE g.status = 'cancelled')::int          AS cancelled,
         coalesce(sum(g.price) FILTER (WHERE g.is_sold), 0)           AS revenue,
         coalesce(sum(g.price) FILTER (WHERE g.status = 'returned'), 0) AS refund_value,
         coalesce(sum(g.bonus), 0)::int                               AS bonus_sum
  FROM g WHERE g.prediction_list_id IS NOT NULL GROUP BY 1,2,3,4,5
),
sc AS (
  SELECT coalesce(sum(g.price) FILTER (WHERE g.is_paid), 0)      AS paid_revenue,
         count(*) FILTER (WHERE g.is_paid)::int                  AS paid_count,
         coalesce(sum(g.price) FILTER (WHERE g.is_sold), 0)      AS sold_revenue,
         count(*) FILTER (WHERE g.is_sold)::int                  AS sold_count,
         coalesce(sum(g.units) FILTER (WHERE g.is_sold), 0)::int AS units_sold,
         coalesce(sum(g.price) FILTER (WHERE g.status = 'returned'), 0) AS returns_value,
         coalesce(sum(g.price) FILTER (WHERE g.status IN ('confirmed','shipped','delivered')), 0) AS pipeline_value,
         count(*) FILTER (WHERE g.is_real)::int                  AS real_orders_count
  FROM g
)
SELECT jsonb_build_object(
  'span_days',           (SELECT span_days FROM span),
  'granularity',         (SELECT granularity FROM gran),
  'scalars',             (SELECT to_jsonb(sc) FROM sc),
  'status_distribution', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM statusdist x),
  'trend',               (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM trend x),
  'by_city',             (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM cities x),
  'by_delivery',         (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM deliv x),
  'by_source',           (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM srcs x),
  'agents',              (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM agents x),
  'cancels',             (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM cancels x),
  'ret_reason',          (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM retreason x),
  'ret_city',            (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM retcity x),
  'can_reason',          (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM canreason x),
  'logistics',           (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM logi x),
  'prediction',          (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM plists x)
)
$$;
COMMENT ON FUNCTION public.insights_orders_rollup(text, text) IS
  'Order-derived rollups for GET /management-insights. Agents at RAW-name grain — normAgent stays in TS.';
REVOKE ALL ON FUNCTION public.insights_orders_rollup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insights_orders_rollup(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insights_orders_rollup(text, text) TO service_role;


-- ── 2. insights_products — SOLD basis (prodMap / retProduct / canProduct) ──
CREATE OR REPLACE FUNCTION public.insights_products(p_from text, p_to_end text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET TimeZone = 'UTC' SET work_mem = '64MB'
AS $$
WITH base AS (
  SELECT o.id, o.status::text AS status, o.price, o.quantity, o.product_name
  FROM public.orders o
  WHERE (o.source_type IS NULL OR o.source_type <> 'monadon_legacy')
    AND (nullif(p_from, '')   IS NULL OR o.created_at >= nullif(p_from, '')::timestamptz)
    AND (nullif(p_to_end, '') IS NULL OR o.created_at <= nullif(p_to_end, '')::timestamptz)
),
items AS (
  SELECT i.order_id, i.product_name, coalesce(i.quantity, 0) AS q,
         coalesce(i.total_price, 0) AS tp
  FROM public.order_items i JOIN base b ON b.id = i.order_id
),
nit AS (SELECT order_id, count(*) AS n FROM items GROUP BY 1),
plines AS (
  SELECT b.id AS order_id, coalesce(nullif(i.product_name, ''), '(unknown)') AS product,
         i.q AS units, i.tp AS revenue
  FROM base b JOIN items i ON i.order_id = b.id
  WHERE b.status IN ('confirmed','shipped','delivered','paid')
  UNION ALL
  -- legacy branch: gated on `if (o.product_name)`, so NULL and '' both skip
  SELECT b.id, b.product_name,
         CASE WHEN coalesce(b.quantity, 0) = 0 THEN 1 ELSE b.quantity END, b.price
  FROM base b LEFT JOIN nit n ON n.order_id = b.id
  WHERE b.status IN ('confirmed','shipped','delivered','paid')
    AND coalesce(n.n, 0) = 0
    AND b.product_name IS NOT NULL AND b.product_name <> ''
),
prod AS (
  SELECT product, sum(units)::int AS units, sum(revenue) AS revenue,
         count(DISTINCT order_id)::int AS orders   -- == the per-order `seen` Set
  FROM plines GROUP BY 1
),
-- retProduct/canProduct: the items branch uses the RAW name (no '(unknown)'
-- fallback) and counts every occurrence, not distinct orders.
retp AS (
  SELECT product, count(*)::int AS count FROM (
    SELECT i.product_name AS product FROM base b JOIN items i ON i.order_id = b.id WHERE b.status = 'returned'
    UNION ALL
    SELECT coalesce(nullif(b.product_name, ''), '(unknown)') FROM base b LEFT JOIN nit n ON n.order_id = b.id
     WHERE b.status = 'returned' AND coalesce(n.n, 0) = 0
  ) z GROUP BY 1
),
canp AS (
  SELECT product, count(*)::int AS count FROM (
    SELECT i.product_name AS product FROM base b JOIN items i ON i.order_id = b.id WHERE b.status = 'cancelled'
    UNION ALL
    SELECT coalesce(nullif(b.product_name, ''), '(unknown)') FROM base b LEFT JOIN nit n ON n.order_id = b.id
     WHERE b.status = 'cancelled' AND coalesce(n.n, 0) = 0
  ) z GROUP BY 1
)
SELECT jsonb_build_object(
  'prod',        (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM prod x),
  'ret_product', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM retp x),
  'can_product', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM canp x)
)
$$;
COMMENT ON FUNCTION public.insights_products(text, text) IS
  'Sold-basis product rollups for GET /management-insights.';
REVOKE ALL ON FUNCTION public.insights_products(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insights_products(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insights_products(text, text) TO service_role;


-- ── 3. insights_paid_basis — the Pure Profit / Margin Lab engine ───────────
-- float8 throughout: these values feed r2(), and numeric division rounds
-- differently at the .xx5 boundary.
-- p_rates is the rate card loaded by loadCourierRates() in TS, passed in so
-- that function stays the single source of truth for money.
CREATE OR REPLACE FUNCTION public.insights_paid_basis(
  p_from text, p_to_end text, p_rates jsonb, p_fallback_deliver double precision)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET TimeZone = 'UTC' SET work_mem = '64MB'
AS $$
WITH paid AS (
  SELECT o.id, o.price, o.quantity, o.product_name,
         -- `(rates[key]?.deliver) ?? fallback.deliver` — `??` means an explicit
         -- 0 in the rate card wins over the fallback, which is what coalesce does.
         coalesce((p_rates -> (
            coalesce(CASE WHEN o.delivery_type = 'speedy_office' THEN 'speedy'
                          WHEN o.delivery_type = 'econt_office'  THEN 'econt'
                          WHEN o.home_courier IN ('speedy','econt') THEN o.home_courier END, '')
            || '_' ||
            coalesce(CASE WHEN o.delivery_type IN ('speedy_office','econt_office') THEN 'office'
                          WHEN o.home_courier IN ('speedy','econt') THEN 'door' END, '')
         ) ->> 'deliver')::float8, p_fallback_deliver) AS drate
  FROM public.orders o
  WHERE o.status = 'paid'
    AND (o.source_type IS NULL OR o.source_type <> 'monadon_legacy')
    AND (nullif(p_from, '')   IS NULL OR o.created_at >= nullif(p_from, '')::timestamptz)
    AND (nullif(p_to_end, '') IS NULL OR o.created_at <= nullif(p_to_end, '')::timestamptz)
),
it AS (
  SELECT i.order_id, i.product_name, coalesce(i.quantity, 0) AS q,
         coalesce(i.price_per_unit, 0) AS ppu, coalesce(i.total_price, 0) AS tp
  FROM public.order_items i JOIN paid p ON p.id = i.order_id
),
nit AS (SELECT order_id, count(*) AS n FROM it GROUP BY 1),
w AS (
  -- weight: ppu>0 ? ppu*(q||1) : tp>0 ? tp : (q||1)
  -- NOTE q is fallback-to-1 INSIDE the weight but raw everywhere else — a
  -- zero-quantity item is weighted as if 1 yet contributes 0 packages.
  SELECT it.*, p.price, p.drate,
    (CASE WHEN it.ppu > 0 THEN it.ppu::float8 * (CASE WHEN it.q = 0 THEN 1 ELSE it.q END)::float8
          WHEN it.tp  > 0 THEN it.tp::float8
          ELSE (CASE WHEN it.q = 0 THEN 1 ELSE it.q END)::float8 END) AS wi
  FROM it JOIN paid p ON p.id = it.order_id
),
wt AS (
  SELECT w.*,
         sum(w.wi) OVER (PARTITION BY w.order_id) AS tot_raw,
         sum(w.q)  OVER (PARTITION BY w.order_id) AS pkg_raw
  FROM w
),
lines AS (
  SELECT wt.order_id, wt.product_name, wt.q,
         wt.price::float8 * (wt.wi / (CASE WHEN wt.tot_raw = 0 THEN 1 ELSE wt.tot_raw END)) AS line_rev,
         wt.drate / (CASE WHEN wt.pkg_raw = 0 THEN 1 ELSE wt.pkg_raw END)::float8           AS dshare,
         true AS from_items
  FROM wt
),
legacy AS (
  SELECT p.id AS order_id, p.product_name,
         (CASE WHEN coalesce(p.quantity, 0) = 0 THEN 1 ELSE p.quantity END) AS q,
         p.price::float8 AS line_rev,
         p.drate / (CASE WHEN coalesce(p.quantity, 0) = 0 THEN 1 ELSE p.quantity END)::float8 AS dshare,
         false AS from_items
  FROM paid p LEFT JOIN nit n ON n.order_id = p.id
  WHERE coalesce(n.n, 0) = 0 AND p.product_name IS NOT NULL AND p.product_name <> ''
),
all_lines AS (SELECT * FROM lines UNION ALL SELECT * FROM legacy),
-- paidProdMap key: `it.product_name || "(unknown)"` for items, RAW name for legacy
prodpaid AS (
  SELECT CASE WHEN from_items THEN coalesce(nullif(product_name, ''), '(unknown)')
              ELSE product_name END AS product,
         sum(q)::int                   AS packages,
         count(DISTINCT order_id)::int AS orders,
         sum(line_rev)                 AS revenue,
         sum(dshare * q::float8)       AS deliver_sum
  FROM all_lines GROUP BY 1
),
-- orderCOGS() keys on the RAW product_name and uses (quantity || 1) — a
-- DIFFERENT key and a DIFFERENT unit count than paidProdMap. Kept separate so
-- pure_profit.cogs and Σ by_product.cogs stay exactly as they are today.
cogs_units AS (
  SELECT raw_product, sum(u)::int AS cogs_units FROM (
    SELECT it.product_name AS raw_product, CASE WHEN it.q = 0 THEN 1 ELSE it.q END AS u FROM it
    UNION ALL
    SELECT p.product_name, CASE WHEN coalesce(p.quantity,0) = 0 THEN 1 ELSE p.quantity END
      FROM paid p LEFT JOIN nit n ON n.order_id = p.id WHERE coalesce(n.n, 0) = 0
  ) z GROUP BY 1
),
-- realizedPkg: the unit price pushed q times; q=0 pushes nothing. Run-length
-- encoded instead of materialising one row per package.
dist AS (SELECT (line_rev / q::float8) AS u, sum(q)::bigint AS c
         FROM all_lines WHERE q > 0 GROUP BY 1),
tot  AS (SELECT coalesce(sum(c), 0)::bigint AS n FROM dist),
cum  AS (SELECT u, sum(c) OVER (ORDER BY u ROWS UNBOUNDED PRECEDING) AS cend FROM dist),
pk   AS (SELECT v.p,
           (SELECT c.u FROM cum c
             WHERE c.cend > public.js_pctl_index(v.p, (SELECT n FROM tot))
             ORDER BY c.u LIMIT 1) AS val
         FROM (VALUES (25),(50),(75)) v(p))
SELECT jsonb_build_object(
  'by_product',    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM prodpaid x),
  'cogs_units',    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM cogs_units x),
  'paid_packages', (SELECT coalesce(sum(q), 0)::int FROM all_lines),
  'realized', jsonb_build_object(
     'n',   (SELECT n FROM tot),
     'p25', (SELECT val FROM pk WHERE p = 25),
     'p50', (SELECT val FROM pk WHERE p = 50),
     'p75', (SELECT val FROM pk WHERE p = 75),
     'min', (SELECT u FROM dist ORDER BY u ASC  LIMIT 1),
     'max', (SELECT u FROM dist ORDER BY u DESC LIMIT 1))
)
$$;
COMMENT ON FUNCTION public.insights_paid_basis(text, text, jsonb, double precision) IS
  'Paid-basis Pure Profit / Margin Lab rollups. float8 throughout; nothing rounded here.';
REVOKE ALL ON FUNCTION public.insights_paid_basis(text, text, jsonb, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insights_paid_basis(text, text, jsonb, double precision) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insights_paid_basis(text, text, jsonb, double precision) TO service_role;


-- ── 4. insights_calls_and_movement ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insights_calls_and_movement(p_from text, p_to_end text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET TimeZone = 'UTC'
AS $$
WITH c AS (
  SELECT cl.agent_id, cl.outcome, coalesce(cl.talk_seconds, 0) AS talk,
         (cl.connection_state = 'answered'
          OR (cl.connection_state IS NULL AND coalesce(cl.talk_seconds, 0) > 0)) AS answered
  FROM public.call_logs cl
  WHERE (nullif(p_from, '')   IS NULL OR cl.created_at >= nullif(p_from, '')::timestamptz)
    AND (nullif(p_to_end, '') IS NULL OR cl.created_at <= nullif(p_to_end, '')::timestamptz)
),
mv AS (
  SELECT coalesce(nullif(l.reason, ''), 'manual') AS reason,
         sum(abs(coalesce(l.change_amount, 0)))   AS total
  FROM public.inventory_logs l
  WHERE (nullif(p_from, '')   IS NULL OR l.created_at >= nullif(p_from, '')::timestamptz)
    AND (nullif(p_to_end, '') IS NULL OR l.created_at <= nullif(p_to_end, '')::timestamptz)
  GROUP BY 1
)
SELECT jsonb_build_object(
  'total',    (SELECT count(*)::int FROM c),
  'answered', (SELECT count(*) FILTER (WHERE answered)::int FROM c),
  'talk',     (SELECT coalesce(sum(talk), 0)::bigint FROM c),
  'by_outcome', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'outcome', coalesce(nullif(outcome, ''), '(none)'), 'count', n)), '[]')
                 FROM (SELECT outcome, count(*)::int n FROM c GROUP BY 1) z),
  'by_agent',   (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'agent_id', agent_id, 'calls', n, 'answered', a, 'talk_seconds', t)), '[]')
                 FROM (SELECT agent_id, count(*)::int n,
                              count(*) FILTER (WHERE answered)::int a,
                              coalesce(sum(talk), 0)::bigint t
                         FROM c GROUP BY 1) z),
  'movement',   (SELECT coalesce(jsonb_object_agg(reason, total), '{}') FROM mv)
)
$$;
COMMENT ON FUNCTION public.insights_calls_and_movement(text, text) IS
  'Call KPIs + inventory movement summary for GET /management-insights.';
REVOKE ALL ON FUNCTION public.insights_calls_and_movement(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insights_calls_and_movement(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insights_calls_and_movement(text, text) TO service_role;
