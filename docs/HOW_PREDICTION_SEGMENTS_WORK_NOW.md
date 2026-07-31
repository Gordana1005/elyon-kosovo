# How the Prediction Segments System Works Now (Engine v3 — 2026-06-10)

**Purpose**: the single operator-friendly explanation of the live engine. Everything below was verified against the production database on 2026-06-10 after the v3 repair (`supabase/migrations/20260629000000_restore_segment_engine_v3.sql`). *Revised 2026-07-28: added the "Manual Unassign" section (full-detach semantics); the engine itself is unchanged.*

> **Non-technical?** Read the plain-words version first: [PREDICTION_LISTS_PLAIN_GUIDE.md](PREDICTION_LISTS_PLAIN_GUIDE.md) — written for agents, managers and new team members.

> History note: this document previously described the May 2026 "priority / rule-column" design. That engine is **dead**. Since June 2026, classification is **name-construction**: the function computes three buckets and targets the list whose NAME matches. The rule columns on `prediction_segment_lists` (recency_months_min/max, single_price_min/max, min_paid_count, lifetime_min, priority) are vestigial and do NOT drive membership.

---

## The One-Paragraph Version

Every customer phone is classified into **exactly one** rule-driven calling list (or none), computed from their real (non-Monadon) order history: *how recently they last paid* × *how much their last paid order cost* × *how many paid orders they have lifetime*. Cancellations park people for 14 days, never-buyers get their own lists, fresh payers are protected in NEWCOMERS for 21 days, and a **nightly pg_cron job (03:00 Sofia)** re-runs the whole classification so people age between lists automatically. Order changes re-classify instantly via triggers.

---

## Where a Customer Goes (Decision Order)

The function `recompute_customer_segments(phone)` evaluates IN THIS ORDER — first match wins:

1. **Only Monadon-legacy orders** (`source_type = 'monadon_legacy'`) → **no rule list at all**. These phones live only in the static "FULL MONAD LIST".
2. **Never bought + an order in flight** (`paid_count = 0` and any order in `pending / take / call_again / confirmed / shipped / delivered`) → **no calling list**. They are being worked in the Pendings section. When the order resolves, the trigger re-classifies instantly.
3. **Fresh cancellation** (most recent action is a cancel, newer than any paid order, within 14 days) → **"Current Cancels"** — an UNASSIGNED holding pen. Nobody calls them by default. After 14 days the nightly recompute returns them to their normal bucket. (Window measured from the cancelled order's `created_at`; recent cancels are created+cancelled the same day, so this is the entry date in practice.)
4. **Never bought** (`paid_count = 0`):
   - last cancel within 180 days → **"Never-Converted Recent"**
   - otherwise (incl. trashed-only phones) → **"Never-Converted Old"**
5. **Has paid history** → the band matrix below.

**Plus an ADDITIVE list — "Current Returns" (engine v3.3, 2026-06-23).** This is NOT part of the first-match-wins decision above; it is layered on top. A customer whose **newest order is a return** (no order placed after their latest returned order) is tracked in **Current Returns** — UNASSIGNED, nobody calls it. It coexists with the calling list: a customer with paid history stays in their normal band **and** also shows in Current Returns; a return-**only** customer (no paid orders) is in **Current Returns only** (not Never-Converted). They leave automatically once they place a newer order. The list shows the returned order's date. (`orders.returned_at` is separately fixed by the `trg_orders_set_returned_at` trigger so returns-by-date reports work; the list itself uses the returned order's `created_at`.)

## The Band Matrix (paid customers)

**Recency** (days since last real paid order, by `created_at`):

| Days since last paid | List prefix |
|---|---|
| under 21 | NEWCOMERS |
| 21 – 57 | 21d |
| 57 – 120 | 57d |
| 120 – 180 | 4-6m |
| 180 – 365 | 6-12m |
| 365 – 730 | 1-2yr |
| over 730 | 2yr+ |

