---
name: elyon-i18n
description: Use whenever adding, changing, or translating ANY user-facing text in Elyon CRM (labels, toasts, placeholders, table headers, page titles, statuses). The app is trilingual (English + Bulgarian + Albanian) with a per-user switcher in the top bar. New UI strings must NEVER be hardcoded — they go through i18next keys in src/i18n/locales/. Also read before touching dates, exports, or anything that LOOKS like display text but is actually data.
---

# Elyon i18n Skill — Trilingual UI Rules (EN + BG + SQ)

Since 2026-06-12 the CRM is internationalized with **i18next + react-i18next**.
Every user-facing string lives in `src/i18n/locales/en.json` + `bg.json` + `sq.json`
(single namespace, dot-path keys, identical key trees — enforced by
`src/i18n/__tests__/parity.test.ts` in `npm test`).

**Albanian (`sq`, Kosovo standard)** was added 2026-06-22 and is **LIVE** — it's in
`SUPPORTED_LANGUAGES`, so the top-bar switcher and Settings → Appearance show it.
Professional wording review happens in-app (operator workflow); keys stay stable,
only values change. Cross-device persistence needs migration
`20260622120000_profiles_language_sq.sql` applied remotely (Mgmt API); until then
the `profiles.language='sq'` write fails silently and the choice sticks per-device
via localStorage.

The top-bar switcher (`LanguageSwitcher.tsx`) is a **dropdown**: the trigger shows
only the active flag + chevron, and clicking lists all languages (flag + native
name, active one checked). Adding a 4th language needs no switcher change — it
reads `SUPPORTED_LANGUAGES`.

## The Rules

1. **Never hardcode user-facing text** in JSX, toasts, placeholders, or labels.
   Add a key to ALL THREE locale files (`en.json`, `bg.json`, `sq.json`) in the
   same commit, then render with `t('domain.key')`. The parity test fails if any
   locale is missing the key.
2. **Key convention**: `domain.subarea.key`. Enum lookups use the raw enum
   value as the leaf key: `t('status.' + status)`. Domains: `common`, `nav`,
   `titles`, `status`, `leadStatus`, `cancelReason`, `roles`, `delivery`,
   `apiErrors`, plus one per page/modal (`orders`, `orderModal`, …).
3. **Components must subscribe**: any component rendering translated text calls
   `useTranslation()` — even when the text comes via a helper function
   (`statusLabel`, `cancelReasonLabel`, `friendlyRoleLabel`,
   `getCancelReasonOptions`). Outside React (module-level, plain functions):
   `i18n.t(...)` from `@/i18n`.
4. **NEVER remount on switch**: `key={language}` is forbidden — it would wipe
   an agent's half-filled order form mid-call.
5. **Plurals & interpolation**: `t('x.assigned', { count })` with
   `assigned_one` / `assigned_other` keys. No more ad-hoc `order${n !== 1 ? 's' : ''}`.
6. **Backend errors**: wrap with `apiErrorText(err)` from `src/i18n/apiErrors.ts`
   instead of showing `err.message` raw. Unknown messages fall through in English
   (deliberate). New common backend strings → add to the EXACT/PATTERNS maps.
7. **Dates**: user-visible word-bearing formats (`'MMM d'`, `'PPP'`,
   `formatDistanceToNow`) use `formatDate`/`formatDistanceToNow` from
   `src/i18n/dates.ts` (Bulgarian month names in BG, Albanian in SQ — both via
   `date-fns/locale`). Machine formats (`'yyyy-MM-dd'` payloads, fulfilment CSV
   timestamp) keep RAW `date-fns`.

## What is NEVER translated

- **Fulfilment CSV** (warehouse contract — see elyon-fulfilment-csv)
- **Currency** (`src/lib/currency.ts`): €/лв symbols, en-US number style, the
  1.95583 peg — identical in both languages (see elyon-currency)
- **Enum VALUES** in DB/payloads/URLs (`pending`, `not_satisfied`, …) — labels only
- Export FILE column headers (Pure Profit Excel/CSV stay English; dialogs translate)
- Brand/courier names (Speedy, Econt, BigArena, naturatherapy.bg, Elyon CRM)
- DB-stored data (product names, customer data, notes, segment names)

## Call scripts ARE translated — but in the DB, NOT in the locale JSON

