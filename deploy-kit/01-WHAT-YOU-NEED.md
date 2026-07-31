# 01 — What you need (servers, services, accounts, costs)

Everything a fresh country deployment depends on. **Phase 1** gets you a working CRM with no
phone dialer; **Phase 2** adds telephony. Buy/create only the Phase 1 items first.

---

## Phase 1 — required to launch the CRM

| # | Service | What it's for | Who provides | Notes |
|---|---|---|---|---|
| 1 | **Supabase** project | Database (Postgres) + Auth + the backend API (Edge Function) | supabase.com | One **new** project, separate from Bulgaria. Free tier works to start; Pro recommended for production (see below). |
| 2 | **Vercel** project | Hosts the web app (the React frontend) | vercel.com | One new project pointed at the new repo. Hobby tier can work; Pro for a team/custom SLA. |
| 3 | **GitHub** repo (private) | Holds the forked code | github.com | New private repo, e.g. `elyon-macedonia`. |
| 4 | **Domain + DNS** | The address agents log in at | a registrar (Namecheap, etc.) | e.g. `elyon-mk.com` or a subdomain. DNS points to Vercel. |
| 5 | **A computer with Node.js + Supabase CLI** | Runs migrations and seed scripts once | you | Node 20+. Used only during setup. |

### Accounts/info the operator must personally provide
- A Supabase login (and ideally a paid org if you want backups/Point-in-Time-Recovery).
- A Vercel login.
- A GitHub login that can create a private repo.
- A domain (bought from any registrar).
- The **product catalog source** (the BigArena fulfilment XLSX) — for the catalog import.
- Decisions on **Macedonia couriers** and a **city/settlement list** (see file 04 + 06).

---

## Phase 2 — telephony (deferred; add when you want calls)

Covered in detail in [07-TELEPHONY-LATER.md](07-TELEPHONY-LATER.md). Summary of what you'd buy:

| # | Service | What it's for | Notes |
|---|---|---|---|
| 6 | **VPS** (Linux server) | Runs the PBX (Asterisk + FreePBX) | New box, or reuse the Sofia box. ~€7/mo class. |
| 7 | **SIP trunk** (Macedonia/Albania carrier) | Connects the PBX to the real phone network | e.g. IPKO / Vodafone / Albtelecom — needs a business account. The biggest unknown; pricing per carrier. |
| 8 | **DID phone numbers** (+383) | The numbers customers see / that ring in | Bought from the trunk carrier. |
| 9 | **TLS certificate** | Encrypts the browser↔PBX audio link | Free via Let's Encrypt. |

> Until Phase 2, agents work the CRM normally and **log call outcomes manually**. The dialer
> simply isn't shown (`VITE_USE_REAL_VOIP=false`).

---

## Optional

| Service | What it's for | Notes |
|---|---|---|
| **Discord** + bot | Read-only team reports/slash commands | New Discord app + a read-only DB role. See [../docs/discord-bot/CHECKLIST.md](../docs/discord-bot/CHECKLIST.md). |
| **OpenCart store bridge** | Auto-import web-store orders as leads | Only if a Macedonia web store exists. See [../docs/WEBSITES_WEBHOOKS.md](../docs/WEBSITES_WEBHOOKS.md). |

---

## Cost sheet (rough, EUR/month — confirm current pricing with each vendor)

| Item | One-time | Monthly | When |
|---|---|---|---|
| Domain | — | ~€1 (≈€10–15/yr) | Phase 1 |
| Supabase | — | €0 (Free) → ~€25 (Pro) | Phase 1 |
| Vercel | — | €0 (Hobby) → ~€20 (Pro) | Phase 1 |
| GitHub private repo | — | €0 | Phase 1 |
| **Phase 1 subtotal** | **€0** | **~€1 – €46** | |
| VPS for PBX | — | ~€7 | Phase 2 |
| SIP trunk + DIDs | varies (setup) | carrier-dependent (the BG trunk is ~€160/mo for 4 ch / 10 numbers / 5,000 min — Macedonia will differ) | Phase 2 |
| Let's Encrypt TLS | — | €0 | Phase 2 |

> **Reality check:** Phase 1 can run on near-free tiers while you validate the market.
> Telephony is the real recurring cost and the main reason it's a separate phase.

---

## What you do **not** need to buy again

- No new LLM/AI service — the CRM uses **no** OpenAI/Claude/Anthropic at runtime
  (the prediction engine is rule-based; call scripts are stored text).
- No separate auth provider — Supabase Auth (email + password) is built in.
- No separate file host for recordings — they live on the PBX disk (Phase 2 only).

➡ Next: [02-FORK-THE-CODE.md](02-FORK-THE-CODE.md)