**Value** (price of the most recent paid order): `≤26` vs `26+` (EUR). NEWCOMERS has no value split.

**Frequency** (lifetime paid orders — labels are LITERALLY TRUE, most specific wins):

| Lifetime paid orders | Label |
|---|---|
| 1 – 2 | (1-3 orders) |
| 3 – 4 | (3+ orders) |
| 5 – 6 | (5+ orders) |
| 7 or more | (7+ orders) |

A "(3+ orders)" list can never contain someone with fewer than 3 paid orders. This is the operator's 2026-06-10 spec and supersedes every earlier bucketing.

Final list name = `recency + ' ' + value + ' ' + frequency`, e.g. **"4-6m 26+ (3+ orders)"** = last paid 120–180 days ago, last order over €26, 3–4 lifetime paid orders. NEWCOMERS = `'NEWCOMERS ' + frequency`.

## What Each Member Row Carries

- `trigger_price` / `trigger_event_at` / `trigger_order_id` — the **"Last order"** column: for paid buckets the most recent paid order with a real (>0) price; for cancel-category lists the last cancelled order.
- `paid_count`, `lifetime_value`, `avg_package_price` (= lifetime / paid_count, EUR — display always via `src/lib/currency.ts` helpers, dual EUR/LEV).
- `assigned_agent_*`, `last_call_*`, `is_completed`, `in_call_again_until`, `call_again_since` — **agent work survives band moves** (the engine carries it onto the new row). A NEW purchase resets `is_completed`/call-again (fresh lifecycle). Moving into **"Current Cancels" or any "NEWCOMERS" list always strips the carried-over assignment** (both are unassigned holding pens) — a fresh buyer is never auto-assigned; only a manager's deliberate assignment sticks, and it follows them forward when they later age into the `21d` band (engine v3.1, 2026-06-18).

## Manual Unassign (manager-driven — not the engine)

Besides the two holding pens above, the **only** other way `assigned_agent_*` is cleared is a deliberate manager action. Every path nulls exactly three columns — `assigned_agent_id`, `assigned_agent_name`, `assigned_at` — and nothing else. `is_completed`, `last_call_*`, `in_call_again_until`, `call_logs`, recordings and sales credit (`confirmed_by_*`) always survive.

| Path | Scope | Clears already-called (`is_completed=true`) rows? |
|---|---|---|
| `POST /assigner/unassign-all` — default | one agent or all agents, optionally narrowed by `list_ids` | **No** (frees only `is_completed=false`) — original 2026-07-22 contract, still the API default |
| `POST /assigner/unassign-all` with `include_done: true` | same | **Yes** — the Assigner's Unassign tab always sends this (2026-07-28) |
| `POST /segments/:id/bulk-unassign` | one list (`scope='all'` or one agent) | **Yes** (never had an `is_completed` filter) |
| `POST /segments/:id/assign` with `agent_id: null` | specific phones | **Yes** — powers the per-client unassign in the Unassign tab |

Why `include_done` exists: there is **no list→agent table**. "Agent X holds list Y" is derived from member rows via `assignment_matrix()`, so a single leftover already-called row kept an otherwise-empty list glued to the agent's profile. Clearing done rows is what makes the pair disappear.

A manual unassign is **not** a recompute: the nightly job will not put the agent back. The customer simply sits unassigned in the same list until someone distributes them again.

## When Recompute Runs

1. **Instantly** on every order INSERT / DELETE / UPDATE of status, price or phone (triggers `trg_orders_segments_*` on `orders`).
2. **Nightly at 00:00 UTC (03:00 Sofia summer)** — pg_cron job `nightly-segment-recompute` runs `recompute_all_segments()` (~9.6k phones, ~4 s). This is what makes time-based movement work: band aging, Current Cancels un-parking, Never-Converted Recent→Old at 180 days, NEWCOMERS graduating at day 21.
3. **Manually** — "Recompute all" button on /segments, or rule edits via PATCH (both call the same RPC).

