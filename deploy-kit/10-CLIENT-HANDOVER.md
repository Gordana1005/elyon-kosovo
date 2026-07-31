# 10 — Client handover (Macedonia team)

What to hand over and train once the Macedonia CRM is live. The software is the same as Bulgaria,
so the existing operator docs apply directly.

---

## Accounts & access to give

| Recipient | What they get |
|---|---|
| Macedonia manager/owner | Admin login; the filled vault ([08](08-SECRETS-TEMPLATE.md)) stored in *their* password manager; Supabase + Vercel access if they self-host |
| Each agent | Their own login (created in-app by an admin) and the correct role |
| Landing-page / store dev | The relevant webhook URL(s) + the `WEBHOOK_SECRET` (over a secure channel) |

> Create agents inside the app (admins create users; **public sign-up stays disabled**). Set
> each person's role deliberately — see roles below.

## Roles to set up — [../docs/USERS_ROLES_PERMISSIONS.md](../docs/USERS_ROLES_PERMISSIONS.md)

Same role model as Bulgaria: `admin`, `manager`, `agent`, `prediction_agent`, `warehouse`,
`ads_admin`, `inbound_agent`, `pending_agent`. Permissions, financial visibility, and data
masking are all configurable in **Settings** (seeded with sensible defaults by the migrations).

## Training material

- **Onboarding/training:** the [`../obuka/`](../obuka/) folder (agent training material) +
  [`../scripts/build-obuka-pdf.mjs`](../scripts/build-obuka-pdf.mjs) to produce a PDF.
- **Call scripts:** managed in-app (Settings → Call Scripts); Albanian wording should be
  reviewed by the Macedonia team. See [../docs/CALL_SCRIPTS.md](../docs/CALL_SCRIPTS.md).
- **How the moving parts work** (for the manager): the existing docs are the manual —
  [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md),
  [../docs/ORDERS_AND_CLIENTS.md](../docs/ORDERS_AND_CLIENTS.md),
  [../docs/PRODUCTS_STOCK_WAREHOUSE.md](../docs/PRODUCTS_STOCK_WAREHOUSE.md),
  [../docs/INSIGHTS_ANALYTICS.md](../docs/INSIGHTS_ANALYTICS.md).

## Day-to-day operations the Macedonia admin should know

- **Add/disable users**, set roles & permissions → Settings.
- **Products & stock**: catalog edits, restock; stock only moves on shipped/returned.
- **Warehouse / fulfilment**: daily incoming list + CSV hand-off to the courier
  ([../.grok/skills/elyon-fulfilment-csv/SKILL.md](../.grok/skills/elyon-fulfilment-csv/SKILL.md)).
- **Webhooks/ads**: enable/disable per-product webhooks, watch lead counts.
- **Insights**: revenue, agent performance, segments, pure profit (enter cost prices to make
  margins meaningful).
- **Routine ops & redeploys**: [../docs/OPERATIONS_RUNBOOK.md](../docs/OPERATIONS_RUNBOOK.md).

## Ongoing responsibilities

- **Secrets hygiene**: keep the vault current; rotate on any suspected leak ([08](08-SECRETS-TEMPLATE.md) §9).
- **Backups**: enable Supabase backups / PITR (Pro plan) for the production data.
- **Updates**: because this is a hard fork, decide a cadence for porting useful Bulgarian
  features across (and vice-versa). There is no automatic sync.
- **Couriers/cities**: expand the Macedonia courier offices + settlement list over time.

---

## Definition of "done" for the handover
- [ ] Manager can log in as admin and create/disable an agent
- [ ] Agent can log in, see assigned work, log a call outcome, create/confirm an order
- [ ] Warehouse can produce the fulfilment CSV
- [ ] Webhook leads arrive from at least one live landing page
- [ ] Vault is filled and stored securely by the Macedonia owner
- [ ] (Phase 2) Agents can place and receive calls with recordings

That's the whole system. Welcome to Macedonia. 🇽🇰
