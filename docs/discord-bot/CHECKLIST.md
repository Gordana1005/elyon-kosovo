# Setup checklist — what YOU need to provide

Follow top to bottom. Anything in `CAPS` is a value you copy into `discord-bot/.env`.
Nothing here modifies the CRM; the bot only ever reads.

---

## 1) Create the Discord application + bot

1. Go to <https://discord.com/developers/applications> → **New Application** (name it "Elyon Bot").
2. **General Information** → copy **Application ID** → `DISCORD_CLIENT_ID`.
3. **Bot** tab → **Reset Token** → copy it → `DISCORD_TOKEN`. (Keep it secret.)
4. Privileged intents: **leave all OFF** — the bot doesn't need any (slash commands carry the
   caller's roles). Under "Bot", you may turn **off** "Public Bot" so only you can invite it.

## 2) Invite the bot to your server

Use this URL (replace `YOUR_CLIENT_ID`). The permission number includes the **setup-time** extras
(Manage Roles + Manage Channels) so the bot can build the channels once:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2416036880&scope=bot%20applications.commands
```

- Scopes: **bot** + **applications.commands** (already in the URL).
- After setup you can remove "Manage Roles" + "Manage Channels" from the bot's role; runtime only
  needs View Channels, Send Messages, Embed Links, Attach Files, Use Application Commands, Read
  Message History (permission number `2147601408`).
- Turn on **Developer Mode** (User Settings → Advanced), then right-click your **server → Copy
  Server ID** → `DISCORD_GUILD_ID`.

## 3) Create the read-only database role (Supabase)

Open **Supabase → SQL Editor** and run (set a strong password):

```sql
CREATE ROLE discord_bot_ro LOGIN PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
ALTER ROLE discord_bot_ro BYPASSRLS;            -- needed: otherwise RLS returns 0 rows on a direct login
ALTER ROLE discord_bot_ro SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE postgres TO discord_bot_ro;
GRANT USAGE ON SCHEMA public TO discord_bot_ro;
GRANT SELECT ON
  public.orders, public.order_items, public.order_history,
  public.profiles, public.user_roles, public.call_logs, public.missed_calls,
  public.shifts, public.shift_assignments, public.shift_login_logs, public.shift_breaks,
  public.courier_offices, public.products, public.customer_profiles
  TO discord_bot_ro;
```

`SELECT`-only means the role **cannot** write even though it bypasses RLS.

Then get the connection string: **Supabase → Project Settings → Database → Connection string →
"Session pooler"**. It looks like:

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres
```

Edit it: replace the user `postgres` with `discord_bot_ro` (keep the `.<PROJECT_REF>` suffix), set
the password you chose above, and append `?sslmode=require`. Put the result in `DATABASE_URL`:

```
DATABASE_URL=postgresql://discord_bot_ro.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?sslmode=require
```

## 4) Fill in `.env`

```bash
cd discord-bot
cp .env.example .env
```

Set at least: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DATABASE_URL`.
(The role IDs and `DISCORD_AUDIT_CHANNEL_ID` are filled in by step 6.)

## 5) Install & build

```bash
npm install
npm run build
```

## 6) Let the bot build the server structure, then register commands

```bash
npm run setup-server      # creates any MISSING roles/channels, prints the IDs
```

Copy the printed lines into `.env`:
```
DISCORD_SUPERADMIN_ROLE_ID=…
DISCORD_TEAMLEAD_ROLE_ID=…
DISCORD_AGENT_ROLE_ID=…
DISCORD_WAREHOUSE_ROLE_ID=…
DISCORD_AUDIT_CHANNEL_ID=…
```

Then register the slash commands (instant, guild-scoped):
```bash
npm run deploy-commands
```

## 7) Assign people & link agents

- Drag each teammate into **@Agent / @Team Lead / @Warehouse**. Keep **@Superadmin** for yourself.
- For each agent, run in Discord: `/linkagent user:@Them email:their-crm-email@example.com`
  (this is what makes "own orders only" work).

## 8) Run it

- **Quick test:** `npm start` (Ctrl-C to stop).
- **Production (Sofia VPS):** copy the folder to `/opt/elyon-discord-bot`, then install the unit in
  `discord-bot/deploy/elyon-bot.service` (commands are in the file header). It auto-restarts and is
  capped at 256 MB / 50% CPU.

## 9) Verify (recommended)

- In Discord: `/order <a real order #>`, `/myday`, `/health`. Numbers should match the CRM's Agents
  tab for the same date.
- Permissions: from an Agent account, confirm admin commands are refused and `/order` only finds
  your own orders.
- Read-only proof: `psql "$DATABASE_URL" -c "insert into orders(display_id,product_name) values('x','y');"`
  must fail with a permissions error.

---

### Values summary (all go in `discord-bot/.env`)

| Variable | From |
|---|---|
| `DISCORD_TOKEN` | Developer portal → Bot → Reset Token |
| `DISCORD_CLIENT_ID` | Developer portal → General → Application ID |
| `DISCORD_GUILD_ID` | Right-click your server → Copy Server ID |
| `DATABASE_URL` | Supabase → Database → Session pooler (user `discord_bot_ro`) |
| `DISCORD_*_ROLE_ID` ×4 | printed by `npm run setup-server` |
| `DISCORD_AUDIT_CHANNEL_ID` | printed by `npm run setup-server` |
| `BOT_TZ` | leave as `Europe/Sofia` |
