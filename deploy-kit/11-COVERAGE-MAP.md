# 11 — Coverage map (is *everything* captured?)

Short answer: **yes.** A hard fork is a literal copy of the repo, so you don't *re-write*
anything — every feature, every screen, every migration, the whole design, and the warehouse
flow all come along automatically. This file proves it by mapping each functional domain to the
exact code/migrations/docs that carry it.

---

## Why nothing has to be re-created

| Layer | Where it lives | How it transfers |
|---|---|---|
| **Database schema** (tables, enums, RLS, triggers, RPC functions, **pg_cron**, config seeds) | `supabase/migrations/` — **131 files**, build from zero | `supabase db push` ([03](03-SUPABASE-FROM-ZERO.md)) |
| **Backend / API** | a **single** edge function `supabase/functions/api/` (~130 routes) | copied in the fork; redeploy ([03](03-SUPABASE-FROM-ZERO.md)) |
| **Frontend + design** | `src/` — **33 pages** + component library + Tailwind theme + dark mode | copied in the fork; build & deploy ([05](05-FRONTEND-DEPLOY.md)) |
| **Business rules** | `.grok/skills/` — 13 skills | copied in the fork |
| **Operator docs** | `docs/` — 35 docs | copied in the fork |

So the question isn't "did we write the features down" — they're **all in the repo as working
code**. The kit only adds the *delta* (per-market changes) and the *process* (how to stand it up).

---

## Domain-by-domain coverage

Every area below is fully present. "Migrations" = schema/logic; "UI" = screens; "Docs/Skills" =
the manual.

