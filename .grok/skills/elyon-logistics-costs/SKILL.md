---
name: elyon-logistics-costs
description: Use for any shipping/return/courier cost, the Pure Profit "actuals" breakdown, the courier rate card, or how delivery & return losses are computed per order. Covers the per-courier+service rate table, the full round-trip return rule, the courier→service mapping, and the cash-basis profit model. Read before touching management-insights pure_profit, courier_rates, or anything that totals what we pay to ship.
---

# Elyon Logistics Costs & Pure Profit (Actuals) — Sacred Rules

Calibrated 2026-06-05 from BigArena's per-order fee ledger (gagag.xlsx: 155 orders,
382 fee rows, €546.24). This skill exists so courier-cost math is never re-guessed.

## The rate card (every package is < 1 kg → one flat rate per service)

Stored in the editable **`courier_rates`** table (`courier`, `service`,
`deliver_cost`, `return_cost`), editable in **Settings → Courier Rates**. Seed values:

| Courier | Service | Deliver | Return (round-trip) |
|---|---|---|---|
| econt | office | 3.05 | 5.32 |
| econt | door | 4.56 | 7.36 |
| speedy | office | 2.48 | 4.24 |
| speedy | door | 3.21 | 5.70 |
| *unknown* | *fallback* | **3.50** | **6.00** |

- **Deliver** = all-in outbound: forwarding + toll + SMS + COD fee (the modal value per service).
- **Return** = **full round-trip loss**: outbound + return leg + both tolls. We pay to send it **and** to get it back — that's why a return is ~€6, not ~€3. The BigArena file bills only the return leg (~€2.4–3.3), but the outbound was already paid at ship time, so the true loss is both legs.
- Oversized/multi-box outliers (the €86 / €21 rows) are ignored — the rate assumes one package ≤ 1 kg.

## Per-order cost (terminal status → exactly one bucket)

`orderLogisticsCost(o, rates, fallback)` in `supabase/functions/api/index.ts`:

- `shipped` / `delivered` / `paid` → **deliver** rate (outbound only)
- `returned` → **return** rate (round-trip)
- anything not yet shipped (pending/take/call_again/confirmed/cancelled/trashed) → **0**

Each order is in one bucket only, so the outbound leg is **never double-charged**.

## Courier → service mapping

`resolveCourierService(o)`:
- `delivery_type = 'speedy_office'` → speedy/office; `'econt_office'` → econt/office.
- `delivery_type = 'home'` (or legacy/empty) → **door**, courier from `home_courier` (`speedy`/`econt`).
- Anything unresolved → `null` → caller uses the **blended €3.50 / €6.00** fallback. (Orders before `home_courier` existed, ~pre 2026-05-20, often land here — accepted by the operator as "close enough".)

## Pure Profit = actuals (cash basis), NOT accrual

In `/api/management-insights` `pure_profit`, over the date range:

```
+ cash_collected   Σ price of PAID orders            (money actually in)
- vat              cash_collected − cash_collected/(1+VAT_RATE)   (gross ÷ 6 at 20%)
- cogs             Σ orderCOGS(o) of PAID orders      (product cost of what sold)
- agent_commissions Σ orderPackageBonus(o) of PAID orders OWNED BY AN AGENT
- delivery_cost    Σ deliver rate of shipped/delivered/paid
- return_loss      Σ return rate of returned          (round-trip)
= clear_profit
```

- **VAT (added 2026-06-11):** all stored prices are GROSS (BG 20% VAT-inclusive). `VAT_RATE = 0.20` is a named constant next to the logistics constants in `index.ts`. `cash_collected` stays gross (it's the money physically in hand); VAT is its own deduction line. Per-product rows also carry `net_revenue` / `net_profit` (ex-VAT).
- **COGS is booked on PAID orders only.** A return loses **shipping only** — the product comes back to inventory (stock is restored on `returned`; see [[elyon-stock-and-bigarena]]). Never subtract product cost for a returned order.
- **No separate warehouse fee.** The operator confirmed the courier fees in the ledger are the whole cost — there is no extra handling/storage line.
- A product with no `cost_price` contributes €0 COGS (cost unknown) — this overstates profit slightly; the response carries `cost_coverage` (share of sold packages with known cost) + `products_missing_cost`, surfaced as an amber banner in the UI. Never invent a cost.
- **Product rows group by `order_items.product_name` (string).** Storefront bundle names are decomposed at webhook ingest via `OPENCART_BUNDLES` in `index.ts` ("Brain 4" → 4× NT0063; "Prostatol 3 + Palmetto 1" → 3× NT0004 + 1× NT0055), money split by catalogue-price weights summing exactly to the line total; matched lines always store the CATALOGUE name. Leading-multiplier names ("3X Curcumactiv (500ml) - …") are also parsed: qty multiplies, per-package price divides, line total unchanged. Historical rewrite: `scripts/backfill-bundle-order-items.mjs --since=YYYY-MM-DD` (keep its embedded map in sync; run with --commit after dry-run review). **Operator decision 2026-06-11: only data from 2026-05-01 onward matters** — the ~13.7k pre-May legacy lines with quantity-bearing promo names ("prostatol 2+2", "curcumactiv 1+1") stay as-is, intentionally. Do not "fix" them.
- The Pure Profit tab exports to CSV client-side (`PureProfitExportDialog.tsx`, sections toggleable, `;` + BOM).

## Money display

All figures shown to humans use dual EUR/LEV via [[elyon-currency]] (`formatEur` + `formatLev`). Calculations in EUR; LEV is display-only at the 1.95583 peg.

## Where it lives (keep in sync)

- Helpers (single source of truth): `packageBonusRate`, `orderPackageBonus`, `orderCOGS`, `salesOwnerId`, `resolveCourierService`, `orderLogisticsCost`, `loadCourierRates` — top of `supabase/functions/api/index.ts`.
- `pure_profit` + `logistics` output: the `/api/management-insights` handler.
- UI: `PureProfit` in `src/pages/ManagementInsightsPage.tsx` (breakdown + "Logistics Spend by Courier").
- Rate editor: `CourierRatesTab` in `src/pages/SettingsPage.tsx` → `GET/PATCH /api/courier-rates`.
- One-off report + ledger reconciliation: `scripts/cost-report-since-18may.mjs`.

## Future: exact actuals

`orders.fulfillment_order_id`, `orders.waybill`, `orders.actual_logistics_cost` exist (nullable) so a real BigArena bill can later be imported to override the modeled rate per order. Until populated, the modeled rate card is the system of record. The ledger has **no shared key** with CRM orders today, so it calibrates the rates — it cannot be auto-joined per order.

## Red flags (stop and correct)

- Charging a returned order its product cost (COGS) — only shipping is lost.
- Charging the outbound leg twice (once as "shipped", once inside the return) — status is terminal; pick one bucket.
- A flat per-order shipping number that ignores courier/service when the courier IS known.
- Counting revenue as confirmed/shipped (accrual) in Pure Profit — it's **cash collected (paid)**.
- Adding a warehouse fee line (there isn't one) unless the operator newly provides it.
- Hardcoding a courier rate in code instead of reading `courier_rates`.
