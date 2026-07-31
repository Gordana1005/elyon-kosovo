# Orders & clients — the central workflow

> The order is the heart of the system. This doc covers the order state machine, the (virtual) customer
> model, phone matching, where pendings come from, how they reach agents, and how every order outcome
> re‑classifies the customer into the 27 prediction lists.

---

## 1. What an "order" is

A row in `orders` represents a **lead at some stage of conversion** — from an untouched `pending` all the
way to `paid`. It is created in one of four ways (`source_type`):

| source_type | Created by | Starts as |
|---|---|---|
| `manual` | Agent/admin via CreateOrderModal (during/after a call), or `POST /orders` | `pending` (or `confirmed`/`cancelled`/`call_again`/`trashed` if the agent records the call outcome directly) |
| `inbound_lead` | Landing‑page webhook (`/webhook/:slug`) | `pending`, unassigned |
| `opencart` | naturatherapy.bg order bridge | `pending`, unassigned |
| `opencart_abandoned` | naturatherapy.bg abandoned‑cart (qualified leads only) | `pending`, unassigned |

Legacy imports (`scripts/import-cpa-xlsx.mjs`, `import-outbound-xlsx.mjs`) loaded ~14k historical orders;
their `order_items` usually have **no `product_id`**, so they're excluded from stock math by design.

---

## 2. The state machine

```
                 agent confirms (call or modal)        Fulfilment CSV export (warehouse)
  ┌─ pending ──────────────────────────► confirmed ─────────────────────────────► shipped ──► delivered
  │     ▲                                   │   │                                     │
  │     │ TAKE (transient soft-lock         │   │ postpone via ship_after_date        │ COD reconciliation
  │     │  while an agent is on the call)    │   │ (re-surfaces on its day)            ▼
  │     └───────────────────────────────────┘   │                                    paid
  │                                              └── call_again (re-queues)
  ├─ cancelled  (structured cancellation_reason)         shipped ──► returned (stock restored)
  └─ trashed    (junk / wrong number)
```

`order_status` enum (10): `pending · take · call_again · confirmed · shipped · delivered · returned · paid · trashed · cancelled`.

### Transition table

| From | To | Trigger | Who | Side effects |
|---|---|---|---|---|
| pending | take | Agent opens the customer on the Calls page | agent | `active_call_views` heartbeat soft‑lock; auto‑reverts ~2 min after disconnect |
| pending/take/call_again | confirmed | Agent confirms (CreateOrderModal Save, or call outcome) | agent | credits `confirmed_by_*`; segment trigger may fire later on paid |
| pending/take/call_again/confirmed | cancelled | Outcome picker / status change (reason required) | agent/mgr | `cancelled_at`, `cancelled_by_agent_id`, reason; → Cancel mirror segment |
| pending/take/call_again | trashed | Outcome picker (junk/wrong number) | agent | — |
| confirmed | call_again | Outcome picker | agent | re‑enters queue |
| confirmed | shipped | **Fulfilment CSV export** (checkbox "Mark as shipped") or bulk/single status | mgr/warehouse | **stock −**, `inventory_logs reason=order_deduction`, `order_history` |
| shipped | paid | Manual / COD reconciliation **or automated BigArena daily status sync** (when client accepts / picks up and merchant side shows Complete/Изпълнена + payment date) | mgr/warehouse | counts as revenue + profit |
| shipped | returned | Manual after delivery failure (reason) **or automated BigArena daily status sync** (when partner reports return / refusal) | mgr/warehouse | **stock +**, `inventory_logs reason=order_return`, `returned_at` |

Terminal statuses (`confirmed/shipped/returned/paid/cancelled`) require name + phone + city + address to
be filled (`PATCH /orders/:id/status` enforces this).

**Automated BigArena reconciliation (daily operational flow):**  
After the Fulfilment CSV hand-off, the warehouse partner (BigArena) tracks the physical shipment. Their panel export (CSV or XLSX containing "Ref: NNNNN" which matches the numeric part of `display_id` + Bulgarian Статус phrases) can be uploaded directly in the CRM (Orders page or Warehouse Incoming). The system extracts refs + statuses, previews the mapping, and safely bulk-transitions only `shipped` orders:
- "Приета от клиент", payment date present, or "Complete/Изпълнена" → `paid`
- Return/refusal/delivery-failure keywords → `returned` (stock restored)
- Everything still in transit / ready for pickup / in office → left as `shipped`

All transitions write `order_history` + provenance notes and an `audit_log` entry. Only shipped (or delivered) orders are eligible; the preview step and conservative keyword map protect revenue and stock. Re-uploads are idempotent.

### Postponed shipping (`ship_after_date`)
An agent can pick a future ship date. The Daily Fulfilment CSV has a **"Ready to ship by"** cutoff
(default today + 2). Orders with `ship_after_date` later than the cutoff are **excluded** from today's CSV
and surface naturally on their day. Rule: "1–2 days postpone → ship now; 3+ days → wait."

