# Command reference

Tiers: **Agent+** = the caller's own data (works for Agent/Lead/Admin). **Lead/Admin** = Team Lead or
Superadmin. **Admin** = Superadmin only. **Warehouse/Admin** = Warehouse or Superadmin.
Dates are `YYYY-MM-DD` in **Europe/Sofia**. Money is shown dual EUR/лв (peg 1.95583).

## Agent self-service

| Command | Params | Shows |
|---|---|---|
| `/order` | `number` (required) | Full status of one order: lifecycle flags (paid/shipped/confirmed/pending/cancelled/returned), COD state, total, courier+office, items, key dates, owning agent, cancel/return reason. **Agents: own orders only.** |
| `/myday` | `date?` | Your KPIs for the day: leads, confirmed (%), shipped, paid (collection %), returned, cancelled, revenue, outstanding COD, packages, commission. |
| `/mystats` | `from`, `to` | Same KPIs over a range. |
| `/mypending` | — | Your open orders (pending/taken/call-again). |
| `/mycallbacks` | — | Your call-again orders due now. |
| `/myshift` | `date?` | Your work time: scheduled window, logged-in time, talk time, calls, breaks. |
| `/mycommission` | `from?`, `to?` | Your commission (paid orders, €1/€2/€3 per package by unit price). |
| `/help` | — | The commands you're allowed to use — role-aware, private reply. Anyone can run it. |
| `/whoami` | — | Your access tier and CRM link. |

## Team Lead / Admin

| Command | Params | Shows |
|---|---|---|
| `/reportdaily` | `agent`, `date?` | Daily KPI breakdown for any agent (commission shown to Admin only). |
| `/reportrange` | `from`, `to`, `agent?` | Range KPIs for one agent, or the whole team if omitted. |
| `/leaderboard` | `metric?`, `from?`, `to?` | Agents ranked by paid revenue / paid orders / confirmed / commission. |
| `/pending` | `agent?` | Open orders team-wide or for one agent. |
| `/callbacksdue` | `agent?` | Callbacks due team-wide or for one agent. |
| `/codoutstanding` | `agent?` | Shipped-but-unpaid COD ("cash in the field") + total. CSV if long. |
| `/returns` | `from`, `to`, `agent?` | Returns grouped by reason (by returned date) + totals. |
| `/cancellations` | `from`, `to`, `agent?` | Cancellations grouped by reason (by cancelled date) + totals. |
| `/worktime` | `agent\|all`, `date?` | Work time for one agent, or a team summary for `all`. |
| `/calls` | `agent`, `date?` | Call outcomes + talk time for an agent on a day. |
| `/topproducts` | `from`, `to` | Best-selling products by units & revenue (paid orders). |

Team leads see **masked** customer PII in any list; Superadmin sees full.

## Admin / Warehouse

| Command | Params | Shows |
|---|---|---|
| `/customer` | `phone` | All orders for a phone (last-8 match) + paid/returned counts + lifetime value. **PII, ephemeral, admin only.** |
| `/pendingshipment` | — | Confirmed orders awaiting shipment (warehouse hand-off). CSV if long. |
| `/health` | — | Today's pulse: orders, confirmed, paid, shipped (COD out), cancelled, returned, paid revenue, outstanding COD, pending pool. |
| `/linkagent` | `user`, `email` | Link a Discord user to a CRM agent (enables "own orders"). |
| `/unlinkagent` | `user` | Remove a link. |

## Definitions (mirrors the CRM)

- **Owner of an order** = `confirmed_by_agent_id`, falling back to `assigned_agent_id` (first-confirmer).
- **Confirmed** = status in {confirmed, shipped, delivered, returned, paid}.
- **Shipped** = status in {shipped, delivered, returned, paid}; **Outstanding COD** = status = shipped.
- **Paid** = status = paid (COD collected). **Collection %** = paid ÷ shipped.
- **Commission** = per paid package: unit `<€25`→€1, `>€25 & <€35`→€2, `≥€35`→€3 (credited to the confirmer).
- A "day" is bucketed by `created_at` in Europe/Sofia (returns/cancellations use `returned_at`/`cancelled_at`).
