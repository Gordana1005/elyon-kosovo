# Architecture — the whole system on one page

> Everything that exists, where it runs, and how the pieces talk. Start here.

---

## 1. The business loop (why any of this exists)

```
 Acquisition (ads / affiliates / website / list buys)
        │  produces LEADS
        ▼
 Elyon CRM  ──►  agent calls customer  ──►  confirms order
 (Strumica, MK)        (BG mobile)              │
        │                                       ▼
        │                          Daily Fulfilment CSV  ──►  Bulgarian warehouse
        │                                                          │ Speedy / Econt
        ▼                                                          ▼
 Analytics / segments  ◄──  paid (cash on delivery)  ◄──  courier delivers
```

- **Who:** Mile Stoev runs a ~3‑agent call centre in Strumica, North Macedonia (`info@iroom.de`).
- **Who they call:** Bulgarian customers, in Bulgarian, on **BG mobile DIDs** (caller‑ID must look local or nobody answers).
- **What they sell:** nutritional supplements.
- **How they get paid:** overwhelmingly **cash on delivery (COD)** via Bulgarian couriers.
- **Currency:** stored in **EUR**, displayed as **EUR + BGN (лв)** everywhere. Fixed peg `1 EUR = 1.95583 BGN` ([src/lib/currency.ts](../src/lib/currency.ts)). Never recompute or fetch live FX.
- **Language/data:** overwhelmingly **Cyrillic** (names, cities, products, notes), with Latin transliteration for search.

---

## 2. Components & hosting

```
                         ┌────────────────────────────────────────────────┐
   Agent's browser  ───► │  FRONTEND  (React + Vite SPA)                   │
   (Chrome, Strumica)    │  Vercel · https://elyoncall.com + www           │
                         │  org team_vvGAN… · project "elyoncrm"           │
                         └───────────────┬────────────────────────────────┘
                                         │ HTTPS (fetch + supabase-js)
                                         ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │  SUPABASE  (project ref bmfxhgznttcnnlqloqzp)                        │
        │                                                                      │
        │   • Auth (email/password, JWT)                                       │
        │   • Postgres (RLS on every table) ── ~39 tables                      │
        │   • Edge Function `api` (Deno, one file, ~14,900 lines)              │
        │       - REST surface for the whole app (~130 routes)                 │
        │       - public webhooks (HMAC) for landing pages + OpenCart          │
        │   • Storage: (none yet — call-recordings bucket lands with VOIP P2)  │
        └───────▲───────────────────────────────────────────────▲────────────┘
                │ HMAC POST (no JWT)                              │ outbound fetch
                │                                                 ▼
   ┌────────────┴───────────────┐                  ┌──────────────────────────────┐
   │  Landing pages (55 webhooks)│                  │ Econt / Speedy public APIs    │
   │  naturatherapy.bg (OpenCart)│                  │  (courier offices, BG streets)│
   └────────────────────────────┘                  └──────────────────────────────┘

        ┌────────────────────────────────────────────────────────────────────┐
        │  TELEPHONY (LIVE — wired to the app)                                 │
        │  AlphaVPS Sofia · pbx.elyoncall.com · 104.152.48.222                 │
        │  Asterisk 20 + FreePBX 16 · WSS wss://pbx.elyoncall.com:8089/ws      │
        │  → A1 "Business Voice" SIP trunk (live) → PSTN                       │
        └────────────────────────────────────────────────────────────────────┘
```