---

## 3. The (virtual) customer model

**There is no `customers` table.** A customer is every `orders`/`prediction_leads` row that shares a
`customer_phone`. Two consequences:

1. **Phone normalisation is everything.** Phones are stored E.164 (`+359XXXXXXXXX`) via
   `normalizeBgPhone()`, but **matching is on the last 8 digits** — so `078319044`, `+38978319044`,
   `38978319044`, and scientific‑notation imports all resolve to one person. `customer-intelligence`
   builds a small set of candidate canonical forms and matches exactly against them (substring matching
   is avoided — it would merge unrelated people who share digit runs).
2. **The dossier is computed live.** `GET /customer-intelligence?phone=` and
   `GET /customers/:phone/history` aggregate orders + leads + call_logs on the fly: total/paid/returned
   counts, lifetime revenue (paid only), last order, a **quality score** (HIGH/MEDIUM/RISK from paid‑vs‑
   returned history), a timeline, and product recommendations.

> **Cyrillic search:** city/product search uses transliteration (`с`↔`s`) so Cyrillic and Latin both
> match. The `CYR_TO_LAT` map in the Edge Function must stay in sync with the importer's table.

### Persistent per‑customer data (`customer_profiles`)
Independent of any order, keyed by phone: birthday, address, delivery prefs, and the free‑text "About
this customer" note shown on the Calls strip. Used to **pre‑fill** the order modal so agents don't re‑type.
Saved via `POST /customer-profile` / `/customer-profile/notes`.

---

## 4. Where pendings come from & how agents get them

```
SOURCES                         INTAKE                         DISTRIBUTION                 AGENT
─────────────────────────────────────────────────────────────────────────────────────────────
landing page  ─► /webhook/:slug ─┐
naturatherapy ─► /webhook/opencart┤─► orders(status=pending,   ─► Assigner (manual)      ─► /calls
XLSX import   ─► prediction_leads ┤   unassigned)              ─► Lead Distribution (auto) (silent
manual (agent) ─────────────────┘                             ─► Segments bulk-assign       queue
                                                              ─► Prediction list assign     auto-pick)
```

Three distribution mechanisms, all admin/manager:

