---
name: elyon-segments-and-prediction
description: Use for any work involving the prediction lists (segments) — the name-construction classifier (engine v3), recency/value/frequency buckets, NEWCOMERS, Current Cancels, Never-Converted, Monadon exclusion, nightly pg_cron recompute, member state carry-over, Assigner, queues, or avg_package_price. This is the agents' main work surface; read this before touching anything in it.
---

# Elyon Segments & Prediction Lists Skill (Engine v3 — 2026-06-10)

Every customer phone is classified into **at most one** rule-driven calling list. Classification is **name-construction**: `recompute_customer_segments(phone)` computes three buckets and targets the list whose NAME matches exactly. **The rule columns on `prediction_segment_lists` (recency_months_min/max, single_price_min/max, min_paid_count, lifetime_min, priority) are VESTIGIAL — they do not drive membership.** Do not "fix" lists by editing them; the engine is the function.

## ⚠️ The 2026-06 drift incident (read first)

Production once ran an OLD function body while newer migrations were recorded as applied — old SQL had been re-run over the fixed function. Damage: 94 customers silently deleted from all lists (name mismatch "2-4m"), dead NEWCOMERS/Current Cancels, ~5,590 mislabeled members, 1,555 imported Monadon phones inside calling lists, "Last order €0.00" everywhere. Hard rules since:

1. **NEVER run old migration SQL in the Supabase SQL editor.** The canonical engine lives in `supabase/migrations/20260712000000_returns_list_engine_v3_3.sql` (engine v3.3; supersedes 20260710000000 → 20260701000000 → 20260629000000) and the live function carries a `COMMENT ... 'engine v3 …'` tag.
2. **One migration version = one file.** (Two files once shared `20260604120000`; the obsolete one was deleted.)
3. After ANY engine/data change: `node scripts/audit-segments-integrity.mjs` → must be 10/10 PASS. It detects function drift, label violations, band violations, pollution, missing customers, dead cron.

**Canonical engine file**: `supabase/migrations/20260712000000_returns_list_engine_v3_3.sql` (engine v3.3 — supersedes 20260710000000; only diff is the additive Current Returns list). The live function COMMENT tag is `engine v3.3`. Parent chain: 20260710000000 (Current Cancels 14d) → 20260701000000 (NEWCOMERS pen) → 20260629000000 (v3 restore). Companion: `20260713000000_returned_at_recording_fix.sql` (trigger + backfill, like the cancelled_at fix).

## Classification (decision order — first match wins)

1. **Monadon-only phone** (`orders.source_type = 'monadon_legacy'` is excluded from EVERYTHING) → no rule list; lives only in static "FULL MONAD LIST".
2. **paid_count = 0 + in-flight order** (`pending/take/call_again/confirmed/shipped/delivered`) → NO list (worked in Pendings section).
3. **Fresh cancel** (latest action, < 14 days) → **Current Cancels** (UNASSIGNED holding pen; assignment is stripped on entry). Nightly recompute returns them to a normal bucket after 14 days. Window is measured from the cancelled order's `created_at` (same as always); verified 2026-06-23 that recent cancels are created+cancelled the same day, so created_at ≈ entry date. `orders.cancelled_at` is deliberately NOT used — it is mostly NULL on recent cancels and a 2026-05-21 bulk backfill where present. (engine v3.2, 2026-06-23; was 30 days.)
4. **paid_count = 0** → Never-Converted Recent (cancel ≤ 180d) / Never-Converted Old (older/none; includes trashed-only phones — operator decision 2026-06-10).
5. **Paid history** → name = recency + ' ' + value + ' ' + frequency:
   - **Recency** (days since last real paid order): <21 NEWCOMERS · 21–57 "21d" · 57–120 "57d" · 120–180 "4-6m" · 180–365 "6-12m" · 365–730 "1-2yr" · 730+ "2yr+".
   - **NEWCOMERS is an UNASSIGNED holding pen** (engine v3.1, 2026-06-18): on ENTRY the carry-over agent is stripped (`assigned_agent_* := NULL`), exactly like Current Cancels. Fresh buyers are visible in the Assigner but never auto-inherit an agent — only a manager's deliberate assignment sticks (it lives on the member row; the `ON CONFLICT DO UPDATE` never overwrites `assigned_agent_*`). At day 21 the nightly cron reclassifies them into the `21d …` band automatically, and at that point normal carry-over applies (a manager-set agent follows them forward).
   - **Value** (last paid order price): `≤26` vs `26+` (no split for NEWCOMERS). The `≤` is U+2264 — in SQL always build it as `chr(8804) || '26'` to survive encodings.
   - **Frequency** (lifetime paid orders, labels LITERALLY TRUE, most specific wins — operator spec 2026-06-10): 1–2 → "(1-3 orders)" · 3–4 → "(3+ orders)" · 5–6 → "(5+ orders)" · ≥7 → "(7+ orders)". A "(3+)" list must never contain a sub-3 client.