The Prediction Lists page header shows **"Engine data as of …"** (max member `updated_at`) so you can always see the engine is alive.

## Static Lists

**Externally-imported (the engine never touches these):**
- **Cancelled Pendings** — hand-curated callback list.
- **FULL MONAD LIST** — the 1,555 imported Monadon customers with their legacy product info. Monadon orders (`source_type='monadon_legacy'`) are excluded from paid_count, lifetime, recency, name detection — everything.

**Engine-written additive statics (`is_static=true`, but the engine maintains membership):**
- **Trash List** (engine v3.5, 2026-07-07; renamed from "Trashed") — every customer whose **newest order was trashed, for ANY reason**, with a **Reason** column (`trigger_trash_reason`: wrong number / wrong person / **unreachable** / rude / uncooperative / other). UNASSIGNED, informational, self-cleaning. Dead-number reasons (wrong number / wrong person / unreachable) are also removed from every calling list; other reasons stay callable but still show here. `not_reachable` ("Unreachable") is set both by an agent's manual pick and by the server auto-trash after 9 consecutive no-answers (see docs/CALLS.md §5b).
- **Current Returns** — newest order is a return (see above).

## Health Check (run any time)

```
node scripts/audit-segments-integrity.mjs
```

10 PASS/FAIL checks: live-function fingerprint (drift detection), exclusivity, truthful frequency labels, recency in-band, no paid customer unlisted, no Monadon pollution, real Last-order prices, no overdue Current Cancels, data freshness, cron active.

## The June 2026 Incident (why v3 exists — never repeat this)

Production was found running an old June-1 function body even though later migrations were recorded as applied — old SQL had been re-applied over the fixed function (there were also two migration files sharing version `20260604120000`; the obsolete one is deleted). Result: a "2-4m" name mismatch deleted 94 customers from all lists, NEWCOMERS/Current Cancels were dead, frequency buckets were asymmetric (~5,590 mislabeled members), 1,555 Monadon phones entered calling lists, and trigger_price was never written ("Last order €0.00" everywhere).

**Rules**:
1. **Never run old migration SQL in the Supabase SQL editor.** The live function carries a `COMMENT` version tag; the audit script fails loudly on drift.
2. One migration version number = one file, forever.
3. After ANY change to the engine: `node scripts/audit-segments-integrity.mjs` must be all-PASS.

Rollback safety net from the repair: `prediction_segment_members_backup_20260610` (drop after a verified week).

---

## Engine v4 — operator-editable lists (built 2026-06-26, currently SHADOW)

The thresholds that used to live inside the SQL function are moving into an editable config the engine reads, so lists can be tuned or created from **Settings → Prediction Engine** with no code change. It is built but **not yet live**: it runs in a side-by-side SHADOW so you can see exactly what would change before switching over. The current (v3.4) engine still feeds every list agents call.

What's new:
- **Edit the dials from the UI**: recency day-bands, value (€) brackets, frequency tiers, the Current-Cancels and Never-Converted windows. Saving rebuilds the shadow preview and shows a "current vs new" per-list diff. Nothing customers/agents see changes until cutover.
- **Add / remove lists**: add a band → the matching lists are created automatically; remove = deactivate by default (history kept), with a guarded hard-delete only for empty lists.
- **"Due to Reorder" (package-based recall)**: calls each customer just before they run out of product. Supply = packages bought × each product's *days of supply* (set on the Products screen; 15 = a 30-capsule pack, a 4-pack = 60). You choose how many days BEFORE depletion to call. It's an extra list — your calendar bands stay as they are. Off until you enable it.
- **Safety**: `node scripts/segment-engine-parity.mjs` shows live-vs-shadow differences (must be 0 before cutover); the audit script is now config-aware so your edits don't trigger false alarms. Cutover keeps v3.4 for instant rollback.

Migrations: `20260726000000` (scaffold), `20260726010000` (config-driven v4 + reorder), `20260726030000` (cutover — apply only when validated).