1. **Assigner** ([../src/pages/AssignerPage.tsx](../src/pages/AssignerPage.tsx)) — three tabs plus a
   right‑hand agents panel (each card shows a live **In call / Available / Offline** status and the
   agent's "clients to call"):
   - **Prediction Lists** — expandable list rows with a Distribute bar (whole/half/custom × N agents,
     round‑robin) and the cross‑list basket for hand‑picking customers across lists.
   - **Pendings** — the unassigned pending pool; select orders and `bulk-assign` to an agent. A chip
     strip shows who already holds pendings.
   - **Unassign** — who holds what, per agent × list (`assigner/assignment-summary`). Expand an agent to
     see their lists and pending leads; expand a list to see the individual clients (already‑called ones
     badged *Done*) and free them one by one. Bulk buttons **fully detach**: they clear the agent stamp
     on already‑called members too (`include_done`), so an emptied list stops hanging off the agent's
     profile. Only the three assignment columns move — call history, the *done* mark and sales credit
     (`confirmed_by_*`) are never touched. See [BACKEND_API.md](BACKEND_API.md#assigner-crosslist-mass-distribution).
2. **Lead Distribution** ([../src/pages/LeadDistributionPage.tsx](../src/pages/LeadDistributionPage.tsx))
   — `lead-distribution/auto-assign` with a strategy (`round_robin` / `load_balance` / `priority`),
   `max_leads_per_agent`, `priority_threshold`. ⚠️ The config PATCH + auto‑assign currently throw 500
   (`userId` bug) — see [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md).
3. **Segments / prediction lists** — assign a whole rule‑list (or a fraction) across N agents
   (`segments/:id/auto-assign`, shuffled + round‑robin). This is the **main re‑marketing engine**.

On the Calls page the agent's queue is the union of segment lists assigned to them (`useMyQueue`);
auto‑pick chooses the first non‑empty list **without showing a remaining count** to plain agents.

---

## 5. Prediction lists (segments) — the re‑marketing engine

Segments are **rules**, not static lists. Defined in `prediction_segment_lists`, membership computed
into `prediction_segment_members` by `recompute_customer_segments(phone)`, which the order triggers fire
on every insert/delete/status‑or‑price‑or‑phone change.

**The 27 seeded lists:**

| Category | Trigger | Lists |
|---|---|---|
| value | last_paid | recency × price band: `{1‑3m, 3‑6m, 6+m(6‑12), 1y+} × {$50+, $100+, Premium}` = 12 |
| prestige | last_paid | `$300+` × {1‑3m, 3‑6m, 1y+} = 3 |
| cancel | last_cancelled | {1‑3m, 3‑6m, 6+m, 1y+} = 4 |
| return | last_returned | {1‑3m, 3‑6m, 6+m, 1y+} = 4 |
| other | last_paid | `Low <$50` × {1‑3m, 3‑6m, 6+m, 1y+} = 4 |

Rule semantics (from the migration):
- **Recency** is days since the trigger event (`recency_months * 30`), inclusive lower / exclusive upper.
- **Price band** is the trigger order's single price (`single_price_min/max`).
- **Premium override:** if `min_paid_count` is set, the list matches if **price band OR paid‑count** is met.
- **Lifetime** floor (`lifetime_min`) is ANDed in when set.
- A customer can be in several lists; aging out of a band **deletes** their membership (and its assignment).

Editing a list's thresholds (`PATCH /segments/:id`) triggers a full `recompute_all_segments()`.

**In the UI:** sidebar reads "Prediction Lists"; the route is `/segments`. The old XLSX‑upload Prediction
Lists page lives at `/predictions` (hidden from the sidebar but still routable).

---

## 6. Personal list & Call Again

- **Personal List** (`personal_list_holds`) — an agent "claims" a customer for personal follow‑up with a
  reason + `follow_up_by` date. Holds expire and can escalate; counts surface on the Calls page.
  Page: [../src/pages/PersonalListPage.tsx](../src/pages/PersonalListPage.tsx).
- **Call Again** (`call-again-queue`) — customers whose last call outcome put them in a follow‑up window
  (`in_call_again_until` on the segment member). "Didn't answer" re‑queues ~2 h; `call_again` outcome
  retries in ~2 days. Page: [../src/pages/CallAgainPage.tsx](../src/pages/CallAgainPage.tsx).

---

## 7. Soft locking (no two agents on the same customer)

- **`order_locks`** — pessimistic lock when an order is opened in a modal for editing.
- **`active_call_views`** — heartbeat lock while a customer is loaded on the Calls page; flips their
  pending/call_again/cancelled/trashed orders to `take` (protected: confirmed, shipped, paid, delivered, returned).
  `cleanup_expired_active_call_views()` reverts after ~2 min without a heartbeat. Visible in Orders list and Operations Center.

---

## 8. Attribution (who gets credit)

- **`confirmed_by_*`** is set the first time an order becomes a real order (confirmed/shipped/…/paid) and
  **never overwritten by normal status changes** — so a CSV flip to shipped/paid keeps the original confirming agent.
- The **only** way for an admin to change the original sales credit after the fact is the privileged
  `POST /orders/:id/attribution` endpoint (visible in OrderModal only to admins).
- **Unassigning never moves credit.** The Assigner's Unassign tab (including the full‑detach path that
  clears the stamp on already‑called prediction members) only nulls `assigned_agent_id/_name/_at` — on
  orders it also clears `assigned_by`, and it is limited to `status='pending'` rows. `confirmed_by_*`,
  `cancelled_by_agent_id`, `call_logs` and commission history are untouched, so taking work back from an
  agent can never change who earned a package bonus.
- **`cancelled_by_agent_id`** credits whoever cancelled (separate, first-wins).
- **`cancelled_at`** is now guaranteed on **every** path a row enters `cancelled` — the call-outcome
  status change, the synthetic cancelled record created straight from the Calls page (`POST /orders`),
  and the BigArena/lead status syncs — via the `trg_orders_set_cancelled_at` trigger (fills it only when
  NULL, so explicit sets win). Before 2026-06-23 the creation + sync paths left it NULL (~99% of cancels),
  which blinded `cancelled_at`-based reports (e.g. the Discord `/cancellations`); those were backfilled
  from `order_history`. The prediction-segments engine is unaffected — it keys off the order's `created_at`.
- **`returned_at`** got the identical fix (2026-06-23): `trg_orders_set_returned_at` stamps it whenever a
  row enters `returned` (it was ~98% NULL because returns arrive via BigArena warehouse sync that only set
  `status`). Existing rows backfilled from `order_history`/`updated_at`. Un-breaks the Discord `/returns`
  and Insights returns-by-date. The new **Current Returns** prediction list (additive tracking) keys off the
  returned order's `created_at`, not `returned_at`.
- Analytics attribute revenue/AOV to the **confirmer** (falling back to assigned agent for legacy rows),
  not to whoever last touched the order. See [INSIGHTS_ANALYTICS.md](INSIGHTS_ANALYTICS.md).

---

## 9. Gotchas

- **Last‑8‑digit phone matching** — never write exact‑equality phone lookups.
- **Stock only on shipped/returned**, only when `product_id` is set ([PRODUCTS_STOCK_WAREHOUSE.md](PRODUCTS_STOCK_WAREHOUSE.md)).
- **Cancelling a shipped order is blocked** with a 409 → use the Returned flow (warehouse owns post‑ship refunds).
- **Don't deactivate a product** that has open orders awaiting shipment (order modals filter to `is_active`).
- **Note provenance stays in storage**; render with `cleanNoteForDisplay()`.
