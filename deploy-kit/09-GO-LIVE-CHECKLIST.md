# 09 — Go-live checklist

One ordered, tick-box pass that ties the whole kit together. Phase 1 = working CRM. Phase 2 =
telephony.

> 🛑 Before every command, confirm it targets the **new** Kosovo ref — never `sxymaloycddnoxudxaqp`.

---

## Pre-flight (accounts & decisions) — [01](01-WHAT-YOU-NEED.md)
- [ ] Supabase, Vercel, GitHub logins ready
- [ ] Domain bought
- [ ] Product catalog XLSX in hand
- [ ] Kosovo courier(s) + city list decided
- [ ] A machine with Node 20+ and the Supabase CLI

## Code fork — [02](02-FORK-THE-CODE.md)
- [ ] `elyon-kosovo` repo created, **detached** from the Bulgarian remote
- [ ] Confirmed no `.env` / `docs/VAULT.md` / `.secrets/` came along
- [ ] `npm install && npm run build` succeeds on the untouched fork

## Database & backend — [03](03-SUPABASE-FROM-ZERO.md)
- [ ] New Supabase project created (EU region), DB password saved to vault
- [ ] `supabase/config.toml` `project_id` set to the **new** ref
- [ ] Fork `.env` filled with **new** project values
- [ ] `supabase db push` applied **all** migrations with no errors
- [ ] `pg_cron` enabled; nightly recompute job present (`select * from cron.job;`)
- [ ] Edge secrets set (`WEBHOOK_SECRET` new, anon/service/url)
- [ ] `supabase functions deploy api` succeeded
- [ ] Public sign-ups disabled in Auth

## Seed — [04](04-SEED-AND-BOOTSTRAP.md)
- [ ] Admin(s) created (emails edited for Kosovo); **bootstrap password rotated**
- [ ] Products imported (`--commit`)
- [ ] Call scripts imported (`--commit`)
- [ ] Per-product webhooks created (`--commit`)
- [ ] Kosovo couriers + cities loaded (even a minimal list)
- [ ] `audit-segments-integrity.mjs` clean

## Per-market edits (Group A) — [06](06-PER-MARKET-CHANGES.md)
- [ ] Currency → EUR-only (peg/lev display neutralized)
- [ ] Timezone → `Europe/Belgrade` everywhere
- [ ] Phone default → +383 (and the `hasFullPhone` length check re-checked)
- [ ] Login email domain updated (matches admin emails)
- [ ] Default UI language → `sq`
- [ ] CORS allow-list → Kosovo domain; function redeployed
- [ ] Couriers/address strings updated
- [ ] Grep sweep clean: `1.95583`, `Europe/Sofia`, `elyoncall.com`, `elyoncrm.local`

## Frontend — [05](05-FRONTEND-DEPLOY.md)
- [ ] Vercel project imported; env vars set; `VITE_USE_REAL_VOIP=false`
- [ ] Domain added + DNS pointed; HTTPS green
- [ ] Production redeploy after the Group A edits

---

## Phase-1 smoke tests
- [ ] Open the domain → login page loads in Albanian
- [ ] Log in as admin → dashboard renders, **no** CORS errors in console
- [ ] Imported products show in the catalog
- [ ] **Create a test order** → it saves and appears in lists; prices show in EUR only
- [ ] **Create a test agent**, assign the order, confirm an agent can see only their own
- [ ] **Fire a signed webhook** to one product slug (HMAC with the new `WEBHOOK_SECRET`) → a
      lead/order appears; an unsigned request is **rejected (401)** (fail-closed)
- [ ] Trigger a segment recompute (or wait for nightly) → membership computes without error
- [ ] Times shown (activity/leaderboard day boundary) reflect Kosovo time

✅ If all the above pass, **the Kosovo CRM is live** (Phase 1).

---

## Phase 2 (telephony) acceptance — [07](07-TELEPHONY-LATER.md)
- [ ] Kosovo PBX reachable; trunk "Reachable"; TLS valid
- [ ] Group B edits applied (PBX host + +383 DIDs); `VITE_USE_REAL_VOIP=true`; redeployed
- [ ] Browser → +383 outbound call has **two-way audio**
- [ ] Inbound to a +383 DID rings an agent
- [ ] A recording is produced and **links to the call log**
- [ ] `/voip-health` is green

➡ Next: [10-CLIENT-HANDOVER.md](10-CLIENT-HANDOVER.md)
