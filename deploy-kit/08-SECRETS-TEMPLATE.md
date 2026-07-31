# 08 — Secrets template (blank vault for Macedonia)

Every credential a Macedonia deployment needs, **with no real values**. Copy this into a private
file (e.g. `docs/VAULT.md` in the fork — already gitignored) and fill it in as you create each
account. Mirrors the structure of the Bulgarian vault so it feels familiar.

> 🔐 **Never commit the filled copy. Never paste secrets into a browser or chat.** Keep the
> master in a password manager; this file is just the local working copy.
>
> The fork's `.gitignore` already excludes `docs/VAULT.md`, `.env`, `.env.*`, `.secrets/`,
> `.vercel/` (confirmed in [`../.gitignore`](../.gitignore)).

---

## 1. Supabase (project `<NEW_PROJECT_REF>`)

| Key | Value | Where it's used |
|---|---|---|
| Project ref | `__________` | `supabase/config.toml`, CLI `--project-ref` |
| Project URL | `https://__________.supabase.co` | `VITE_SUPABASE_URL` |
| Dashboard | `https://supabase.com/dashboard/project/__________` | — |
| anon / publishable key (public) | `__________` | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| service_role key (SECRET) | `__________` | `SUPABASE_SERVICE_ROLE_KEY` (scripts + function) |
| DB password | `__________` | `supabase link`, `pg_dump`, Studio |
| CLI access token | `sbp___________` | `SUPABASE_ACCESS_TOKEN` for deploy / db push |

## 2. Edge-Function secrets (Settings → Edge Functions → Secrets)

| Secret | Value | Notes |
|---|---|---|
| `WEBHOOK_SECRET` | `__________` | new random HMAC key; share only with Macedonia senders |
| `SUPABASE_URL` | `https://__________.supabase.co` | usually runtime-provided |
| `SUPABASE_SERVICE_ROLE_KEY` | (as §1) | usually runtime-provided |
| `SUPABASE_ANON_KEY` | (as §1 anon) | needed by the function's RLS client |
| `REC_SHARED_SECRET` | `__________` | **Phase 2 only** — PBX recording auth |

## 3. `.env` (local, gitignored) — fork working copy

```
VITE_SUPABASE_PROJECT_ID="<NEW_PROJECT_REF>"
VITE_SUPABASE_URL="https://<NEW_PROJECT_REF>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key>"
SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
SUPABASE_ACCESS_TOKEN="<CLI token>"
```
> Note: `create-admin-users.mjs` reads `SUPABASE_URL` (no `VITE_` prefix) — set it ad-hoc when
> running that one script (see [04](04-SEED-AND-BOOTSTRAP.md)).

## 4. Vercel (frontend hosting)

| Item | Value |
|---|---|
| Project name | `__________` (e.g. elyon-macedonia) |
| Project ID | `prj___________` |
| Org / team ID | `team___________` |
| Production domain(s) | `__________` |
| Env vars set in Vercel | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_USE_REAL_VOIP` |

## 5. Domain / DNS

| Item | Value |
|---|---|
| Registrar | `__________` |
| Domain | `__________` |
| DNS targets | app → Vercel; (Phase 2) `pbx.…` → PBX VPS IP |

## 6. PBX / telephony (Phase 2)

| Item | Value |
|---|---|
| PBX host / FQDN | `pbx.__________` |
| VPS public IP | `__________` |
| VPS provider / panel | `__________` |
| SSH private key path | `__________` |
| FreePBX admin | (password manager only) |
| WSS endpoint | `wss://pbx.__________:8089/ws` |

## 7. Carrier — SIP trunk (Phase 2)

| Item | Value |
|---|---|
| Carrier / product | `__________` (IPKO / Vodafone / Albtelecom / …) |
| Auth type | IP-auth or user/pass |
| SBC (signalling) host:port/transport | `__________` |
| Channels / DIDs / minutes | `__________` |
| Monthly fee | `__________` |
| DID numbers (+383) | `__________` |
| Support / NOC | `__________` |

## 8. Other accounts

| Item | Value |
|---|---|
| GitHub repo (private) | `github.com/__________/elyon-macedonia` |
| Founding admin login(s) | `__________@__________` (rotate bootstrap pw immediately) |
| OpenCart store (optional) | `__________` |
| Discord bot token (optional) | `__________` |

## 9. If anything leaks — rotate everything
Same drill as the Bulgarian vault's §8: roll Supabase anon/service_role keys, DB password, CLI
token, `WEBHOOK_SECRET` (and every sender in lockstep), PBX SSH key, carrier credentials, and
Vercel/GitHub/registrar; then redeploy function + frontend and re-verify a webhook (and a test
call in Phase 2).

➡ Next: [09-GO-LIVE-CHECKLIST.md](09-GO-LIVE-CHECKLIST.md)
