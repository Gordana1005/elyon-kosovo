# Operations runbook

> Deploy, migrate, configure, and unbreak. Pair this with [VAULT.md](VAULT.md) (credentials) and
> [../PBX-SETUP.md](../PBX-SETUP.md) (telephony server).

---

## 1. Where everything runs

| Thing | Host | Identifier |
|---|---|---|
| Frontend | Vercel | project `elyoncrm` (`prj_965V2iBg793RmiJJw9m6Tl3djllX`), org `team_vvGANvn1DSdgZZAIUBkcCSWh` |
| Domains | Namecheap → Vercel | `elyoncall.com` + `www`; legacy `elyoncrm.vercel.app` |
| DB + Edge Function + Auth | Supabase | project ref `sxymaloycddnoxudxaqp` |
| PBX | AlphaVPS Sofia | `pbx.elyoncall.com` → `104.152.48.222` |
| Repo | GitHub (private) | `github.com/Gordana1005/elyoncrm`, default branch `main` |

---

## 2. Local development
```bash
npm install
npm run dev        # Vite dev server → http://localhost:8080
npm run build      # production build → dist/
npm run preview    # preview the prod build
npm test           # vitest (currently 1 trivial test)
npm run lint       # eslint (currently red: 643 errors, mostly `any`)
npm run smoke      # Playwright smoke test against the deployed app
```
`.env` must contain `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`
(safe/public) and `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ACCESS_TOKEN` (server‑only, for scripts/CLI).
Values: [VAULT.md](VAULT.md).

---

## 3. Deploy

