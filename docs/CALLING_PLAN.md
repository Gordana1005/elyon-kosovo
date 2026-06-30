# In-CRM softphone + call workspace for Elyon CRM

> **Living document.** Update the **A1 Answers** section below as soon as you hear back from A1, then ping the implementer. The rest of this file is the locked design — only edit it if requirements change.

---

## A1 Answers (fill in as info arrives)

> Status: ⏳ **waiting for info from A1**

| # | Question | A1 answer |
|---|---|---|
| 1 | WebRTC enabled on our extensions? | _TBD_ |
| 2 | WSS endpoint URL | _TBD_ |
| 3 | SIP domain / realm | _TBD_ |
| 4 | SIP username — Mile | _TBD_ |
| 5 | SIP password — Mile | _TBD_ |
| 6 | SIP username — Miki | _TBD_ |
| 7 | SIP password — Miki | _TBD_ |
| 8 | SIP username — Tome | _TBD_ |
| 9 | SIP password — Tome | _TBD_ |
| 10 | Outbound caller-ID number(s) | _TBD_ |
| 11 | Codec list | _TBD_ |
| 12 | DTMF method (RFC2833 / SIP INFO) | _TBD_ |
| 13 | Concurrent-call limit | _TBD_ |
| 14 | Recording feature enabled? | _TBD_ |
| 15 | Recording delivery method (REST / webhook / SFTP / portal) | _TBD_ |
| 16 | Recording format + bitrate | _TBD_ |
| 17 | Recording retention | _TBD_ |
| 18 | REST API base URL | _TBD_ |
| 19 | REST API credentials / scopes | _TBD_ |
| 20 | Per-agent caller-ID possible? | _TBD_ |
| 21 | Source-IP allowlisting? | _TBD_ |
| 22 | STUN/TURN provided? | _TBD_ |
| 23 | If no WebRTC: SIP trunk available? | _TBD_ |
| 24 | Monthly cost for any added services | _TBD_ |

> **⚠️ Do not commit this file with passwords filled in.** Once we have credentials, store them as Supabase Edge Function secrets via `npx supabase secrets set` — never in git.

---

## Context