| Domain | Migrations (examples) | UI (src) | Docs / Skills |
|---|---|---|---|
| **Auth, RBAC, permissions, privacy** | `security_hardening_batch_a`, `get_my_permissions_rpc`, `seed_default_permissions`, `lock_down_permissions_tables`, `admin_grants_all_roles` | `LoginPage`, `UsersPage`, `settings/` | USERS_ROLES_PERMISSIONS, SECURITY; `elyon-security` |
| **Orders lifecycle** | foundation (`20260214/15…`), `orders_termination_reasons`, `orders_confirmed_by`, `cancellation_reasons_*`, `cancelled_pendings_support`, `fix_stuck_takes` | `Orders`, `AssignedPage`, `OperationsPage` | ORDERS_AND_CLIENTS |
| **Customers & phone** | `customer_profiles`, `order_address_granularity`, `orders_quarter` | `SearchPredictionPage`, `search/` | `elyon-phone-normalization` |
| **Products, stock & WAREHOUSE** | `product_barcode`, `warehouse_incoming_orders_indexes`, `courier_rates_and_cost_repair` | **`WarehousePage`**, `ProductsPage` | PRODUCTS_STOCK_WAREHOUSE; `elyon-stock-and-bigarena`, `elyon-warehouse-incoming`, `elyon-fulfilment-csv` |
| **Couriers, delivery & settlements** | `courier_offices`, `bg_settlements`, `settlement_municipality`, `home_courier`, `courier_office_post_code` | `DeliveryMethodPicker`, order modals | `elyon-logistics-costs` |
| **Prediction segments / engine** | `prediction_segments` + ~25 segment migrations + `segment_engine_v4_scaffold`, `segment_engine_controls`, `restore_segment_engine_v3`, `nightly_segment_recompute_cron` | `SegmentsPage`, `PredictionListsPage`, `SegmentDetailPage`, `PredictionLeadsPage`, `AssignerPage`, `LeadDistributionPage`, `assigner/` | PREDICTION_* (several); `elyon-segments-and-prediction`, `elyon-assigner` |
| **Calls, telephony & recordings** | `agent_telephony`, `call_logs_*`, `active_call_views`, `missed_calls`, `missed_call_voicemail` | `CallsPage`, `CallHistoryPage`, `RecordingsPage`, `MissedCallsPage`, `CallAgainPage`, `VoipHealthPage`, `calls/`, `lib/voip/` | CALLS, telephony/*; `elyon-voip-and-pbx` *(activation = Phase 2)* |
| **Call scripts (trilingual)** | `20260215081123…` (template), `call_scripts_title_description`, translations | `CallScriptsPage` | CALL_SCRIPTS; `elyon-i18n` |
| **Shifts & agent activity** | `shift_breaks`, `agent_activity_module`, `profiles_last_seen` | `MyShiftsPage`, `ShiftsManagementPage`, `activity/` | INSIGHTS_ANALYTICS |
| **Personal list (agent holds)** | `personal_list_holds`, `personal_list_expiry_helpers` | `PersonalListPage` | — |
| **Webhooks, inbound leads, OpenCart** | `opencart_order_source` + webhook/inbound tables (foundation) | `WebhookManagementPage`, `InboundLeadsPage` | WEBSITES_WEBHOOKS; `elyon-webhook-and-lead-ingestion` |
| **Insights, finance, commissions, attribution** | `seed_default_permissions` (financial_visibility), `order_prediction_attribution` | `ManagementInsightsPage`, `Dashboard`, `insights/` | INSIGHTS_ANALYTICS, finance/*; `elyon-agent-commissions`, `elyon-logistics-costs` |
| **TV leaderboard + daily bonus** | leaderboard migration | `TvLeaderboardPage` | (memory: TV Leaderboard) |
| **Notifications** | `notification_triggers`, `notify_order_paid` | in-app toasts/banners | — |
| **Audit log** | `audit_log` | (written by the edge function) | SECURITY |
| **Currency & i18n** | — | `lib/currency.ts`, `i18n/` (en/bg/sq) | `elyon-currency`, `elyon-i18n` |
| **Discord bot (optional)** | read-only DB role | `discord-bot/` | docs/discord-bot/* |

If you can name a screen in the live app, it's one of the 33 pages above and it forks along
unchanged.

---

## Migration completeness & the one honest caveat

**What's guaranteed:** the 131 migration files rebuild the entire schema from an empty database
— ~39 tables, the enums, every RLS policy, all triggers, the PL/pgSQL **RPC functions**, the
**nightly pg_cron** job, and the **config/reference seeds** (27 segment lists, role permissions,
financial visibility, role privacy, module settings, app settings, the v3.4 engine config, the
call-script template). Nothing in that list is "manual."

**SQL that lives *outside* migrations (and what to do with it):**
- `backup_before_*.sql` (repo root) — old pre-migration snapshots. **Ignore** for the fork.
- `scripts/segment-engine-cutover.sql` — the **optional** v4-engine cutover. **Leave it
  unapplied** so Kosovo runs the proven v3.4 engine (same as live today).

**The caveat (be honest about it):** over the project's life some changes were applied to the
*live* DB via the Supabase Management API / SQL editor, and notes suggest a migration or two may
even be unapplied on live. For a **fresh fork this is a non-issue** — you apply **all** migrations,
so you get the complete *intended* schema. The only thing a fork can't capture is a hypothetical
live-only change that was never written as a migration file at all.

**Optional proof before launch (read-only — does not modify live):** if you want certainty that
the migration set equals the live schema, do a one-time schema-only diff against the live project:

```bash
# READ-ONLY: pulls the live schema definition only (no data, no writes)
npx supabase db diff --linked --schema public     # run while linked to the LIVE ref, just to read
```

If that prints nothing meaningful, the migration set is a faithful, complete rebuild and the
fork is 100% covered. (You can skip this and simply trust the migrations — they are the
documented source of truth.)

---

## What is genuinely *not* in the repo (and never was)
- **Runtime data** — orders/customers/calls (by design; Kosovo starts fresh).
- **Secrets** — gitignored ([08](08-SECRETS-TEMPLATE.md)).
- **PBX server config** — lives on the Sofia box, but is fully *documented* and rebuildable
  ([07](07-TELEPHONY-LATER.md), `PBX-SETUP.md`, telephony RUNBOOK).

➡ Back to [00-START-HERE.md](00-START-HERE.md)
