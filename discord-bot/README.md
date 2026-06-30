# Elyon Discord Bot

A **standalone, read-only** Discord bot for the Elyon CRM call-center team. Slash commands for
order status, agent daily/range reports, COD reconciliation, callbacks, returns, agent work time,
leaderboards and more.

- **No LLM, no paid APIs** — free to run.
- **Strictly read-only** — connects to Postgres with a `SELECT`-only role; it physically cannot
  modify CRM data and never touches the CRM code, Asterisk/PBX, or recordings.
- **Fail-closed role gating** — an Agent can never reach a Superadmin command.
- Lives entirely in this `discord-bot/` folder; nothing here is imported by the CRM.

## Quick start (full steps in `docs/discord-bot/CHECKLIST.md`)

```bash
cd discord-bot
cp .env.example .env        # then fill in the values
npm install
npm run build

# one-time: create roles/channels that are missing, then register slash commands
npm run setup-server
npm run deploy-commands

# run it
npm start                   # or install the systemd unit in deploy/elyon-bot.service
```

## Layout

```
src/
  index.ts             boot + fail-closed interaction router
  deploy-commands.ts   register slash commands to the guild (instant)
  config.ts            env loading + validation
  db/                  read-only Postgres pool + query modules
  identity/            Discord <-> CRM agent map (local JSON, no CRM writes)
  commands/            one file per slash command (each declares allowedTiers)
  lib/                 authz, currency, status, time, pii, csv, embeds, audit
  scripts/             setup-discord-server.ts (idempotent)
deploy/
  elyon-bot.service    resource-capped systemd unit
```

See `docs/discord-bot/` for the architecture, command catalog, server structure and checklist.
