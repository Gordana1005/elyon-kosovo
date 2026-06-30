# Insights & analytics

> Every report, what feeds it, and the **exact** metric definitions — because in a COD business the
> obvious definitions are wrong (an order confirmed today is paid days later, so "today's revenue = paid
> today" is always near‑zero). The analytics deliberately use a **SOLD** basis for revenue and credit the
> **confirmer**. All numbers are EUR (shown with лв).

---

## 1. The five analytics surfaces

| Page | Endpoint | Audience | What it answers |
|---|---|---|---|
| Dashboard | `dashboard-stats` | all (agents = own) | "How am I / are we doing today/this month?" |
| (CEO KPIs on Dashboard) | `ceo-dashboard-stats` | admin/manager | Revenue, profit, funnel, agent rankings, risk alerts |
| Management Insights | `management-insights` | admin/manager | The deep dive: sales by product/city/delivery/source, returns, cancels, calls, profit, stock cover |
| Agent Performance | `agent-performance` | admin/manager | Per‑agent conversion/shipment/collection/return + profit |
| Operations Center | `operations-center` | admin/manager | Live "right now": today's KPIs + who's online + activity |

Pages: [Dashboard.tsx](../src/pages/Dashboard.tsx), [ManagementInsightsPage.tsx](../src/pages/ManagementInsightsPage.tsx),
[AgentPerformancePage.tsx](../src/pages/AgentPerformancePage.tsx), [OperationsPage.tsx](../src/pages/OperationsPage.tsx).
All aggregation happens **in the Edge Function** ([BACKEND_API.md](BACKEND_API.md) §4) over paginated reads.

---

## 2. The status buckets that drive every number

```
REAL_ORDER = confirmed | shipped | delivered | paid | returned     (a lead that became a sale)
SOLD       = confirmed | shipped | delivered | paid                 (sold and not returned) ← revenue/AOV basis
PAID       = paid                                                   (cash actually collected)
LOST       = returned | cancelled | trashed
PIPELINE   = confirmed | shipped | delivered                        (sold, money not yet collected)
```

Why **SOLD** (not PAID) drives revenue/AOV/products/cities: COD orders are confirmed & shipped today and
paid days later, so a paid‑only "today" view is always empty. Returned orders drop out of SOLD. **PAID**
revenue is reported separately as "cash actually collected", and **profit** is computed on PAID only.

---

## 3. Attribution — who gets credit

- A real order is credited to its **confirmer** (`confirmed_by_name`), which is stable across shipping —
  not to whoever last touched it. Legacy rows without a confirmer fall back to `assigned_agent_name`.
- Cancellations are credited to whoever cancelled (`cancelled_by_agent_id`), falling back to confirmer/assigned.
- Agent names are normalised in Insights (`"Елена Т."` / `"Елена Т"` → `"Елена"`; blank → "Unknown operator")
  so the same person doesn't split across rows.
- **Agent buckets only exist for meaningful outcomes** (a real order, a cancel, or a trash) — unassigned
  pendings never create an agent row, so they don't pollute the agents table.

---

## 4. Metric definitions (the ones people argue about)

| Metric | Definition |
|---|---|
| **Revenue** (Insights `overview.revenue`) | Σ `price` of **SOLD** orders in range |
| **Paid revenue** | Σ `price` of **PAID** orders (cash collected) |
| **Gross revenue** (CEO/AgentPerf) | Σ `price` of **shipped + paid** |
| **Outstanding** | Σ `price` of **shipped** (not yet paid, not returned) |
| **Profit** | `paidAmount − Σ(cost_price × qty)` over **PAID** orders only (needs `cost_price`) |
| **AOV** | `revenue / sold_count` (SOLD basis) |
| **Units sold** | Σ item quantities on SOLD orders (falls back to `orders.quantity` for legacy) |
| **Conversion rate** (CEO funnel) | `paid / allTaken` where allTaken = take+call_again+confirmed+…+paid |
| **Confirmation rate** | `confirmed(+downstream) / allTaken` |
| **Return rate** (Insights) | `returnedCount / realOrdersCount` |
| **Return rate** (CEO/AgentPerf) | `returned / shipped(+downstream)` |
| **Cancel rate** | `cancelled / (realOrders + cancelled)` (orders and cancels are separate buckets, never mixed) |
| **Collection rate** (AgentPerf) | `paid / shipped` |
| **Net contribution** (AgentPerf) | `(paidRevenue − returnedValue) − (paidCost + returnedCost)` |
| **Revenue/Profit per lead** | per‑agent revenue or profit ÷ leads assigned |
| **Answer rate** (calls) | `answered / total` where answered = `connection_state='answered'` (or `talk_seconds>0` for legacy) |
| **Days of cover** (stock) | `stock_quantity / (units_sold_in_range / span_days)` |

---

## 5. Dashboard (`dashboard-stats`)
Period `today` / `yesterday` / `month` (+ optional `agent_id`). Scopes by `created_at`. Returns leads,
deals_won (`confirmed…paid`), deals_lost (`returned/cancelled/trashed`), total_value (won), tasks_completed
(= calls), total_orders, a daily breakdown, status counts, and **products_sold/units_sold** (line items on
won orders). Plain agents get their own numbers only; dual‑role admins also get a `personalMetrics` block.

## 6. CEO KPIs (`ceo-dashboard-stats`)
Period `today/yesterday/month/all` or custom `from/to`; scopes by `created_at` (not `updated_at` — a bulk
backfill bumps `updated_at` and would wrongly pull everything into "today"). Returns: revenue (shipped+paid),
profit, outstanding, paid/confirmed/shipped/returned counts + amounts; a **funnel** (allTaken→confirmed→
shipped→paid→returned with rates); **daily revenue trend**; **agent rankings** (by paid revenue, with
conversion% and return%); **risk alerts** (return >20% red, conversion <10% red, outstanding >2× revenue
yellow, too many pending yellow); and a **today snapshot** computed from `order_history.changed_at` (real
status transitions today, not `updated_at`).

## 7. Management Insights (`management-insights`)
The deepest report (from/to range, all reads paginated). Trend granularity auto‑selects day/week/month from
the data span. Sections: **overview** (revenue/paid_revenue/orders_total/sold/paid/AOV/units/return_rate/
cancel_rate/returns_value/pipeline/…); **status_distribution**; **revenue_trend**; **sales** by_product /
by_city (customer_city or office city) / by_delivery / by_source (top‑N with an "Others" rollup);
**agents** (orders/sold/paid/returned/cancelled/revenue/AOV/cancel_rate/return_rate + merged call stats);
**products_stock** (top sellers, stock state ok/low/out, days_of_cover, movement summary from inventory_logs);
**returns** (by reason/product/city); **cancellations** (by reason/product); **calls** (total/answered/
answer_rate/talk_seconds/by_outcome/per_agent); **profit** (only where `cost_price` is known).

## 8. Agent Performance (`agent-performance`)
Per‑agent table over a date range (filters: source, status, include_cancelled, agent_id, show_zero). For
each agent: leads assigned, confirmed/shipped/paid/returned/cancelled counts, conversion/shipment/collection/
return rates, gross & paid revenue, outstanding, returned value, total profit, **net contribution**, AOV,
revenue/profit per lead. Sorted by paid revenue.

## 9. Operations Center (`operations-center`)
The live board: today's order KPIs (from `created_at`) + today's status‑change KPIs (confirmed/shipped/
returned/paid today + revenue) + per‑agent online status (from `shift_login_logs`) with active‑lead counts
and today's activity. Plus `agents/online` (presence‑heartbeat based, 2‑min window) feeds the live "who's here".

---

## 10. Shifts & time tracking (feeds ops + payroll context)
Tables `shifts`, `shift_assignments`, `shift_templates`, `shift_login_logs`, `shift_breaks`. Endpoints under
`/shifts/*` ([BACKEND_API.md](BACKEND_API.md)): create shifts, assign a template across a week, agents
check‑in (`login-log`) / check‑out (`logout-log`, also fired on sign‑out), start/end **breaks**, and
`shifts/statistics` + `shifts/login-activity` for reporting. Presence (`profiles.last_seen_at` via
`presence/heartbeat`) is separate from shift login — it's "tab open right now", used by Operations/agents‑online.

---

## 11. Financial visibility (who sees money)
`financial_visibility` (per role) controls `show_profit`, `show_net_contribution`, `show_cost`,
`show_returned_value`, `show_financial_insights`. The frontend hides metrics via `canSeeFinancial()`
([USERS_ROLES_PERMISSIONS.md](USERS_ROLES_PERMISSIONS.md)); agents typically see selling price but not cost/profit.

---

## 12. Caveats & accuracy notes
- **`orders/stats` is not paginated** → it truncates at 1000 rows. Most pages use the paginated
  `dashboard-stats`/`ceo-dashboard-stats`/`management-insights` instead, but anything still calling
  `orders/stats` under‑counts past 1000 orders in range. ([AUDIT_FINDINGS.md](AUDIT_FINDINGS.md))
- **Profit/AOV need data:** profit only appears where `cost_price > 0`; AOV/units fall back gracefully for
  legacy orders with no `order_items`.
- **Audit scripts** verify the numbers against the DB: `check-dashboard-numbers.mjs`,
  `check-insights-accuracy.mjs`, `check-customer-intelligence.mjs`, `check-segment-counts.mjs` ([IMPORT_EXPORT.md](IMPORT_EXPORT.md)).
- All aggregates **paginate past PostgREST's 1000‑row cap** except `orders/stats`.
