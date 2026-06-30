# 03 — Supabase from zero (the new database + backend)

This builds the Kosovo database with the **exact same schema** as Bulgaria, the same backend
API, the same security rules — but **empty of all customer data**. The schema and config seeds
ride along in the migrations; the live company's orders/customers/calls do **not**.

> 🛑 Every command below targets the **new** project ref. The live ref `sxymaloycddnoxudxaqp`
> must never appear in any command you run for Kosovo.

Background: [../docs/DATABASE.md](../docs/DATABASE.md) (schema) and
[../docs/OPERATIONS_RUNBOOK.md](../docs/OPERATIONS_RUNBOOK.md) (deploy mechanics).

---

## Step 1 — create the new Supabase project

1. supabase.com → **New project**. Name it e.g. `elyon-kosovo`.
2. Pick a **region** close to Kosovo (EU — e.g. Frankfurt).
3. Set a strong **database password** → save it in your vault ([08](08-SECRETS-TEMPLATE.md)).
4. From **Settings → API**, copy: **Project ref**, **Project URL**, **anon key**,
   **service_role key**. From **Account → Access Tokens**, create a **CLI access token**.
   Put all of these in the new vault — **never** in git.

## Step 2 — point the fork at the new project

Edit `supabase/config.toml` in the fork — replace the live ref with the new one:

```toml
project_id = "<NEW_KOSOVO_REF>"     # was sxymaloycddnoxudxaqp — DO NOT keep that

[functions.api]
verify_jwt = false                  # keep — the API does its own auth internally
```

Create the fork's local `.env` (gitignored) from the template:

```bash
cp .env.example .env
# then fill with the NEW project's values:
#   VITE_SUPABASE_PROJECT_ID=<NEW_KOSOVO_REF>
#   VITE_SUPABASE_URL=https://<NEW_KOSOVO_REF>.supabase.co
#   VITE_SUPABASE_PUBLISHABLE_KEY=<new anon key>
#   SUPABASE_SERVICE_ROLE_KEY=<new service_role key>
#   SUPABASE_ACCESS_TOKEN=<new CLI token>
```

## Step 3 — link and apply ALL migrations

The whole schema is reproducible from `supabase/migrations/` (~130 timestamped SQL files,
applied in order). This also **seeds the reference/config data** automatically:

- 27 prediction segment lists
- role permissions, financial visibility, role privacy, module settings
- app settings (e.g. personal-list cap = 50)
- segment engine config (v3.4, the battle-tested engine)
- the default call-script template

```bash
export SUPABASE_ACCESS_TOKEN=<new CLI token>
npx supabase link --project-ref <NEW_KOSOVO_REF>      # uses the DB password
npx supabase db push                                  # applies every migration in order
```

✅ Expect every migration to succeed. This produces a complete, empty, production-shaped DB —
schema, enums, RLS, triggers, RPC functions, the nightly pg_cron job, and all config seeds.
(For a full domain-by-domain proof that nothing is missing, see
[11-COVERAGE-MAP.md](11-COVERAGE-MAP.md), incl. an optional read-only parity check against live.)

> **Schema vs data — the line that protects you:** migrations create *structure + config
> seeds only*. They contain **no** Bulgarian `orders`, `customers`, `call_logs`,
> `prediction_segment_members`, `audit_log`, etc. Those tables start empty and fill up as
> Kosovo does real business. **Do not** import a Bulgarian DB dump.

## Step 4 — extensions & nightly cron

The segment engine recomputes nightly via `pg_cron`. The migrations set this up, but confirm:

1. **Database → Extensions** → ensure `pg_cron` (and `pg_net` if used) is enabled.
2. Confirm the nightly recompute job exists:
   ```sql
   select jobname, schedule, command from cron.job;
   ```
   You should see the segment-recompute job. (Note the schedule is in **UTC** — the
   day-boundary *display* logic is changed to Kosovo time separately in
   [06](06-PER-MARKET-CHANGES.md).)

## Step 5 — set Edge Function secrets

In **Settings → Edge Functions → Secrets**, set (new values, not Bulgaria's):

| Secret | Value | Notes |
|---|---|---|
| `WEBHOOK_SECRET` | a **new** random string | HMAC key for inbound webhooks; share only with Kosovo senders |
| `SUPABASE_URL` | the new project URL | usually auto-provided by the runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | new service_role | usually auto-provided |
| `SUPABASE_ANON_KEY` | new anon | needed by the function's RLS-bound client |
| `REC_SHARED_SECRET` | *(leave until Phase 2)* | PBX recording auth |

```bash
npx supabase secrets set WEBHOOK_SECRET=<new-random> --project-ref <NEW_KOSOVO_REF>
```

## Step 6 — deploy the backend API

```bash
npx supabase functions deploy api --project-ref <NEW_KOSOVO_REF>
```

The whole backend is the single Edge Function `supabase/functions/api/` (~130 routes). Its URL
becomes `https://<NEW_KOSOVO_REF>.supabase.co/functions/v1/api/`.

> One code edit is needed before/after this: the **CORS allowlist** inside
> `supabase/functions/api/index.ts` must include the new Kosovo domain (not `elyoncall.com`).
> That's listed in [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md) and applied in
> [05](05-FRONTEND-DEPLOY.md).

## Step 7 — lock down Auth

- **Authentication → Providers → Email:** keep email/password, **disable public sign-ups**
  (users are created by admins inside the app, same as Bulgaria).
- Decide email confirmation policy (the founding-admin script bypasses it — see [04](04-SEED-AND-BOOTSTRAP.md)).

---

✅ At this point you have an empty, secure, production-shaped Kosovo database with the backend
deployed. Next you put the first users and catalog into it.

➡ Next: [04-SEED-AND-BOOTSTRAP.md](04-SEED-AND-BOOTSTRAP.md)