| Layer | Tech | Where | Notes |
|---|---|---|---|
| Frontend | React 18, TypeScript, Vite 5, React Router 6, TanStack Query 5, shadcn/ui (Radix+Tailwind), lucide, sonner, recharts, date‑fns, zod | Vercel | SPA, route‑level code splitting. `elyoncall.com` + `www` + legacy `elyoncrm.vercel.app`. |
| Backend | Supabase Edge Function (Deno), single `api/index.ts` | Supabase | Path‑dispatched REST. `verify_jwt = false` (the function authenticates itself). |
| Database | Postgres 14.x (PostgREST 14.5) | Supabase | RLS everywhere; service‑role used by the function for cross‑tenant reads. |
| Auth | Supabase Auth (email+password) | Supabase | Role(s) in `user_roles`; profile in `profiles`. |
| Scripts | Node 22 ESM, `xlsx`, `--env-file=.env` | Local (Mile's machine) | Imports, exports, scrapers, audits. |
| Telephony | Asterisk 20 LTS + FreePBX 16, AlmaLinux 8.10 | AlphaVPS Sofia | See [../PBX-SETUP.md](../PBX-SETUP.md). |

**Domains & DNS (Namecheap):** `@`→Vercel, `www`→Vercel, `pbx`→`104.152.48.222`. TLS: Vercel auto for the app; Let's Encrypt on the PBX.

---

## 3. Request paths (what calls what)

**A. Normal app request (authenticated)**
```
Browser → supabase-js getSession() → fetch(`${VITE_SUPABASE_URL}/functions/v1/api/<path>`,
          Authorization: Bearer <jwt>, apikey: <anon>)
        → Edge Function: getClaims(jwt) → load user_roles → role-gate → adminClient (service role) queries Postgres
        → JSON back. CORS origin echoed only for allow-listed origins.
```
The browser almost never queries Postgres directly through PostgREST; **everything goes through the
Edge Function** via [src/lib/api.ts](../src/lib/api.ts). Exceptions where the browser uses `supabase-js`
directly: **Auth** (login/session) and the **`get_my_permissions` RPC** (permissions bootstrap) — see
[FRONTEND.md](FRONTEND.md).

**B. Inbound lead / order (no JWT — server‑to‑server)**
```
Landing page / OpenCart store → POST …/functions/v1/api/webhook/<slug|opencart>
   header x-webhook-signature: hex(HMAC_SHA256(rawBody, WEBHOOK_SECRET))
 → Edge Function verifies HMAC, rate-limits, inserts inbound_leads/orders (status=pending, unassigned)
 → appears in Assigner → Pendings
```
Full detail in [WEBSITES_WEBHOOKS.md](WEBSITES_WEBHOOKS.md).

**C. Telephony (live)**
```
Browser softphone (sip.js over WSS) → Asterisk@Sofia → A1 Business Voice SIP trunk → PSTN → BG mobile
```
The Calls page uses the real softphone (`RealVoipEngine` behind `VoipContext`); calls are recorded and
logged to `call_logs`.

There is a **reverse path** for live call presence (who's on a call right now):
```
VoipContext → callStateBus → AuthContext (45 s beat) → POST /presence/heartbeat
   → profiles.voip_state → GET /agents/online .in_call → Assigner status tile / Ops-Center badge
```
This is **browser‑self‑reported, not PBX‑derived**, and is staleness‑guarded at 3 min.
See [CALLS.md](CALLS.md) §3b and the go‑live record [CALLING_PLAN_SIP.md](CALLING_PLAN_SIP.md).

---

## 4. The data spine

The central table is **`orders`** (~14k rows incl. historical imports). Almost everything hangs off it:

```
prediction_lists ─┐                         ┌─ order_items ── products ── inventory_logs
prediction_leads ─┤   (leads convert into)  ├─ order_notes
inbound_leads ────┼────────────────────────►  ORDERS ──┼─ order_history (audit of every status change)
webhooks ─────────┘   (or are created       │           ├─ order_locks / active_call_views (soft locks)
opencart bridge ──────────────────────────► │           └─ call_logs (context_type='order')
                                            └─ trigger ──► prediction_segment_members  (the 27 lists)
```

- **No `customers` table.** A "customer" is every order/lead sharing a **`customer_phone`**, matched on
  the **last 8 digits** (phones stored as `+359…`). The Customer Intelligence dossier is computed live.
- **Segments are rules, not rows.** A Postgres trigger reclassifies a phone into the 27 prediction
  lists whenever its orders change. See [DATABASE.md](DATABASE.md) and [ORDERS_AND_CLIENTS.md](ORDERS_AND_CLIENTS.md).
- **Stock moves only on `shipped`/`returned`**, and only when an `order_items` row has a `product_id`
  (legacy imports don't). See [PRODUCTS_STOCK_WAREHOUSE.md](PRODUCTS_STOCK_WAREHOUSE.md).

---

## 5. Order lifecycle (the master state machine)

```
            agent confirms                  CSV export (warehouse)            COD reconciliation
 pending ───────────────► confirmed ───────────────────────────► shipped ───────────────────► paid
   │  ▲ (TAKE soft-lock while an agent is on the call)              │
   │  └── call_again (re-queues; resurfaces on its day)            └── returned (stock restored)
   └── cancelled / trashed (with structured reason)
```

`order_status` enum: `pending · take · call_again · confirmed · shipped · delivered · returned · paid · trashed · cancelled`.
Transitions, side effects, and who's allowed to do them: [ORDERS_AND_CLIENTS.md](ORDERS_AND_CLIENTS.md).

---

## 6. Environments & deploy

| Thing | Command / location |
|---|---|
| Local dev | `npm install && npm run dev` → `http://localhost:8080` |
| Build | `npm run build` (Vite → `dist/`) |
| Tests | `npm test` (vitest — currently 1 trivial test) |
| Lint | `npm run lint` (eslint — currently **red**, 643 errors, mostly `any`) |
| Frontend deploy | push to `main` → Vercel auto‑deploys |
| Edge function deploy | `npx supabase functions deploy api --project-ref bmfxhgznttcnnlqloqzp` |
| DB migration | `npx supabase db push --linked` |
| CI | GitHub Actions `.github/workflows/ci.yml` — runs **build + test only** (not lint) on push/PR to `main` |

Deploy/auth details, env vars, and the CLI access‑token dance are in [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md).
All secrets are in [VAULT.md](VAULT.md) (git‑ignored).

---

## 7. Cross‑cutting conventions (don't break these)

1. **EUR storage, EUR+BGN display, fixed 1.95583 peg.**
2. **Phone search = last‑8‑digits**, never exact equality (phones arrive in 4+ formats).
3. **Cyrillic ↔ Latin transliteration** tables must stay in sync (importer + Edge Function `CYR_TO_LAT`).
4. **PostgREST truncates at 1000 rows** — paginate with `.range(from, from+999)` loops (most analytics already do; `orders/stats` does **not** — see [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md)).
5. **CORS allow‑list lives in the function** (`ALLOWED_ORIGINS`) — adding a domain needs an edit **and a redeploy**.
6. **`WEBHOOK_SECRET`** gates every inbound webhook; if unset the function accepts unsigned bodies — never unset in prod.
7. **Note provenance** (`Imported from …`) stays in storage; stripped only on render via `cleanNoteForDisplay()`.
8. **Live call status is browser‑self‑reported, not PBX‑derived** (`profiles.voip_state`, written by the
   agent's tab) — always pair it with a **3‑minute staleness guard** on `voip_state_at`, or a browser that
   dies mid‑call leaves the agent stuck "In call" forever.

---

*Next: [DATABASE.md](DATABASE.md) for the schema, or [BACKEND_API.md](BACKEND_API.md) for the API surface.*