Since 2026-06-23 the per-product **Call Scripts & Helpers** (talk tracks agents read
on calls) are locale-aware. They are long, operator-edited DB content, so they do NOT
live in `en/bg/sq.json`. Instead `call_scripts` has a `translations` JSONB column:
`{ "en": { title?, description?, script_text?, helpers? }, "sq": {...} }`. The base
columns (`title/description/script_text/helpers`) are the **Bulgarian source + per-field
fallback**. Resolve with `resolveScript(script, lang)` from `src/lib/callScripts.ts`
(never read the raw columns directly in the agent UI). Operators edit each language via
the `BG | EN | SQ` switch in Call Support Center; the AI drafts were seeded by
`scripts/translate-call-scripts.mjs` from `scripts/data/call-script-translations.json`.
Product TITLES stay as the brand name (fall back to base). So: still NO call-script
*content* in the locale JSON — only the editor's chrome keys (`callScripts.*`) go there.

## Language preference plumbing

- `localStorage('elyon.lang')` → instant load before auth (read in `src/i18n/index.ts`,
  side-effect imported FIRST in `src/main.tsx`)
- `profiles.language` column (migration `20260612100000_profiles_language.sql`) →
  cross-device; loaded in `AuthContext.fetchProfile` (with fallback if the column
  doesn't exist yet), synced by `src/contexts/LanguageContext.tsx`
- Switcher: `src/components/LanguageSwitcher.tsx` in the top bar (AppLayout) +
  a card in Settings → Appearance. Default for new users: **English** (operator decision)

## Rollout state

**ALL PHASES COMPLETE (2026-06-13).** The entire UI is bilingual:

- ✅ Phase 0+1 (2026-06-12): foundation, switcher, statuses, cancellation
  reasons, roles, sidebar nav, page titles, DeliveryMethodPicker, BreakButton
- ✅ Phase 2: agent calling surfaces (CallsPage, OrderModal, MissedCalls,
  components/calls/*, VoipContext toasts)
- ✅ Phase 3: Orders body, CreateOrderModal, GlobalSearch, NotificationsDropdown, BigArenaStatusSync
- ✅ Phase 4: Dashboard + ALL admin pages (Assigner, Warehouse, Settings all tabs,
  Insights + AgentsTab/Timeline, Webhooks/Ads, Shifts, Users, Products, Segments,
  Prediction*, CallHistory, CallScripts, LeadDistribution, Inbound, Login, NotFound)
- ✅ Phase 5: apiErrors.ts EXACT map (~55 backend strings) + interpolated PATTERNS
  (insufficient stock, personal-list claims, rate limits); all `err.message` toasts
  swept to `apiErrorText`; full i18n-scan clean

**Albanian (SQ) added 2026-06-22 — LIVE:** full `sq.json` (Kosovo standard, all
keys), date-fns `sq` locale wired, Albanian flag + dropdown switcher, `'sq'` in
`SUPPORTED_LANGUAGES`. Professional wording review still pending in-app (see intro).
Same change also swept the last hardcoded stragglers (AgentTimeline legend/tooltip,
CrossListBasketBar) into keys.

Deliberately NOT translated: RecordingsPage + Index.tsx (unrouted/dead),
SettingsPage DEV-only test-notification panel, `INV-001`-style format examples,
export FILE content (CSV/XLSX headers + AgentsTab CSV row).

## Tools

- `npm test` — locale parity + enum coverage (CI guard)
- `node scripts/i18n-scan.mjs [path]` — heuristic scan for missed hardcoded
  strings; run on each file/dir after translating it
- **After any codemod/hook work**: `npx tsc -p tsconfig.app.json --noEmit | grep "Cannot find name 't'"`
  — catches components calling t() without `useTranslation()` in scope. Vite build
  will NOT catch this (esbuild doesn't typecheck) and bare `npx tsc --noEmit`
  checks NOTHING (root tsconfig is solution-style). Burned us 2026-06-13: four
  components shipped with undefined `t` and crashed their pages. Also beware `t`
  SHADOWING in custom toast renderers (NotificationsDropdown: `t` = toast
  instance — use `i18n.t` there).
- Dev mode renders missing keys as `⟪key⟫` and warns in console — misses are loud

Bulgarian terminology is call-centre Bulgarian, terse (operator preference).
The operator reviews `bg.json` in-app; adjust wording when he objects, but keep
keys stable.

Albanian (`sq.json`) is Kosovo-standard, same terse register. It was produced as
a Claude first-draft (2026-06-22) and is **pending professional review** — adjust
wording on feedback, keep keys stable. Don't translate inside `{{…}}`, brand /
courier names (Speedy, Econt, BigArena, Pure Profit, Elyon CRM), enum values, or
the literal `Статус` / `[Customer Name]`-style tokens that map to external data.
