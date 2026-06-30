# Discord server structure

`npm run setup-server` builds all of this for you (idempotently — it only creates what's missing on
your existing server). This document is the reference + a manual fallback.

## Roles (created by setup)

| Role | Who | Can run |
|---|---|---|
| **@Superadmin** | You | Everything, all channels, full PII + financials |
| **@Team Lead** | Supervisors | Cross-agent reports; customer PII **masked** |
| **@Agent** | Call-center agents | Self-service only, scoped to their own orders |
| **@Warehouse** | Fulfilment | Shipment hand-off only |

The roles are created with **no special Discord permissions** — they're pure markers. All gating is
done by the bot (in code, by role ID) plus channel visibility.

## Category 📊 ELYON CRM and channels

| Channel | Who can see it | For | Reply style |
|---|---|---|---|
| `#agent-lookup` | Agent, Lead, Admin | `/order` `/myday` `/mycallbacks` `/myshift` `/mypending` | ephemeral (private to caller) |
| `#team-reports` | Lead, Admin | `/leaderboard` `/reportdaily` `/pending` `/callbacksdue` | public in-channel |
| `#admin-reports` | Admin | `/returns` `/cancellations` `/reportrange` `/topproducts` | public in-channel |
| `🔒 #customer-lookup` | Admin | `/customer` (PII) | ephemeral |
| `#cod-and-payroll` | Admin (+Lead) | `/codoutstanding` `/mycommission` | public in-channel |
| `🏭 #warehouse-handoff` | Warehouse, Admin | `/pendingshipment` | CSV attachments |
| `#bot-audit` | Admin | Bot writes one line per command (who/what/when) | bot only |

Each channel hides `@everyone` (deny View Channel) and allows only the listed roles + the bot.

## How an Agent can NEVER reach an Admin command

Three independent layers, all default-deny:

1. **In code (authoritative).** Every command declares `allowedTiers`. The router reads the caller's
   Discord roles, maps them to tiers, and refuses to execute unless a tier matches. No match → a
   polite "no permission" reply and the handler never runs. This is the real guarantee.
2. **Channel visibility.** Admin/warehouse channels are hidden from agents, so they can't even type
   those commands in context.
3. **Data scoping.** Agent commands inject `owner = me` into the SQL, and an unlinked agent is
   blocked. So even `/order` only returns the agent's own orders.

If someone is given two roles, the **higher** tier wins, and Superadmin can always run everything.

## GDPR / privacy

- Personal & PII replies are **ephemeral** — visible only to the person who ran the command.
- `/customer` (full customer history) is **admin-only** and lives in the private `#customer-lookup`.
- Team leads see **masked** customer name (`Ivan P.`), phone (`•••••456`) and address (`••• hidden`).
- Every command (allowed or denied) is logged to `#bot-audit`, so customer-data access is auditable.
- No customer data is ever posted where `@everyone` can read it.

## Manual fallback (if you prefer not to run setup-server)

1. **Server Settings → Roles → Create Role** for each of the four roles above (no permissions needed).
2. **Create a Category** "📊 ELYON CRM".
3. For each channel in the table: create a text channel under the category, then **Edit Channel →
   Permissions**: set `@everyone` → View Channel = ❌; add each allowed role → View Channel ✅,
   Send Messages ✅, Use Application Commands ✅; add the **Elyon Bot** → View ✅, Send ✅, Embed Links
   ✅, Attach Files ✅.
4. Right-click each role and channel → **Copy ID**, and put them in `.env` (see CHECKLIST.md).
5. Run `npm run deploy-commands`.

## Optional: hide admin commands from the slash menu

The in-code gate already blocks misuse, but to also hide admin commands from agents' autocomplete:
**Server Settings → Integrations → Elyon Bot → Manage**, and restrict commands like `/customer`,
`/health`, `/returns`, `/reportdaily` to the Team Lead/Superadmin roles or specific channels.
