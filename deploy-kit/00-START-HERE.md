# 🇽🇰 Elyon CRM — New-Country Launch Kit (Kosovo)

This folder is a **complete, from-zero recipe** for standing up a **second, fully
independent Elyon CRM** for a new market — written for Kosovo, but the steps work for any
country. It tells you exactly which servers and services to buy, what to configure, in what
order, and which values change per market.

> This kit is **documentation only**. Reading or following it does **not** change anything.
> The actual build (new repo, new Supabase, new Vercel) happens later as its own effort.

---

## 🛑 The golden rule

> **Never touch the live Bulgarian system.**
> The live CRM (Supabase project `sxymaloycddnoxudxaqp`, domain `elyoncall.com`,
> Sofia PBX) is the company's working software. Nothing in this kit edits it.
> **No script in this kit may ever point at `sxymaloycddnoxudxaqp`.** Every command runs
> against the *new* Kosovo project, using the *new* project's own `.env`.

If you ever see `sxymaloycddnoxudxaqp` in a command you are about to run for Kosovo — **stop**.
That is the live database.

---

## The model: a hard fork

We are **not** making the live app multi-country. We are taking a clean **copy** of the code
into a brand-new repo and pointing it at brand-new infrastructure. The two systems share
nothing at runtime.

```
   elyoncrm/                          elyon-kosovo/   (NEW — created later)
   (LIVE — Bulgaria, untouched)       (independent copy)
   ├── Supabase sxymaloycddnoxudxaqp  ├── Supabase  <new ref>
   ├── Vercel  elyoncall.com          ├── Vercel    <new domain>
   ├── Sofia PBX (A1 trunk)           ├── (telephony added later — Phase 2)
   └── BG customers/orders            └── fresh: new Kosovo clients, empty data
```

**Trade-off you accepted:** the two repos drift apart over time. A new feature built in
Bulgaria must be copied into Kosovo by hand (and vice-versa). That is the price of zero risk
to production.

---

## What carries over vs what's fresh

| Carries over (copied) | Fresh / Kosovo-local (built new) |
|---|---|
| All application code (the fork) | All customer & order data — **new clients** |
| Database **schema** (all migrations) | Couriers + city/settlement data (Kosovo) |
| Product catalog (import) | OpenCart store bridge (only if a KS store exists) |
| Call scripts (trilingual, Albanian ready) | Telephony — trunk, numbers, PBX (Phase 2) |
| Business rules (the 13 skills) | All secrets/tokens (new, isolated) |

---

## The path (read the files in order)

| # | File | What it covers |
|---|---|---|
| 1 | [01-WHAT-YOU-NEED.md](01-WHAT-YOU-NEED.md) | Every server, service, account + a cost sheet |
| 2 | [02-FORK-THE-CODE.md](02-FORK-THE-CODE.md) | Make the standalone `elyon-kosovo` repo |
| 3 | [03-SUPABASE-FROM-ZERO.md](03-SUPABASE-FROM-ZERO.md) | New database: migrations, cron, secrets, deploy the API |
| 4 | [04-SEED-AND-BOOTSTRAP.md](04-SEED-AND-BOOTSTRAP.md) | Admins, products, scripts, webhooks, couriers |
| 5 | [05-FRONTEND-DEPLOY.md](05-FRONTEND-DEPLOY.md) | New Vercel project + domain + CORS |
| 6 | [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md) | **The master Bulgaria→Kosovo diff** (every value to change) |
| 7 | [07-TELEPHONY-LATER.md](07-TELEPHONY-LATER.md) | Phase 2: add calls (trunk, numbers, PBX) |
| 8 | [08-SECRETS-TEMPLATE.md](08-SECRETS-TEMPLATE.md) | Blank vault — every secret a deployment needs |
| 9 | [09-GO-LIVE-CHECKLIST.md](09-GO-LIVE-CHECKLIST.md) | One ordered checklist + smoke tests |
| 10 | [10-CLIENT-HANDOVER.md](10-CLIENT-HANDOVER.md) | What to give and train the Kosovo team |
| 11 | [11-COVERAGE-MAP.md](11-COVERAGE-MAP.md) | Proof that **every** feature, migration, screen & warehouse flow is captured |

**Two-phase plan:** Phase 1 = a working CRM (orders, webhooks, agents, segments, insights)
with **manual call logging, no dialer**. Phase 2 = add real telephony. You get a usable
system at the end of Phase 1.

---

## Background reading (the existing, authoritative docs)

This kit is the *launch recipe*. For how the system actually works, lean on the docs that are
already in the repo (single source of truth — do not duplicate them):

- System overview → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- Database schema → [../docs/DATABASE.md](../docs/DATABASE.md)
- API routes → [../docs/BACKEND_API.md](../docs/BACKEND_API.md)
- Security & RLS → [../docs/SECURITY.md](../docs/SECURITY.md)
- Roles & permissions → [../docs/USERS_ROLES_PERMISSIONS.md](../docs/USERS_ROLES_PERMISSIONS.md)
- Deploy & routine ops → [../docs/OPERATIONS_RUNBOOK.md](../docs/OPERATIONS_RUNBOOK.md)
- Business rules (the law) → [../.grok/skills/](../.grok/skills/) (13 skills)

---

## Kosovo at a glance (why a few things differ from Bulgaria)

- **Currency:** Kosovo uses the **euro** natively → no lev, no 1.95583 peg, no dual display.
- **Timezone:** Pristina is **CET (UTC+1)** = `Europe/Belgrade`; Sofia is EET (UTC+2). The
  1-hour gap matters for any "midnight" day-boundary logic (daily bonus, leaderboard).
- **Phone code:** Kosovo is **+383** (Bulgaria is +359).
- **Language:** Albanian (`sq`) is already 100% translated and shippable as the default.
- **Couriers & cities:** Bulgarian Speedy/Econt + settlements do **not** apply — Kosovo needs
  local providers and its own city list.

All of these are spelled out file-by-file in [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md).