**Current Returns (ADDITIVE — engine v3.3, 2026-06-23).** Separate from the first-match-wins decision above. A customer whose **newest order is a return** ("until they order again" = no order created after their latest returned order) is tracked in **Current Returns** (UNASSIGNED, never called). It is *additive*: a customer with paid history stays in their normal band **and** also appears in Current Returns (dual membership); a return-**only** customer (paid_count = 0) appears **ONLY** in Current Returns, not Never-Converted. Current Returns is EXCLUDED from the nuclear delete + agent carry-over, and from the audit exclusivity check. Member trigger fields = the returned order (its `created_at` is the "Last order" date). `orders.returned_at` is a separate recording fix (trigger `trg_orders_set_returned_at`) — the list itself does not depend on it.

## Member rows & state carry-over (sacred)

- `trigger_price/trigger_event_at/trigger_order_id` = the "Last order" column: paid buckets → most recent paid order with price > 0 (fallback: last paid); cancel-category lists → last cancelled order. The engine WRITES these on every insert/update (the old €0.00 bug was these fields never being written).
- `avg_package_price` = lifetime_value / paid_count, EUR. **Display always via `formatEur`/`formatLev`/`formatPriceInline` from `src/lib/currency.ts`** (see elyon-currency skill; peg 1.95583 immutable).
- **Carry-over**: on a band move the engine copies `assigned_agent_*`, `last_call_*`, `is_completed`, `in_call_again_until`, `call_again_since` from the previous row (prefers an assigned row). A NEW purchase resets `is_completed`/call-again (fresh lifecycle). **Current Cancels AND NEWCOMERS entry strip assignment** (both are unassigned holding pens — Current Cancels also resets `is_completed`). Never bypass this with manual SQL on members.

## When recompute runs

1. Instantly via triggers on `orders` (INSERT / DELETE / UPDATE OF status, price, customer_phone).
2. **Nightly pg_cron job `nightly-segment-recompute`** (`0 0 * * *` UTC = 03:00 Sofia summer) → `recompute_all_segments()` (~9.6k phones, ~4 s). This powers ALL time-based movement (band aging, 14-day Current Cancels un-parking, 180-day Recent→Old, NEWCOMERS graduation). Check: `select * from cron.job;` and `cron.job_run_details`.
3. Manual: "Recompute all" button on /segments; PATCH of a list also triggers it.

## Files & surfaces

- **Engine (canonical)**: `supabase/migrations/20260712000000_returns_list_engine_v3_3.sql` (engine v3.3; parents: 20260710000000 Current Cancels 14d → 20260701000000 NEWCOMERS pen → 20260629000000 v3 restore) · returned_at fix: `20260713000000_returned_at_recording_fix.sql` · cron: `20260630000000_nightly_segment_recompute_cron.sql`.
- **Health check**: `scripts/audit-segments-integrity.mjs` (uses SUPABASE_ACCESS_TOKEN from .env; management API; read-only).
- **API**: `supabase/functions/api/index.ts` — GET /segments (overview + counts + `engine_data_as_of`), GET /segments/:id (paginated members), POST /segments/recompute, PATCH /segments/:id, assign/auto-assign/bulk-unassign.
- **UI**: `src/pages/SegmentsPage.tsx` (cards + "Engine data as of …" strip + Recompute all), `SegmentDetailPage.tsx` + `src/components/assigner/SegmentMemberTable.tsx` (Last order = trigger_price/date), Assigner, `useMyQueue.ts`, `CallsPage.tsx`, `CallAgainPage.tsx`.
- **Docs**: `docs/HOW_PREDICTION_SEGMENTS_WORK_NOW.md` (technical/operator explanation, incident history) · `docs/PREDICTION_LISTS_PLAIN_GUIDE.md` (plain-words guide for agents/managers — keep BOTH in sync with this skill on any rule change).
- **Static lists** (engine never touches): "Cancelled Pendings", "FULL MONAD LIST" (1,555 Monadon customers + product info).
- Rollback snapshot from the v3 repair: `prediction_segment_members_backup_20260610` (drop after a verified week).