Elyon CRM (`c:\Users\Mile\Desktop\elyoncrm\`) is a 2-agent (soon ≤10) call center. Today, agents call from MaxUC desktop or mobile and manually log outcomes in the CRM. **Goal**: a single page in the CRM where the agent works — sees the customer, product, phone, history; clicks call; the audio happens *in the browser tab*, the recording is saved automatically, and the outcome (confirmed / cancelled / busy / re-scheduled / not interested / no answer) is captured on the same screen. No external app, no `tel:` handoff, no redirect.

User confirmed:
- Storage cost is not a constraint — buy more Supabase storage as needed.
- VPN purchase is fine.
- They are using **MaxUC** today, which is *MetaSwitch UC* — A1 Bulgaria's hosted UC service. That's a critical clue: A1 already provisions SIP extensions; we just need the right credentials/endpoint.
- A1's specifics (WSS endpoint, API access, recording feature) are pending a phone call with A1.

## What the codebase already has (verified)

- **`call_logs`** table with `(id, agent_id, context_type, context_id, outcome, notes, created_at)` and correct RLS — `supabase/migrations/20260215081123_…sql:46-74`.
- **`call_logs.outcome`** CHECK constraint currently allows: `no_answer | interested | not_interested | wrong_number | call_again`. We will extend it (see schema section).
- **`call_scripts`** + GET/PATCH endpoints — `supabase/functions/api/index.ts:2540-2592`.
- **`POST /api/call-logs`** already inserts a log AND auto-updates `prediction_leads.status` from outcome — `index.ts:2594-2642`. This auto-status block is reusable for the new finalize endpoint.
- **`GET /api/call-history`** returns enriched logs joined with profiles, orders, prediction_leads — `index.ts:2644-2753`.
- **`PhoneQualityBadge.tsx`** already wraps `lead.telephone` in `PredictionLeadsPage:407` — extend its props to accept `onCall`.
- **`OrderModal.tsx:415`** has a `tel:` link we'll replace with the in-CRM dialer.
- **Realtime pattern** in `NotificationsDropdown.tsx:66-75` — copy it for live call status.
- **No** WebRTC, sip.js, JsSIP, MediaRecorder, AudioContext, Supabase Storage, or buckets anywhere.
- **No** `call_sessions` table — needs creating.
- **`vaul`** drawer library already in `package.json:64` — use it for the active-call sheet.

Phone surfaces: `Orders.tsx:375`, `PredictionLeadsPage.tsx:407`, `InboundLeadsPage.tsx:191`, `CallHistoryPage.tsx:229`, `CustomerHistoryDialog.tsx:145`, `OrderModal.tsx:415`. All become click-to-call.

## Architecture — in-browser softphone, two SIP backends

The browser runs a WebRTC softphone (sip.js). It registers as the agent's SIP extension over WSS. Whether the WSS endpoint is **A1's MetaSwitch directly** or **our own PBX** is settled by Phase 0; the front-end code is identical.

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  Agent's browser tab (Chrome on Macedonia, Surfshark→BG VPN)     │
 │                                                                  │
 │  Elyon CRM (Vercel)                                              │
 │  ┌──────────────────────────────────────────────────┐            │
 │  │  CallStationPage                                 │            │
 │  │   ┌────────────────────┬─────────────────────┐   │            │
 │  │   │ Customer card      │  Active call panel  │   │            │
 │  │   │  - Name, phone     │  - status pill      │   │            │
 │  │   │  - Product, price  │  - duration timer   │   │            │
 │  │   │  - Address         │  - mute / hangup    │   │            │
 │  │   │  - Past calls      │  - outcome buttons  │   │            │
 │  │   │  - Notes           │  - re-schedule date │   │            │
 │  │   └────────────────────┴─────────────────────┘   │            │
 │  │                       ↑                          │            │
 │  │            sip.js UA (WebRTC + SRTP)             │            │
 │  └──────────────────────────────────────────────────┘            │
 │                          │ WSS:443                                │
 └──────────────────────────┼────────────────────────────────────────┘
                            ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Path I:  A1 MetaSwitch SBC                                  │
   │           wss://sbc.a1.bg:443  → A1 PSTN                     │
   │           Recording: A1 "Call Recording Pro" add-on (server) │
   │  *or*                                                        │
   │  Path II: Our FreePBX on Bulgarian VPS (~€8/mo)              │
   │           wss://pbx.elyon.<tld>:8089 → A1 SIP trunk → PSTN   │
   │           Recording: MixMonitor → /var/spool → upload script │
   └──────────────────────┬───────────────────────────────────────┘
                          │ HTTPS + HMAC
                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Supabase                                                    │
   │   - Postgres: call_sessions, call_logs (extended)            │
   │   - Storage:  call-recordings bucket                         │
   │   - Edge fn:  /api/calls/*, /api/webhook/pbx                 │
   │   - Realtime: call_sessions row → live UI status             │
   └──────────────────────────────────────────────────────────────┘
```

Path I and Path II are mutually exclusive at deploy time. The Phase 0 phone call with A1 picks the path:

- **Path I (zero infra)** — if A1 confirms their MetaSwitch tenant exposes WSS for our extensions and the "Call Recording" feature is enabled.
- **Path II (~€8/mo VPS)** — if A1 only gives us a SIP trunk (UDP/TCP on a registered IP). We rent a Bulgarian VPS, install FreePBX 17 / Asterisk 20, register the trunk, expose `wss://…:8089/ws` for the browser. Recording is local-disk MixMonitor → small Python uploader script → Supabase Storage via signed webhook.

The Front-end code is **identical** for both — only the WSS URL and the per-extension secret change.

## Phase 0 — what to get from A1 (user task)

Below is exactly what to request, organized as a single conversation with A1's business / SIP-product team. Frame it as: *"We're building an in-house web-based call-center dashboard for our team. Today we use MaxUC; we want to migrate to a browser-only softphone integrated into our CRM, with automatic call recording. Please advise which of our existing services supports this and what we need to subscribe to."*

### Block 1 — WebRTC on our existing MaxUC (Path I, ideal)

1. **WebRTC enablement**: *"Does our MaxUC tenant allow our extensions to register a WebRTC softphone (over WSS) directly to your SBC? If yes, please send: SBC WSS URL (e.g. `wss://sbc.a1.bg:443/ws`), the SIP domain/realm, and confirmation that WebRTC is enabled per-extension."*
2. **Per-agent SIP credentials**: *"For each of our extensions, please confirm or send: (a) SIP URI (`sip:<user>@<realm>`), (b) auth username, (c) password (or a way for us to rotate it ourselves)."* — three sets, one per agent.
3. **Codec support**: *"Which audio codecs does the SBC offer for WebRTC? We want G.711 (alaw or ulaw) and Opus. Confirm DTMF method (RFC2833 / SIP INFO)."*
4. **Concurrent call limit**: *"How many simultaneous outbound calls does our service support? We expect ≤10 at peak."*

### Block 2 — Recording (mandatory either way)

5. **Recording feature**: *"Is call recording enabled on our service? If not, please add it (we'll pay the add-on). Confirm whether it's per-extension or tenant-wide."*
6. **Recording delivery**: *"How do we retrieve recordings? Pick what's available, in order of preference: (a) REST API to fetch by call ID, (b) webhook posting recording URL after each call, (c) daily SFTP drop, (d) MaxUC portal download (manual)."*
7. **Storage retention**: *"How long do you keep recordings? Can we set retention to e.g. 14 days knowing we copy them to our own storage immediately?"*
8. **Format**: *"What audio format and bitrate? (We expect WAV PCM 8 kHz or MP3 32 kbps mono.)"*

### Block 3 — CDR / Call event API

9. **CDR / REST API access**: *"Do we have access to the MaxUC / MetaSwitch REST API? If yes, send: base URL, OAuth or API-key credentials, and list of scopes we hold (we need at minimum `read:cdr`, `read:recordings`, ideally `webhook:call_events`)."*
10. **Real-time call events**: *"Does the API support webhooks for call lifecycle events (ringing, answered, ended)? If not, what is the polling interval / rate-limit on CDR queries?"*

### Block 4 — Caller-ID

11. **Caller-ID per extension**: *"What number is presented as the outbound caller-ID? Is it the same for all extensions or can each extension be assigned its own DID? If we wanted per-agent caller-ID, what's the cost of additional DIDs?"*
12. **Allowed dial patterns**: *"Are there any restrictions on what numbers we can call from this service (international, premium, regulated services)? Do we need to whitelist destinations?"*

### Block 5 — Network / IP rules

13. **Source-IP allowlisting**: *"Will the agents' browsers be connecting from a Macedonian IP. Does your SBC accept WebRTC registration from any IP, or do you allowlist by country / IP range? If allowlist, can we register our office IP and a Bulgarian VPN IP range?"*
14. **TURN / NAT traversal**: *"Do you provide a STUN/TURN server for our WebRTC clients, or should we operate our own?"*

### Block 6 — Fallback (Path II) — only if Block 1 says "WebRTC not available"

15. **SIP trunk option**: *"If WebRTC isn't available on our MaxUC tenant, can you sell us an alternative B2B SIP trunk product? We'll register it on our own PBX hosted in Bulgaria. We need: registrar IP / FQDN, SIP username, SIP password, allowed source IP (we'll provide our VPS IP), expected codecs, registration interval."*

### What the answers determine

| If A1 says… | Then we ship… |
|---|---|
| "WebRTC available, recordings via API, REST API yes" | **Path I**, no infra. ETA Phase 1 = 4-5 days. |
| "WebRTC available, recordings via SFTP only" | **Path I**, plus a small recording-fetcher cron. ETA +0.5 day. |
| "No WebRTC; SIP trunk available" | **Path II** (Bulgarian VPS + FreePBX). ETA Phase 1 = 6-7 days (adds 1.5 days for PBX). |
| "No WebRTC and no SIP trunk on this product" | We need to add a SIP-trunk service line to your A1 contract before any of this works. |

### Practical: what to physically send / receive

When the call with A1 finishes, you should have written down or received:

- [ ] WSS URL (or SIP trunk registrar IP)
- [ ] SIP domain / realm
- [ ] 3× SIP usernames (one per agent: Mile, Miki, Tome)
- [ ] 3× SIP passwords
- [ ] Outbound caller-ID number(s)
- [ ] Recording delivery method + credentials
- [ ] REST API base URL + credentials (if available)
- [ ] Allowed-IP whitelist confirmation (or how to add ours)
- [ ] Codec list
- [ ] Confirmation of monthly cost for any added services (recording, extra DIDs, SIP trunk)

Send these to me and I lock in Path I vs Path II and start Phase 1 the same hour.

## Schema (single migration; identical for both paths)

`supabase/migrations/<TIMESTAMP>_call_workspace.sql`:

```sql
-- 1. Outcome enum — broaden the CHECK to cover what agents really say
ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_outcome_check
  CHECK (outcome IN (
    'confirmed',         -- order confirmed on the call
    'cancelled',         -- customer cancelled
    'rescheduled',       -- call again at a specific time
    'no_answer',         -- ringing, no pickup
    'busy',              -- line busy / engaged
    'voicemail',         -- went to voicemail
    'wrong_number',      -- not the customer's number
    'not_interested',    -- declined
    'interested',        -- soft yes, will follow up
    'call_again'         -- generic re-attempt later
  ));

-- 2. Call timing + recording + reschedule
ALTER TABLE public.call_logs
  ADD COLUMN call_started_at  timestamptz,
  ADD COLUMN call_ended_at    timestamptz,
  ADD COLUMN duration_seconds integer,
  ADD COLUMN recording_path   text,                  -- storage object key
  ADD COLUMN recording_source text,                  -- 'pbx' | 'maxuc' | 'webrtc_client'
  ADD COLUMN customer_phone   text,                  -- denormalized for fast filter
  ADD COLUMN caller_id_used   text,
  ADD COLUMN reschedule_at    timestamptz,           -- set when outcome='rescheduled'
  ADD COLUMN sip_call_id      text;
CREATE INDEX idx_call_logs_sip_call_id   ON public.call_logs (sip_call_id);
CREATE INDEX idx_call_logs_reschedule_at ON public.call_logs (reschedule_at)
  WHERE reschedule_at IS NOT NULL;

-- 3. Live in-flight call sessions (one row per active call; deleted when finalized)
CREATE TYPE call_session_status AS ENUM
  ('initiating','ringing','in_progress','ending','failed');

CREATE TABLE public.call_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES auth.users(id),
  context_type    text NOT NULL CHECK (context_type IN ('prediction_lead','order')),
  context_id      uuid NOT NULL,
  customer_phone  text NOT NULL,
  caller_id_used  text,
  sip_call_id     text UNIQUE,
  status          call_session_status NOT NULL DEFAULT 'initiating',
  started_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  failure_reason  text,
  recording_path  text
);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents see own sessions"   ON public.call_sessions
  FOR SELECT USING (agent_id = auth.uid());
CREATE POLICY "Agents insert own sessions" ON public.call_sessions
  FOR INSERT WITH CHECK (agent_id = auth.uid());
CREATE POLICY "Admins/Managers manage all" ON public.call_sessions
  FOR ALL USING (public.is_admin_or_manager(auth.uid()));
CREATE INDEX idx_call_sessions_agent_active
  ON public.call_sessions (agent_id, status)
  WHERE status IN ('initiating','ringing','in_progress');

-- 4. Storage bucket + RLS
INSERT INTO storage.buckets (id, name, public)
  VALUES ('call-recordings','call-recordings', false)
  ON CONFLICT DO NOTHING;
CREATE POLICY "Recordings readable by owner agent" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'call-recordings' AND (
      public.is_admin_or_manager(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.call_logs
        WHERE call_logs.recording_path = storage.objects.name
          AND call_logs.agent_id = auth.uid()
      )
    )
  );
CREATE POLICY "Recordings writable only by service role" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'call-recordings' AND auth.role() = 'service_role');
```

## Edge function additions (`supabase/functions/api/index.ts`)

```ts
// POST /api/calls/start
//   body: { context_type, context_id, customer_phone }
//   action: returns short-lived SIP creds + WSS URL the browser uses to register
//   returns: { session_id, sip: { ws_url, uri, password, caller_id }, expires_at }

// PATCH /api/calls/:session_id/sip-id
//   body: { sip_call_id }
//   action: browser-side patch once sip.js gets the Call-ID header

// POST /api/calls/:session_id/finalize
//   body: { outcome, notes, reschedule_at? }
//   action: copies call_sessions → call_logs row carrying timing + recording_path,
//           runs the prediction_lead status auto-update block,
//           if outcome='rescheduled' creates a notification + reminder,
//           deletes the session row, returns the call_logs.id.

// POST /api/webhook/pbx   (Path II only)
//   header: x-pbx-signature: hex(HMAC_SHA256(rawBody, PBX_WEBHOOK_SECRET))
//   header: x-pbx-event:    ringing | answered | hangup | recording
//   body for ringing/answered/hangup: { sip_call_id, ts, hangup_cause? }
//   body for recording:               multipart with audio file
//   action: HMAC-verifies, PATCHes call_sessions; on 'recording' uploads to bucket
//           and PATCHes recording_path. Reuses the rate-limit helper from line 184.

// GET /api/calls/:call_log_id/recording-url
//   action: 1-hour signed URL, RLS-checked in code (agent==self OR admin/manager).

// GET /api/calls/active
//   action: returns the agent's current call_sessions row if any —
//           used to restore UI after page reload.
```

Service-role secrets (master SIP password, PBX webhook secret, A1 API key) are read from `Deno.env.get(...)` and never sent to the browser. The browser receives a short-lived per-extension secondary credential issued at `/api/calls/start`.

## Frontend — the in-CRM call workspace

### New files

- **`src/contexts/WebPhoneContext.tsx`** — owns one `sip.js` `UserAgent` singleton, exposes `dial`, `hangup`, `toggleMute`, `finalize(outcome, notes, reschedule_at?)`, `state` (idle / connecting / ringing / in_progress / wrap_up), `vpnOk`, `ready`. Loads sip.js with `import('sip.js')` on first dial (keeps initial bundle slim). Subscribes to its own `call_sessions` row via the `NotificationsDropdown` realtime pattern.
- **`src/lib/sip.ts`** — thin wrapper over sip.js: `createUserAgent({ wsUrl, uri, password })`, `dial(targetUri)`, `hangup`, event handlers mapped onto our `WebPhoneContext` state.
- **`src/components/CallButton.tsx`** — universal trigger. Variants: `icon` (small phone button next to a phone number) and `inline` (wraps the phone text). Disabled with tooltip when `!vpnOk` or another call is active. `onClick` stops row-click propagation.
- **`src/components/ActiveCallSheet.tsx`** — the always-mounted bottom sheet (using `vaul`). Hidden when `state.status === 'idle'`. Shows:
  - Customer card (name, phone, product, address, value) — pulled from the context_id via React Query
  - Live status pill (`connecting → ringing → in_progress → ending → wrap_up`)
  - Stopwatch
  - Mute toggle (sip.js audio mute)
  - Hang-up button
  - Past 5 calls for this customer (mini timeline pulled from `call_history`)
  - When the call ends → outcome buttons row: Confirmed / Cancelled / Busy / No answer / Voicemail / Wrong number / Rescheduled / Not interested / Call again
  - When `Rescheduled` selected → date+time picker for `reschedule_at`
  - Notes textarea
  - **Save** → `webPhone.finalize(...)` → toast → close sheet → invalidate queries
- **`src/components/RecordingPlayer.tsx`** — `<audio controls>` that fetches a 1-hour signed URL via the new GET endpoint. Used in `CallHistoryPage`.
- **`src/pages/CallStationPage.tsx`** — *new* dedicated route `/call-station`. Two-column workspace:
  - **Left**: the agent's queue (assigned prediction leads OR assigned orders, toggle), with click-to-select
  - **Right**: full-screen customer card (mirrors what the bottom sheet shows, plus more — full address history, order details, prior call recordings inline) and a big **Call** button
  - Keyboard shortcuts: `Space` = call selected, `1-9` = pick outcome after call ends
  - Replaces the agent's primary workflow — `AssignedPage` and `PredictionLeadsPage` link to it

### Files to modify

- `src/App.tsx` — wrap tree in `<WebPhoneProvider>`; mount `<ActiveCallSheet />` once next to `<NotificationsDropdown />`; add `<Route path="/call-station" element={<ProtectedRoute moduleKey="call_station"><CallStationPage /></ProtectedRoute>} />`.
- `src/contexts/PermissionsContext.tsx` — add `call_station: '/call-station'` to `MODULE_ROUTE_MAP`.
- `src/components/AppSidebar.tsx` — add a "Call Station" nav entry near the top (highest-traffic page for agents).
- `src/components/PhoneQualityBadge.tsx` — extend props with optional `onCall?: () => void`; render a phone-icon button when present.
- `src/pages/PredictionLeadsPage.tsx:407` — pass `onCall` to the existing `PhoneQualityBadge`.
- `src/pages/Orders.tsx:375`, `InboundLeadsPage.tsx:191`, `CallHistoryPage.tsx:229`, `CustomerHistoryDialog.tsx:145`, `OrderModal.tsx:415` — wrap phone in `CallButton` with the right `contextType`/`contextId`.
- `src/pages/CallHistoryPage.tsx:229` — when `log.recording_path != null` render `<RecordingPlayer logId={log.id} />` inline.
- `src/lib/api.ts` — new helpers: `apiStartCall`, `apiPatchSipId`, `apiFinalizeCall`, `apiGetActiveCall`, `apiGetRecordingUrl`.
- `supabase/migrations/<TS>_call_workspace.sql` — new (the migration above).
- `supabase/functions/api/index.ts` — add 6 routes in the /api/calls block near line 2750.

### How it actually feels for the agent

1. Login → land on `/call-station`.
2. Left panel auto-loads their next assigned lead. Right panel populates: customer name, product, value, phone, address, past 3 calls.
3. They press **Space** (or click **Call**). Bottom sheet slides up. Browser asks for microphone permission once (first call only).
4. sip.js connects to WSS, sends INVITE. Sheet pill: "Ringing".
5. Lead picks up → pill: "In progress", stopwatch starts. Audio is in the browser tab — no MaxUC opens.
6. Mute / hold via the sheet buttons if needed.
7. Lead hangs up (or agent presses **End**). Pill: "Ending". Recording continues until the SIP BYE settles.
8. Sheet expands: outcome buttons + notes box. Agent presses **Confirmed** or **Rescheduled** (+ time) etc.
9. Save → `call_logs` row written, prediction_lead status auto-updated, sheet closes. Left panel auto-advances to the next lead.

For Path I (A1 native) recordings appear on `call_logs.recording_path` automatically once A1's recording API delivers. For Path II (own PBX) the MixMonitor → upload script does the same. Either way, **no manual upload** in the steady state.

## Code reuse

- API auth+role gate pattern: copy from `POST /api/call-logs` at `index.ts:2594`.
- Realtime subscription template: copy from `NotificationsDropdown.tsx:66-75`.
- Outcome → prediction_lead status auto-update: reuse the block at `index.ts:2615` (extend the mapping for the new outcomes).
- Sheet component: existing `vaul` (`package.json:64`).
- Permission/route gating: existing `ProtectedRoute` + `PermissionsContext.MODULE_ROUTE_MAP`.

## Phasing

| Phase | Scope | Time | Owner / blocker |
|---|---|---|---|
| 0 | A1 information call (4 questions above). | ~30 min | User |
| 1 | Migration + edge routes + `WebPhoneContext` + `CallButton` + `ActiveCallSheet` + `CallStationPage` + sip.js wiring. **Static caller-ID** (single A1 number for all 3 agents).  | 4-5 days | None once Phase 0 is done |
| 2 | Recording delivery — automated. Path I: A1 API polling cron. Path II: PBX MixMonitor + signed webhook. Inline `RecordingPlayer` in `CallHistoryPage`. | 1-2 days | A1 recording feature confirmed |
| 3 | Per-agent caller-ID (if A1 issues multiple DIDs). VPN banner. Stuck-session sweeper (pg_cron ages dead sessions to `failed` after 30 min). Audit log of who-called-whom. Mute, hold, warm-transfer. | 2-3 days | A1 multi-DID confirmed |

We can start Phase 1 the moment Phase 0 returns "Path I" or "Path II". The migration, Edge function additions, and front-end work apply to both paths unchanged.

## Critical files

- `c:\Users\Mile\Desktop\elyoncrm\supabase\migrations\<TS>_call_workspace.sql` (new)
- `c:\Users\Mile\Desktop\elyoncrm\supabase\functions\api\index.ts` (extend; add routes near line 2750)
- `c:\Users\Mile\Desktop\elyoncrm\src\contexts\WebPhoneContext.tsx` (new)
- `c:\Users\Mile\Desktop\elyoncrm\src\lib\sip.ts` (new)
- `c:\Users\Mile\Desktop\elyoncrm\src\components\CallButton.tsx` (new)
- `c:\Users\Mile\Desktop\elyoncrm\src\components\ActiveCallSheet.tsx` (new)
- `c:\Users\Mile\Desktop\elyoncrm\src\components\RecordingPlayer.tsx` (new)
- `c:\Users\Mile\Desktop\elyoncrm\src\pages\CallStationPage.tsx` (new)
- `c:\Users\Mile\Desktop\elyoncrm\src\components\PhoneQualityBadge.tsx` (extend)
- `c:\Users\Mile\Desktop\elyoncrm\src\App.tsx`, `src/contexts/PermissionsContext.tsx`, `src/components/AppSidebar.tsx` (route + nav wiring)
- `c:\Users\Mile\Desktop\elyoncrm\src\lib\api.ts` (new helpers)
- All 6 phone-rendering pages listed above (wrap in `CallButton`)

## Verification

End-to-end smoke test that proves Phase 1 works:

1. `npx supabase db push` → migration applies; `\d call_logs` shows new columns; `call_sessions` table and `call-recordings` bucket exist.
2. `npx supabase functions deploy api --no-verify-jwt` → fresh edge function deployed.
3. `curl` against `/api/calls/start` with a valid Bearer token → returns `{ session_id, sip: {…} }`.
4. `npm run dev`, log in as `MileStoev`, open `/call-station`, the left pane auto-selects an assigned lead.
5. Click **Call** — Chrome prompts for mic permission (one-time), sip.js registers via WSS, INVITE is sent, the customer's phone rings. Confirm A1 caller-ID on the customer side.
6. Talk for 30s, hang up. Bottom sheet shows "Wrap up". Pick **Confirmed**, type a note, Save.
7. `select id, outcome, duration_seconds, recording_path, sip_call_id from call_logs order by created_at desc limit 1` → row exists with all fields populated; `prediction_leads.status` auto-flipped accordingly.
8. Open `/call-history` → row visible. Path I/II ready: play icon plays the recording inline.
9. RLS check: a second agent logs in, `/call-station` shows their own queue; `select * from call_logs` (via Studio masquerading as them) returns only their rows.
10. Reload `/call-station` mid-call → `apiGetActiveCall` returns the live session, the sheet rehydrates with the running stopwatch (no double-dialling).

## Risks & open questions

- **Path I availability**: A1's MetaSwitch tenant may not expose public WSS. If yes, zero infra. If no, Path II adds €8/mo VPS + 1.5 days of FreePBX provisioning to Phase 1.
- **Caller-ID per agent**: confirm with A1 whether each MaxUC extension has its own DID or all share one. Phase 1 ships with shared CLI; Phase 3 adds per-agent CLI if available.
- **Recording legal**: Bulgaria requires both-party consent. Verify the wording in `call_scripts` ("This call may be recorded for quality purposes…") with a BG lawyer before go-live.
- **NAT / corporate firewalls**: WebRTC needs UDP for media; hotel/coffee-shop NAT can block it. Mitigate by enabling TURN over TCP/443 (free Coturn on the same VPS for Path II, or A1's STUN/TURN for Path I).
- **Stuck sessions**: if the browser tab dies mid-call, the `call_sessions` row stays `in_progress` until the SIP BYE webhook lands (or doesn't). Phase 3 sweeper handles it; Phase 1 ships with a manual admin "Force-close" button.
- **VPN**: with the PBX in Bulgaria the agent's VPN is mostly defense-in-depth (in case A1 ever IP-restricts the WSS endpoint by source country). Detection in Phase 3, honor-system only.
- **Recording cost forecast**: 5 MB/5-min × 50 calls/agent/day × 2 agents × 250 working days ≈ 60 GB/year. At Supabase's $0.021/GB/mo that's ~€15/year — negligible. Plan a year-1 archive job to S3 Glacier-style cold storage when this scales to 10 agents.

## What I need before writing code

Just the Phase 0 answers from A1. Once we know "Path I or Path II", I can apply the migration, ship Phase 1, and have a working in-CRM softphone by end of week.
