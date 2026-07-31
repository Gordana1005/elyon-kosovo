---
name: elyon-notifications
description: Use when adding, changing, or debugging ANY in-app notification in Elyon CRM — the bell dropdown, a DB trigger or pg_cron job that writes to `notifications`, notification text/translation, or the unpaid-delivery chase alerts. Covers the six live types, the English-in-DB + `meta.i18n` translation contract, the owner-attribution rule, and the "REVOKE FROM PUBLIC on every new table/RPC" law that any new notification job must follow.
---

# Elyon Notifications — the bell, and everything that writes to it

One table (`public.notifications`), one UI ([src/components/NotificationsDropdown.tsx](../../../src/components/NotificationsDropdown.tsx)),
and a handful of DB-side producers. Nothing in the frontend "sends" a notification in
production — the database does, so a notification can never be missed because a browser tab
was closed.

## The table

`id, user_id, title, message, type, is_read, link, created_at, meta`

- **RLS**: each user reads/updates only their own rows; admins and managers can manage all.
- **INSERT is already tight** — `WITH CHECK (user_id = auth.uid() OR has_role(…,'admin') OR
  has_role(…,'manager'))`. An agent hitting PostgREST directly with their own JWT can only
  write a notification **to themselves**; forging one into someone else's bell is refused.
  Admins/managers may target anyone (that is what the SettingsPage DEV test panel uses).
  ⚠️ The original `20260312051251` migration created this policy as `WITH CHECK (true)`, and
  `20260312051301` dropped and replaced it **ten seconds later**. Reading only the CREATE TABLE
  migration will tell you this table is wide open. It is not — **check `pg_policies`, not the
  migration file**, before claiming any RLS hole here.
- The bell polls every 30 s **and** subscribes to realtime INSERTs (which pop a toast).

## The six live types

| type | Producer | Goes to |
|---|---|---|
| `missed_call` | trigger on `missed_calls` (20260604130000) | last agent who called that number + all admins |
| `order_returned` | trigger on `orders` status → `returned` | sale owner + all admins |
| `order_paid` | trigger on `orders` status → `paid` (20260604140000) | sale owner + all admins |
| `low_stock` | trigger on `products.stock_quantity` **downward crossing** | admins + warehouse |
| `shipped_unpaid` | `notify_unpaid_shipped_orders()` job (20260905000100) | sale owner only |
| `unpaid_digest` | same job, once after the loop | one per admin per day |

Adding a type means touching **five** places in `NotificationsDropdown.tsx`: `typeIcons`,
`typeColors`, `getUnreadMoodClass`, `getUnreadTitleClass`, `toastSeverity`. Miss one and the row
renders with the grey default instead of its mood colour.

## Rule 1 — the owner of a sale is the CONFIRMER

`COALESCE(confirmed_by_agent_id, assigned_agent_id)` — the SQL twin of `salesOwnerId()` in the
edge function. Same rule as commissions and the My Orders tabs. Never notify both the assignee
and the confirmer; never notify the assignee when a confirmer exists. See
[elyon-agent-commissions](../elyon-agent-commissions/SKILL.md).

## Rule 2 — write English, ship `meta` for translation

The DB cannot know which of EN/BG/SQ the reader picked, so producers write **English**
`title`/`message` **and** an optional:

```json
meta = { "i18n": "notif.shippedUnpaid", "order": "ORD-37262", "customer": "…", "days": 4 }
```

`localizeNotification()` renders `t(meta.i18n + '.title' | '.body', { defaultValue: <stored English>, ...meta })`.
So a missing locale key degrades to readable English — never a `⟪key⟫` placeholder. `meta IS NULL`
= legacy row, rendered verbatim. Add every new key to **all three** locale files (`npm test`
enforces parity). Interpolated values are DB data (order id, customer name, counts) and are
never translated — see [elyon-i18n](../elyon-i18n/SKILL.md).

⚠️ Inside `renderNotificationToast` and the custom toast components, `t` is the **sonner toast
instance**, not the translator. Use `i18n.t` there. This has bitten us before.

## Rule 3 — triggers swallow, jobs don't

The four **trigger** producers are `SECURITY DEFINER` + `EXCEPTION WHEN OTHERS THEN RETURN NEW`.
That is deliberate: a failed notification must never roll back the business write it hangs off
(missed-call ingestion, a status change, a stock decrement). Worst case is "no notification".

A **pg_cron job** is the opposite: it writes nothing business-critical, so a blanket swallow
would just hide bugs behind a green run. Wrap each *item* in its own `BEGIN … EXCEPTION …
CONTINUE` so one bad row can't kill the batch, but let a real failure surface in
`cron.job_run_details`.

## Rule 4 — every new table/RPC starts locked

Learned the hard way in the 2026-07-22 sweep. In the **same migration**:

```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;      -- zero policies = deny all
REVOKE ALL ON public.<t> FROM PUBLIC;                   -- PUBLIC, not just anon —
REVOKE ALL ON public.<t> FROM anon, authenticated;      -- `authenticated` inherits PUBLIC
REVOKE ALL ON FUNCTION public.<f>(…) FROM PUBLIC, anon, authenticated;  -- default is EXECUTE TO PUBLIC
```

Verify with a live anon call, not just by reading the migration.

## The unpaid-delivery chase (2026-09-05)

**Why**: most returns are avoidable — the parcel ships, the client never collects it, nobody
calls, the courier sends it back and we pay shipping both ways. When it was built there were 38
orders in `shipped`, **20 of them unpaid for 3+ days**, oldest 27 days.

**How**: `notify_unpaid_shipped_orders(_force, _dry_run)`, hourly cron self-gated to 09:00–11:00
Europe/Sofia (a missed 09:00 heals at 10:00; the ledger PK stops double-sends).

- **Candidates**: `status IN ('shipped','delivered')`, `shipped_at IS NOT NULL`,
  `duplicated_from IS NULL`, `source_type <> 'monadon_legacy'`, age in `[unpaid_chase_days,
  unpaid_chase_stop_days]` (defaults 3 / 30, both in `app_settings`, editable in Settings).
- **Idempotency** is the `order_unpaid_alerts (order_id, alert_date)` primary key — that alone.
  Run the job five times in a morning and each order still pings once.
- **Never writes to `orders`.** All state is in the ledger, so it can't disturb the
  status/`shipped_at`/`paid_at`/history triggers or bump `updated_at` on every row each morning.
- **Digest counts the full problem** (every order unpaid ≥ threshold, no upper bound), not just
  what pinged today — otherwise orders aged past the stop threshold would silently vanish from
  oversight, which is the exact blind spot the feature exists to remove.
- **`syncAgeHours`** in the digest = hours since the last `order.bigarena_status_sync` audit
  entry. The numbers are only as fresh as that **manual** daily upload. Report staleness; do
  **not** mute alerts on it — muting hides real returns.

`unpaid_chase_stop_days` is the only place alerts go quiet. Raise it to 999 to chase forever.

## Debugging checklist

1. Nothing arrived → is the row in `notifications` at all? If yes it's a UI/type-map problem; if
   no it's the producer.
2. Wrong agent → check `confirmed_by_agent_id` vs `assigned_agent_id` on that order.
3. English text in a Bulgarian UI → `meta` is NULL, or the locale key is missing in `bg.json`.
4. Job "succeeded" but sent nothing → the Sofia hour gate, or every order already had today's
   ledger row. `SELECT notify_unpaid_shipped_orders(true, true);` tells you what it *would* send.
5. Duplicate pings → someone dropped the ledger PK, or a producer runs both a trigger and a job.
