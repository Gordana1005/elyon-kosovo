# Elyon Bot — How to use it & who can do what

A plain-language guide for running the Discord bot day to day. For the click-by-click first-time
setup see [CHECKLIST.md](CHECKLIST.md); for the technical design see [PLAN.md](PLAN.md).

> **Tip:** anyone can type **`/help`** in Discord at any time. It privately shows that person exactly
> the commands their role is allowed to use — so the team never has to memorise this file.

---

## 1. The roles (who can do what)

There are four roles. A person's access = the role(s) you give them in Discord.

| Role | Who you put here | What they can do |
|---|---|---|
| **@Agent** | Call-center agents | Look up **their own** orders, see their own day/stats/commission, their callbacks, their work time. They cannot see other agents' data or customer data that isn't theirs. |
| **@Team Lead** | Supervisors | Everything an agent sees **plus** reports on any agent, leaderboards, pending/callback lists, COD, returns/cancellations, work time, calls, top products. Customer names/phones are **masked** for them. |
| **@Superadmin** | You | **Everything** — any order, full customer details, customer history, payroll/commission, the daily pulse, and linking agents. |
| **@Warehouse** | Fulfilment staff | The shipment hand-off list only. |

Nobody can reach a command above their role — the bot refuses it. So an agent can never run an admin
report, by design.

---

## 2. What YOU need to set up (one time)

1. **Give yourself the @Superadmin role.** Right-click your name → **Roles** → tick **Superadmin**.
   (Even as server owner, the bot grants access by role — without it, it will refuse your commands.)
2. **Put each teammate in a role:** drag them into **@Agent**, **@Team Lead**, or **@Warehouse**.
3. **Link each agent to their CRM account** so "their own orders" works:
   ```
   /linkagent user:@TheirDiscord email:their-crm-login@email
   ```
   Use the same email they log into the CRM with. To undo: `/unlinkagent user:@Them`.

That's it. New hire later? Give them the role + run `/linkagent` once.

---

## 3. How the team uses it (everyday)

**Agents** (in **#agent-lookup** — replies are private to them):
- `/order 31843` — full status of one of *their* orders (paid? shipped? COD collected? courier? dates?).
- `/myday` — how they're doing today (orders, confirmed, paid, revenue, commission).
- `/mypending` — their orders still to work. `/mycallbacks` — call-backs due now.
- `/myshift` — their logged-in time, talk time, breaks today. `/mycommission` — what they've earned.

**You / Team Leads** (in **#team-reports** / **#admin-reports**):
- `/reportdaily agent:Tina` — full daily breakdown for any agent (add `date:2026-06-18` for a past day).
- `/leaderboard metric:revenue` — rank agents (revenue / paid / confirmed / commission).
- `/pending`, `/callbacksdue` — team-wide work queues (add `agent:` to filter).
- `/codoutstanding` — shipped orders where COD isn't collected yet ("cash in the field").
- `/returns from:2026-06-01 to:2026-06-18` and `/cancellations …` — grouped by reason.
- `/worktime agent:all` — who worked how long today. `/calls agent:Tina` — their call outcomes.
- `/reportrange from: to: [agent:]` — any range, one agent or the whole team.
- `/topproducts from: to:` — best sellers.

**You only:**
- `/customer phone:+359…` — a customer's full order history (private channel only — it shows personal data).
- `/health` — today's pulse for the whole business.

**Warehouse** (in **#warehouse-handoff**):
- `/pendingshipment` — confirmed orders waiting to be shipped (downloads as CSV when long).

> Order numbers are `ORD-#####`; just type the digits (e.g. `/order 31843`). Your live orders are in
> the `ORD-22612`…`ORD-32144` range right now — numbers outside that don't exist yet.

---

## 4. Where to run things (channels)

The bot made a **📊 ELYON CRM** category with these channels, each visible only to the right roles:

- **#agent-lookup** — agents' day-to-day (private replies)
- **#team-reports** — leaderboards & team reports
- **#admin-reports** — returns, cancellations, ranges (admin)
- **🔒 #customer-lookup** — `/customer` (personal data; admin only)
- **#cod-and-payroll** — COD & commission
- **🏭 #warehouse-handoff** — shipment list
- **#bot-audit** — the bot logs *who ran what* here (for accountability)

---

## 5. Privacy (important)

- Personal commands reply **privately** (only the person who typed them sees the result).
- Team leads see customer name/phone **masked**; only you (Superadmin) see full customer details.
- `/customer` is admin-only and should stay in the private channel.
- Every command is logged in **#bot-audit**, so access to customer data is traceable.
- The bot is **read-only** — it can never change or delete anything in the CRM.

---

## 6. Keeping it online

The bot runs 24/7 on the **Sofia VPS** as a systemd service (`elyon-bot`), under its own user with its
own Node — capped at 256 MB / 50% CPU so it can't disturb the phone system. It **auto-starts on reboot**
and **auto-restarts if it crashes**.

Manage it over SSH (`ssh -i ~/.ssh/elyon_vps root@104.152.48.222`):

```bash
systemctl status elyon-bot           # is it running?
journalctl -u elyon-bot -n 50        # recent logs (-f to follow live)
systemctl restart elyon-bot          # restart (e.g. after a code update)
systemctl stop elyon-bot             # stop it
```

To deploy a new version: rebuild locally (`npm run build`), copy `dist/` to
`/opt/elyon-discord-bot/dist` on the VPS, then `systemctl restart elyon-bot`.

If the bot shows **offline** in Discord, run `systemctl status elyon-bot` to see why.

---

## 7. Troubleshooting

| You see… | Meaning / fix |
|---|---|
| "You don't have permission…" | You don't have a role for that command. (Give yourself/them the right role.) |
| "…isn't linked to a CRM agent" | Run `/linkagent user:@them email:…` for that person. |
| "No order found for ORD-#####" | That number doesn't exist — check it's in the live range. |
| An agent sees "isn't assigned to you" | Correct — agents only see their own orders. Use a Team Lead/Admin account for any order. |
| Bot is **offline** in the member list | The bot process isn't running — restart it (or deploy to the VPS). |
| Commands don't appear when typing `/` | Re-run `npm run deploy-commands`, and make sure you can see the channel. |
