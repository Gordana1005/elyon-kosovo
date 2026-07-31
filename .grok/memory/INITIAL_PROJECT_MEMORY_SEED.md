# Elyon CRM — Initial Memory Seed (May 2026)

This document is intended to be used as the starting point for the project's workspace memory (in `~/.grok/memory/<project>/MEMORY.md`).

Copy relevant sections into your actual memory after enabling it.

## Sacred Constants & Rules (Never Break)

- **BGN_PER_EUR = 1.95583** (fixed BNB peg — never change or fetch live rates)
- Phone search always uses **last 8 digits** after stripping non-digits. Store as +359XXXXXXXXX.
- Fulfilment CSV must be **comma-delimited, NO BOM** (`toCsv(..., ',', false)`).
- Stock changes **only** on `shipped` (decrement) and `returned` (restore). Only when `order_items.product_id` is set.

## Operator Profile

- Mile Stoev (`info@iroom.de`) — hands-on operator in Skopje, runs the call centre.
- Values: pre-fill over re-typing, no information leaks to agents (queue counts etc.), clear EUR + LEV display side-by-side everywhere, speed with safety, clean agent flow.
- Communication style: Direct. Prefers clear recommendations first, then tradeoffs. Authorizes full execution ("do it all for me") when trust is established.

## High-Risk / High-Complexity Areas (Extra Care Required)

- Anything touching stock or inventory logs
- Fulfilment CSV format, columns, and status flips on export
- Phone normalization logic and search
- Currency formatting and calculations (the peg is sacred)
- Webhook signature verification, per-product slugs, and rate limiting
- VOIP/PBX infrastructure and the live softphone / call data
- Prediction list (segment) recompute and bulk assignment integrity

## Skills System (Elyon Agent Operating System)

We maintain a first-class set of project-specific skills in `.grok/skills/`.

**Always check skills first** at the start of relevant work using `/skills`.

Current skills (as of May 2026):

- `elyon-currency`
- `elyon-phone-normalization`
- `elyon-fulfilment-csv`
- `elyon-warehouse-incoming`
- `elyon-webhook-and-lead-ingestion`
- `elyon-stock-and-bigarena`
- `elyon-voip-and-pbx`
- `elyon-segments-and-prediction`

New skills should be added whenever the same complex rule or workflow needs to be explained repeatedly.

## VOIP / PBX Status — LIVE in production

> **This section is current as of June 2026. Trust the running code and `/voip-health` over any older
> "mock/awaiting" wording elsewhere.** Telephony is fully live.

**Infrastructure**: Asterisk 20.19.0 LTS + FreePBX 16.0.45 on Sofia AlphaVPS (`pbx.elyoncall.com`, IP 104.152.48.222 + IPv6). Real Let's Encrypt TLS WSS endpoint live at `wss://pbx.elyoncall.com:8089/ws`. Hardened (SSH key-only, fail2ban, firewalld, SELinux Permissive due to FreePBX issues).

**Carrier**: A1 "Business Voice" SIP trunk — **live in production** (Path II: our FreePBX registers A1's trunk; Sofia BG IP origin so A1 sees domestic traffic).

**Frontend**: live softphone = `src/lib/voip/RealVoipEngine.ts` (sip.js) behind `VoipContext` (config in `src/lib/voip/pbxConfig.ts`). Every call logs real `connection_state`/`talk_seconds` to `call_logs`. `src/lib/mockCalls.ts` is **dead** (no importers).

**What's live**: two-way browser→A1→PSTN calls; per-agent extensions + per-agent caller-ID; call recordings (MixMonitor) browsable on the Recordings page (signed URLs); missed-call inbox; superadmin **VOIP Health** dashboard at `/voip-health` + alert banner.

**Key Rules**:
- Never regenerate the TLS cert or change Apache user/group without reading the full `PBX-SETUP.md`.
- Use `*_custom.conf` files for any Asterisk customizations.
- Before touching telephony, read `docs/telephony/RUNBOOK.md` + `docs/telephony/MONITORING.md` and the working-config memories (`project_voip_working_config`, `project_voip_calldrops_proxytimeout_2026-06-10`).

## Segments / Prediction Lists System

27 rule-driven lists for intelligent customer re-marketing and agent assignment.

- Memberships live in `prediction_segment_members`.
- Recompute (via RPC `recompute_all_segments`) is the source of truth and can change assignments.
- Customers can belong to multiple lists.
- Bulk assign supports round-robin distribution.
- Old manual XLSX-upload lists are legacy (hidden from main sidebar).

**Performance note**: Use explicit pagination for counts and member lists (the membership table can be large).

**Gotcha**: Manual assignments can be affected by the next recompute. Always verify counts after changes using the verification scripts in `scripts/`.

## Deployment & Ops Playbook

**Supabase (Edge Functions + DB)**:
- Always use the personal access token from `.env` (`SUPABASE_ACCESS_TOKEN`).
- Preferred PowerShell pattern:
  `$env:SUPABASE_ACCESS_TOKEN = (Select-String '^SUPABASE_ACCESS_TOKEN=' .env).Line.Split('=')[1].Trim('"'); npx supabase functions deploy api --project-ref bmfxhgznttcnnlqloqzp`
- Run `npm run build` locally before any function deploy.
- Migrations: `npx supabase db push --linked` (same token pattern).

**Frontend**: Vercel auto-deploys on push to main.

**PBX**: Treat as high-risk. Full read of `PBX-SETUP.md` required before touching.

**General Safety Rule**: For anything touching money, stock, customer data, or live customer-facing flows — add extra validation and consider explicit human confirmation.

## Recent Major Wins (Context)

- Warehouse Incoming Orders performance transformed (new composite indexes in `20260523093000_warehouse_incoming_orders_indexes.sql` + explicit `.range()` pagination in the handler + React Query with targeted invalidation instead of blind full refetches). Operator feedback: "everything is fast as bullet".
- Complete custom Grok skills + memory + agent constitution system created (`.grok/` infrastructure). This is now the foundation for reliable long-term collaboration.
- Strong protection around all sacred rules (currency, phones, fulfilment format, stock discipline, etc.).

## Operator Preferences for AI Collaboration

- Terse, confident answers: recommendation first, tradeoffs second. No hedging.
- For exploratory questions: 2–3 sentences + at most one clarifying question.
- When authorized ("do it all for me", "you do it for me"), execute fully — deploys, git pushes, setup, file creation — without constant re-confirmation.
- Values building the agent environment itself to be excellent over time (skills, memory, instructions). This compounds.
- Always respect the "Things NOT to break" list in the main `Claude.md`.

## Recommended Memory & Skills Practice

- After any productive session involving high-risk areas or complex domain work, use `/flush`.
- Run `/dream` periodically for consolidation.
- At the beginning of any non-trivial task, run `/skills` and inject the relevant ones early.
- Keep this memory file and the skills up to date. They are load-bearing infrastructure for the partnership.

---

This seed captures the spirit and current state of the project as of late May 2026. Update and expand it over time.

*Seeded and substantially enhanced: May 2026 as part of building a world-class, long-term AI + human operating system for Elyon CRM.*