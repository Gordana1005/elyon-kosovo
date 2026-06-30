# Elyon CRM — Kosovo Fork (Natura Therapy XK)

This repo is a **hard fork** of the live Bulgarian Elyon CRM, prepared for a separate Kosovo
operation. It shares **nothing at runtime** with Bulgaria (own repo / own Supabase / own Vercel).
The full from-zero recipe lives in [`deploy-kit/`](deploy-kit/00-START-HERE.md) — this file is
just the *current state* of this fork.

> 🛑 Never run any command in this repo against the live BG Supabase ref
> `sxymaloycddnoxudxaqp` or the domain `elyoncall.com`. This fork uses its own new infra only.

---

## 🟢 LIVE NOW (Phases 0–5 complete)

- **Frontend (Vercel):** https://elyon-kosovo.vercel.app  (project `gordanas-projects-a53c0208/elyon-kosovo`, GitHub-connected)
- **Local dev:** `npm run dev` → http://localhost:8080
- **Backend (Supabase):** project `bmfxhgznttcnnlqloqzp` — all 131 migrations applied, edge function `api` deployed, `WEBHOOK_SECRET` set, `pg_cron` on.
- **Seeded:** 3 admin users (`@elyon-xk.local`, pw `12345678` — rotate!), 67 products (EUR), 10 call scripts, 67 per-product webhooks.
- **Verified end-to-end:** admin login ✓ · 67 products readable ✓ · unsigned webhook → 401 (fail-closed) ✓ · signed webhook → lead+order created ✓ · Vercel↔Supabase CORS ✓.
- **Secrets** live in `docs/VAULT.md` (gitignored). DB password not needed — the CLI access token drove `db push`.

> Migration replay fixes made for a from-scratch build (live BG never replayed these):
> guarded the `missed_calls` trigger in `20260604130000` + recreated it in `…0614120000`;
> dropped the colliding `4-6m` rows before the rename in `…0605120000`; renamed two
> duplicate-version files (`…0710000000`/`…0711000000` → `…0710010000`/`…0711010000`).

## ✅ Done (Phase 0 + Phase 1)

- **Standalone copy** of the entire front + back end (no BG runtime data, no secrets, no git
  history). Secrets (`.env`, `.secrets/`, `docs/VAULT.md`, `.vercel/`) were deliberately **not**
  copied. Fresh git history; `origin = github.com/Gordana1005/elyon-kosovo`.
- **Production build passes** (`npm run build` → green).
- **Bulgaria → Kosovo per-market edits applied** (placeholders + `TODO(kosovo)` markers where a
  real value isn't known yet):
  | Area | Change |
  |---|---|
  | Currency | EUR-only — `formatLev`→`""`, `formatPriceInline`→`€` only (`src/lib/currency.ts`, `discord-bot/src/lib/currency.ts`). No more lev / dual display. |
  | Timezone | `Europe/Sofia` → `Europe/Belgrade` everywhere (12 spots in the edge fn, 3 in `src/`, 5 in the Discord bot). |
  | Phone | E.164 normalization + match candidates now use `+383` (5 sites); `normalizeBgPhone` retargeted. BG telephony DID literals left intact for Phase 2. |
  | Language | Default UI language `en` → `sq` (Albanian) — `src/i18n/index.ts`. |
  | Login | `EMAIL_DOMAIN` → `elyon-xk.local` (placeholder) — `src/pages/LoginPage.tsx`. |
  | CORS | BG domains → `elyon-xk.com` / `elyon-kosovo.vercel.app` placeholders + `localhost:8080` kept — `supabase/functions/api/index.ts`. |
  | Webhook source | `naturatherapy.bg` → `naturatherapy.xk` (placeholder) — edge fn. |
  | VOIP | `VITE_USE_REAL_VOIP="false"` (dialer hidden — Phase 1 has no telephony). |

Search the codebase for `TODO(kosovo)` to find every spot that still needs a real value.

---

## ⏳ TODO before go-live

**Needs your input / real Kosovo data:**
- Real production **domain** → replace `elyon-xk.com` in CORS (`api/index.ts`) + `EMAIL_DOMAIN`.
- **Couriers + city list** — currently BG (`speedy`/`econt` + `bg_settlements`). Home-delivery
  works out of the box; swap in Kosovo carriers when known (`DeliveryMethodPicker.tsx`, enums,
  `src/lib/address.ts`).
- Kosovo phone **digit-length** rules — `+383` prefix is set, but the length thresholds in the
  normalizer assume BG; verify against real Kosovo numbers.

**Infra (see `deploy-kit/`):**
- Phase 2 telephony (PBX, SIP trunk, +383 DIDs) — entirely deferred; `deploy-kit/07-…`.
- Polish: remove the now-empty `levValue` sublines on dashboard cards.

---

## ▶️ How to run it

### 1. Backend — new Supabase (one-time)
```bash
# After YOU create the new Supabase project (pg_cron enabled, sign-ups off):
#   set project_id in supabase/config.toml to the NEW ref (never sxymaloycddnoxudxaqp)
supabase link --project-ref <NEW_REF>
supabase db push                       # applies all 131 migrations
supabase secrets set WEBHOOK_SECRET=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=…
supabase functions deploy api --no-verify-jwt
```

### 2. Seed (dry-run first, then re-run with `--commit`)
```bash
node scripts/create-admin-users.mjs          # edit USERS + @elyon-xk.local first; rotate 12345678
node scripts/import-products-bigarena.mjs --file=products-export-2026-06-11.xlsx
node scripts/import-call-scripts.mjs
node scripts/create-webhooks-for-products.mjs
node scripts/audit-segments-integrity.mjs    # should pass clean
```

### 3. Frontend — local
```bash
# fill .env with the new VITE_SUPABASE_* values, then:
npm install
npm run dev          # http://localhost:8080
```

### 4. Frontend — Vercel (CLI already logged in as gordana1005)
```bash
vercel link                      # project: elyon-kosovo
vercel env add VITE_SUPABASE_PROJECT_ID production   # repeat for URL, PUBLISHABLE_KEY, VITE_USE_REAL_VOIP=false
vercel --prod
# then add the *.vercel.app domain to ALLOWED_ORIGINS (api/index.ts) and redeploy the function
```
