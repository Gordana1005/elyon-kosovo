# Elyon CRM — Macedonia (Natura Therapy MK)

This repo is a **hard fork** of the live Bulgarian Elyon CRM, run as a separate Macedonian
operation. It shares **nothing at runtime** with Bulgaria (own repo / own Supabase / own Vercel).

> **Why the infrastructure says "macedonia".** The fork was stood up on 2026-06-30 for Macedonia, then
> re-aimed at **Macedonia** on 2026-07-31 because that project was already clean. The Supabase
> ref, Vercel project and GitHub repo names were deliberately kept — renaming them buys nothing
> and breaks the deploy links. **The market is Macedonia.** (Supersedes `MACEDONIA-FORK-STATUS.md`.)

> 🛑 Never run any command in this repo against the live BG Supabase ref
> `sxymaloycddnoxudxaqp` or the domain `elyoncall.com`. Run
> **`node scripts/assert-mk-target.mjs`** before any state-changing command.

---

## 🟢 Current state

- **Frontend (Vercel):** https://elyon-natura.vercel.app (`gordanas-projects-a53c0208/elyon-natura`, GitHub-connected → **push to `main` auto-deploys production**)
- **Backend (Supabase):** `bmfxhgznttcnnlqloqzp` — **159 migrations applied**, edge function `api` deployed, `WEBHOOK_SECRET` set, `pg_cron` on.
- **Data:** empty (0 orders / 0 customers / 0 call logs). 67 products, 4 admin profiles.
- **Logins:** `@elyon-mk.local`, usernames `MileStoev` / `MikiMitrov` / `TomeDonchev` / `ntmacedonia`. Password still the seeded one — **rotate**.
- **Secrets:** `docs/VAULT.md` (gitignored).

### Code parity with Bulgaria — done 2026-07-31

Brought forward 28 migrations and ~33 files that shipped upstream after the fork: segment engine
v3.4 → v3.6, assigner truth RPCs + mass-unassign, `shipped_at`/`paid_at` + agent "My Orders",
call-listened mark + recording reconciler, the **affiliate/CPA system**, duplicated-order status,
agent payouts, the RLS lockdown set, `notifications.meta` + unpaid-delivery chase, Macedonian
locale, VOIP minutes + live agent state.

Merged 3-way against the fork point (BG@`25561ef`): 69 fast-forwards, 21 merges, 33 new files,
**3 conflict hunks**. The fork's own delta survived intact.

**Deliberately NOT ported:** the BigArena stock-sync upload — its parser reads the Bulgarian
fulfilment panel's Cyrillic headers (`Свободна наличност`, `Баркод`) and MK uses a different
provider. Its parser lib *is* present because `BigArenaStatusSync` imports from it.

### Market layer (Macedonia)

| Area | State |
|---|---|
| Currency | **MKD only** in the UI. Stored EUR; `MKD_PER_EUR = 61.5` is **frozen** (see below). `formatMoney` is the money formatter; `formatLev`/`eurToLev`/`BGN_PER_EUR` are deleted. |
| COD | `codFor()` returns amount **and** currency together; rounds once to the nearest 10 ден. |
| Timezone | `Europe/Skopje` throughout (DB functions, edge fn, frontend). |
| Phone | `+389`, 8 subscriber digits (national `0`+8=9, E.164 `389`+8=11). `normalizeMkPhone`. |
| VAT | **18%** — ⚠️ unconfirmed, see below. |
| Language | Default `mk`; `en`/`sq`/`bg` also shipped. Call-script + promo base language = `mk`. |
| Login | `elyon-mk.local` |
| Webhook | Accepts **EUR or MKD only** — anything else is a 400. |
| Couriers/cities | **Still Bulgarian** (Speedy/Econt + `bg_settlements`) — deferred. |
| Telephony | Deferred (Phase 2). `VITE_USE_REAL_VOIP=false`; A1-Bulgaria DIDs left in place, marked `TODO(mk)`. VOIP minutes bundle seeded at **0** (no MK carrier contract). |

Search for `TODO(mk)` to find every spot still needing a real value.

---

## ⚠️ The frozen peg — read before touching money

`MKD_PER_EUR = 61.5` in `src/lib/currency.ts` is an **internal accounting constant, not a rate to
keep current.** The Bulgarian lev is legally fixed to the euro forever, so deriving it at render
time is safe. The denar is a *managed* NBRM peg. The moment someone "updates it to today's rate",
every historical order, every closed agent payout, every past revenue report and every COD already
collected from a customer silently re-prices — with no audit trail and no way to tell which figure
was actually quoted on the phone.

**If the market moves, re-price the CATALOGUE in EUR** (`scripts/reprice-catalogue-mk.mjs`).
`src/lib/currency.test.ts` pins the constant so an edit fails CI.

---

## ⏳ Before go-live

**Needs your input:**
1. **Denar shelf prices.** The catalogue still carries Bulgarian-style EUR points (39.90 → an
   untidy `2.454 ден`). Run `node scripts/reprice-catalogue-mk.mjs --plan` to see the mapping,
   then supply the real advertised denar prices. Cheapest to do now, while `orders = 0`.
2. **VAT rate.** 18% is Macedonia's standard rate, but food supplements may fall under the
   preferential 5%/10% band. `VAT_RATE` (edge fn) feeds every profit report.
3. **Commission tiers.** Still `<25€→1, 25–35€→2, ≥35€→3`. With a ~€32 hero product almost every
   order lands in tier 2. A comp-plan decision, not a port decision. Note `MarginLabTab.tsx`
   duplicates the tier logic — change both.
4. **Macedonian couriers + city list**, replacing Speedy/Econt and `bg_settlements`.

**🛑 Hard go-live blocker:** the fulfilment CSV is BigArena's **Bulgarian 3PL format**. Until a
Macedonian carrier confirms the column contract (and whether they want whole denars), **it must
not be used for real shipments**. `.grok/skills/elyon-fulfilment-csv/SKILL.md` describes a
Bulgarian warehouse serving a Skopje call centre — for MK that relationship inverts.

**Also pending:** rotate the seeded admin password and the credentials in `docs/VAULT.md`;
real production domain (replaces `elyon-mk.com` in CORS + `EMAIL_DOMAIN`); Phase-2 telephony.

---

## Operating notes

- **Migrations:** the DB password was never recorded, so `supabase db push` cannot open a direct
  Postgres connection. Use `node scripts/apply-migration-mk.mjs <file.sql>` (Management API, same
  `postgres` role). Recording the password in VAULT §1 restores the normal path.
- **`npx tsc --noEmit` is a NO-OP here** — the root `tsconfig.json` has `"files": []`. The real
  gate is `npm run build`.
- **After any migration bundle**, run `node scripts/engine-fixture-mk.mjs`. The segment engine
  resolves its target list by exact name match and deletes memberships *before* resolving, so a
  drifted list name wipes members silently, with no error.
- Legacy one-off scripts in `scripts/` (`import-monadon-csv`, `import-cpa-xlsx`,
  `cost-report-since-18may`, `finance/build-finance-pdfs`, …) are **Bulgarian** tooling carried
  over with the fork. They still hardcode the lev peg and 20% VAT. They are dormant — do not run
  them against Macedonia without converting them first.

### Migration replay fixes (kept — never take BG's versions of these)
Guarded the `missed_calls` trigger in `20260604130000` + recreated it in `…0614120000`; dropped
the colliding `4-6m` rows before the rename in `…0605120000`; renamed two duplicate-version files
(`…0710000001`/`…0711000001` → `…0710010000`/`…0711010000`). BG never replays from scratch, so it
never hit these.