## Verification ritual (non-negotiable after any change here)

1. `node scripts/audit-segments-integrity.mjs` → 10/10 PASS.
2. Spot-check a "(3+ orders)" list in the UI: only 3–4-order customers, real "Last order" prices.
3. Next morning after engine changes: member `updated_at` advanced overnight (cron alive).

## Engine v4 — config-driven, no-code list builder (BUILT 2026-06-26, SHADOW)

The hard-coded thresholds are being lifted into **operator-editable config** so lists can be tuned/created from the UI (Settings → **Prediction Engine**) with no SQL/migration/deploy. **Status: built but NOT yet live — it runs in SHADOW.** The live engine is still v3.4 (`recompute_customer_segments`); v4 writes a separate `prediction_segment_members_shadow` table on its own nightly job until the operator validates and applies the cutover.

- **Config store**: `segment_engine_config` (versioned JSONB, one `is_active`, plus `active_engine` = `'v3_4' | 'v4'`). Read by `get_segment_engine_config()`. Seeded to the EXACT v3.4 values, so shadow == live until edited (parity must be 0). Knobs: `recency_bands` (label + max_days; `holding_pen` band = NEWCOMERS, strict `<`, no value split), `value_bands` (label + max_price), `frequency_bands` (label + min_count, most-specific wins), `windows.current_cancels_days` (14), `windows.never_converted_recent_days` (180), and `reorder` (see below).
- **Engine**: `recompute_customer_segments_v4(phone)` loops over the config bands instead of hard-coded `IF` chains (migration `20260726010000`); `recompute_all_segments_v4()` bulk. Scaffold/tables/cron in `20260726000000`. All sacred behaviour preserved (exclusivity, carry-over, holding-pen assignment strip, additive Returns/Trashed, monadon exclusion).
- **List sync**: `sync_segment_lists_from_config()` ADD-only while `active_engine='v3_4'` (deactivating a list the live v3.4 still targets would nuke members); orphan-deactivation only switches on after cutover.
- **Package-based recall — "Due to Reorder"** (additive, static list, operator decision 2026-06-26): calls each customer just before they run out. `supply_days = Σ(order_items.quantity × products.days_of_supply_per_unit)` over their most recent paid order; member iff `now ≥ last_paid_at + supply_days − reorder.buffer_days`. Per-product `days_of_supply_per_unit` (default 15 = a 30-cap pack; a 4-pack = 60) is set on the Products screen. **Dormant** until `reorder.enabled` is turned on. Calendar bands are unchanged (additive).
- **API** (`supabase/functions/api/index.ts`): `GET/PUT /segments/engine-config`, `GET /segments/engine-diff` (live vs shadow + drift), `POST /segments` (create list), `DELETE /segments/:id` (deactivate by default / guarded hard-delete). RPCs: `set_segment_engine_config`, `segment_engine_diff`.
- **UI**: `src/components/settings/PredictionEngineTab.tsx` (admin-only tab) — band editors, windows, reorder, save-with-diff preview. Assigner non-distributable now keys off `is_static` (not the literal `'Trashed'`).
- **Safety tooling**: `scripts/segment-engine-parity.mjs` (live vs shadow diff — must be 0 before cutover); `scripts/audit-segments-integrity.mjs` is now **config-aware** (freq/recency boundaries + cancel window read from the active config; engine-fingerprint check branches on `active_engine`; added a "Due to Reorder" check).
- **Cutover**: migration `20260726030000` (⚠️ apply only when validated) generates the LIVE v4 FROM the proven shadow function via `pg_get_functiondef` + table swap (no hand-copy), swaps shadow data into the real table, flips `active_engine='v4'`, and keeps v3.4 as `recompute_customer_segments_v3_4` for instant rollback (rollback block included).

**Rule for changing thresholds now: edit the config in the UI, don't touch SQL.** The function is generic; the data is the rules.

## Companion skills

- `elyon-currency` (every price display), `elyon-phone-normalization` (membership keys on normalized phones), `elyon-assigner` (distribution), `elyon-security` (RLS: agents see only their assigned members).