### Frontend (automatic)
Push to `main` → Vercel builds (`npm run build`) and deploys. PRs get preview deploys (whose origins the
Edge Function's CORS regex already allows). Build‑time `VITE_*` vars come from Vercel project settings, not
the repo.

### Edge Function (manual)
The function is **not** redeployed by a frontend push — deploy it explicitly after changing
`supabase/functions/api/index.ts` (or `ALLOWED_ORIGINS`, or any role logic):
```bash
# PowerShell — load the access token from .env, then deploy
$env:SUPABASE_ACCESS_TOKEN = (Select-String '^SUPABASE_ACCESS_TOKEN=' .env).Line.Split('=')[1].Trim('"')
npx supabase functions deploy api --project-ref sxymaloycddnoxudxaqp
```
```bash
# bash equivalent
SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2 | tr -d '"') \
  npx supabase functions deploy api --project-ref sxymaloycddnoxudxaqp
```
> The CLI reads the token from the **environment**, not from `.env` automatically. A stale `supabase login`
> session for a *different* account causes a 403 ("account does not have the necessary privileges").

### Database migrations (manual)
```bash
npx supabase db push --linked            # apply pending migrations
npx supabase migration new <slug>        # scaffold a new one
# if ordering complaints:
npx supabase migration repair --status reverted <timestamp>   # then retry push
```
**Never** `npx supabase db reset --linked` on production. Regenerate types after schema changes:
```bash
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

### Edge‑Function secrets
```bash
npx supabase secrets set WEBHOOK_SECRET=… --project-ref sxymaloycddnoxudxaqp
npx supabase secrets list --project-ref sxymaloycddnoxudxaqp
```
The function also reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` from its env
(Supabase provides the first two; ensure `SUPABASE_ANON_KEY` and `WEBHOOK_SECRET` are set).

---

## 4. CI/CD
`.github/workflows/ci.yml` runs on push/PR to `main`: `npm ci` → **`npm run build`** (with placeholder
`VITE_*` so it compiles) → **`npm test`**. **It does NOT run `npm run lint`** — that's why lint can be red
without blocking. Vercel deploys independently of CI.

---

## 5. Routine ops

| Task | Command |
|---|---|
| Refresh courier offices | `node --env-file=.env scripts/scrape-courier-offices.mjs --commit` |
| Re‑seed product webhooks (after new products) | `node --env-file=.env scripts/create-webhooks-for-products.mjs --commit` |
| Import/refresh products | `node --env-file=.env scripts/import-products-bigarena.mjs --commit` |
| Daily BigArena order status reconciliation (closes shipped → paid/returned loop) | UI: Warehouse → Incoming (or Orders) → upload the partner's tracking export CSV/XLSX. Preview then apply. Only affects shipped orders. See ORDERS_AND_CLIENTS.md. |
| Verify analytics/segments | `node --env-file=.env scripts/check-insights-accuracy.mjs` · `…/check-segment-counts.mjs` |
| Recompute segments (also in UI) | `POST /segments/recompute` (admin) |
| Create a user | UI `/users`, or `POST /users/create` |
| Smoke test prod | `npm run smoke` |

Full script reference: [IMPORT_EXPORT.md](IMPORT_EXPORT.md).

---

## 6. PBX ops (telephony)
See [../PBX-SETUP.md](../PBX-SETUP.md). Quick:
```powershell
ssh -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222
```
```bash
fwconsole restart                          # first thing to try if FreePBX misbehaves
systemctl restart httpd php-fpm            # second
asterisk -rx "pjsip show registrations"    # trunk status
asterisk -rx "pjsip show endpoints"        # extensions
certbot certificates                       # TLS
```
Don't change Apache user (`asterisk`), PHP (7.4), SELinux (Permissive), or non‑`*_custom.conf` files.

---

## 7. Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Every API call CORS‑errors; pages spin forever | New frontend domain not in `ALLOWED_ORIGINS`, or function not redeployed → edit array + `functions deploy api`. |
| Webhooks 401 | `WEBHOOK_SECRET` mismatch → align sender + Supabase secret; recompute HMAC over the exact body. |
| Webhooks silently accepted but unsigned | `WEBHOOK_SECRET` unset on the function → set it. |
| Dashboard/segment counts look low | A non‑paginated query (e.g. `orders/stats`) truncating at 1000 → use the paginated endpoints / add pagination ([AUDIT_FINDINGS.md](AUDIT_FINDINGS.md)). |
| Lead Distribution config save / auto‑assign → 500 | The `userId` bug ([AUDIT_FINDINGS.md](AUDIT_FINDINGS.md)) → fix to `user.id`, redeploy. |
| `supabase functions deploy` → 403 | Stale `supabase login` for another account → rely on `SUPABASE_ACCESS_TOKEN` env, or `supabase logout`/`login` the right account. |
| `db push` "out of order" | `migration repair --status reverted <ts>` then retry. |
| Login works but redirects to `/login` | User has no `user_roles` row → grant a role (UI/SQL) or re‑run a create script. |
| Cyrillic mojibake in an export | Wrong CSV BOM/encoding for that consumer — fulfilment CSV is comma + **no BOM**; generic exports are `;` + BOM ([PRODUCTS_STOCK_WAREHOUSE.md](PRODUCTS_STOCK_WAREHOUSE.md)). |
| `3.59886e+11` phones appear | Scientific‑notation import pollution → `scripts/cleanup-polluted-phones.mjs`. |

---

## 8. Backups & data safety
- Supabase provides managed Postgres backups (verify the retention tier in the dashboard for the project).
- Before a risky bulk script: it's dry‑run by default; the CPA importers write timestamped logs enabling
  `rollback-cpa-import.mjs`.
- The `audit_log` and `order_history` are immutable trails for forensic/debug.
- Keep [VAULT.md](VAULT.md) current; it's the disaster‑recovery key to rebuilding access.

---

## 9. Standing up a fresh environment (DR / clone)
1. Create a Supabase project; copy ref/URL/anon/service‑role/DB password.
2. `supabase link --project-ref <ref>` → `db push` (rebuilds schema/RLS/functions/triggers) → `functions deploy api`.
3. Set Edge secrets (`WEBHOOK_SECRET`, `SUPABASE_ANON_KEY`).
4. Update `.env` + `supabase/config.toml` + Vercel env vars; update `ALLOWED_ORIGINS` for the new domain; redeploy.
5. `node scripts/create-admin-users.mjs` (then rotate passwords).
6. Seed reference data: `fetch-bg-settlements`, `scrape-courier-offices`, products import, `create-webhooks-for-products`.
   (This same flow is the basis of the [RESELLER_GUIDE.md](RESELLER_GUIDE.md).)
