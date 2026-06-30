# Calling plan — A1 SIP trunk go‑live

> ## ✅ GONE LIVE (production, ~June 2026)
> Telephony is **live**: Path II is in production — our Sofia FreePBX/Asterisk registers A1's "Business
> Voice" SIP trunk, the browser softphone (`src/lib/voip/RealVoipEngine.ts`, sip.js) connects over WSS,
> and calls reach BG mobile/PSTN. Recordings, per‑agent extensions/caller‑ID, missed‑call inbox, and the
> `/voip-health` dashboard are all live. `src/lib/mockCalls.ts` is dead. The plan below is kept as the
> **historical go‑live record** (architecture + what was built); it is no longer a to‑do list.

> **This supersedes the old [CALLING_PLAN.md](CALLING_PLAN.md).** That file was written before the PBX
> existed and while the carrier path was undecided (A1 Cloud PBX vs Zadarma vs WebRTC). Both questions
> were answered: the PBX was built, and **A1 signed us onto its "Business Voice" SIP trunk**
> (Приложение №2 digitally signed **2026‑05‑20**), which then went live.

_Originally written 2026‑05‑23; marked live 2026‑06‑19._

---

## 1. Decision: locked

We are **Path II** — our own FreePBX/Asterisk PBX in Sofia, registering A1's **Business Voice SIP trunk**.
The browser softphone connects to our PBX over WSS; our PBX carries the SIP/RTP leg to A1; A1 terminates
to the BG mobile/PSTN. The Sofia BG IP makes A1 see the traffic as domestic — the whole reason for the VPS.

```
[Agent browser, Strumica]            [Sofia VPS]                 [A1 Business Voice]      [BG customer]
 sip.js softphone  ── WSS ──►  Asterisk 20 + FreePBX 16  ── SIP/RTP ──► A1 SIP TRUNK ── PSTN ──► mobile
 (3 WebRTC extensions)         wss://pbx.elyoncall.com:8089/ws          4 channels, 10 DIDs
```

---

## 2. The A1 "Business Voice" contract (signed)

From `sip-trunk-stuff/` (contract + Приложение №1 technical params + Приложение №2 pricing), entity
**НАТУРА ТЕРАПИ ЕООД (Natura Therapy EOOD)**:

| Item | Value |
|---|---|
| Product | A1 **Business Voice** — SIP trunk to the customer's PBX |
| PSTN termination protocol | **SIP** |
| Concurrent calls (channels) | **4** |
| Numbers (DIDs) included | **10** (fixed + mobile ranges — exact numbers provisioned separately) |
| Included minutes | **5,000 min/month** to national fixed + Intl Zone 1‑2 |
| Monthly fee | **€160.03 / 312.99 лв** (ex‑VAT) |
| Install fee | €0 |
| Per‑minute (out of bundle) | Business calls €0.03; mobile outside VPN €0.06; per‑second billing **after first 60 s** |
| Registered service location | ул. Атанас Лютвиев №20, гр. Петрич, 2850 (Petrich, BG) |
| Interface | Ethernet 10/100 Base‑T, SIP trunk configured over A1's network |
| Support / NOC | short number **1515** (trouble‑ticket line) |
| Signed (operator side) | Boyan Lyubomirov Kabakchiev, **2026‑05‑20** |

**What this means for us:** 4 simultaneous calls is enough for 3 agents (peak concurrency ~3). 10 DIDs lets
us give each agent their own BG caller‑ID later (per‑agent CLI). The Petrich registered address satisfies
the "BG address" requirement; the PBX itself stays in Sofia.

> **Still pending from A1:** the actual SIP credentials/registration details — registrar host, SIP
> username/password (or IP auth), the assigned DID numbers, allowed source IP, and codec confirmation.
> Expected within days. **Send those verbatim to whoever implements** and Path II completes in minutes
> of FreePBX GUI work + the frontend swap below.

---

## 3. What is already built (no further work needed)

### Telephony infrastructure (Sofia VPS) — see [../PBX-SETUP.md](../PBX-SETUP.md)
- AlphaVPS Sofia, AlmaLinux 8.10, `pbx.elyoncall.com` → `104.152.48.222`, 2 vCPU / 8 GB / 60 GB.
- **Asterisk 20.19.0 LTS** from source: PJSIP + Opus + `res_http_websocket` + DTLS‑SRTP.
- **FreePBX 16.0.45** UI at `https://pbx.elyoncall.com`.
- **WSS endpoint live**: `wss://pbx.elyoncall.com:8089/ws` with a real Let's Encrypt cert (auto‑renew → Asterisk).
- Pre‑staged: `/etc/asterisk/pjsip.transports_custom.conf` defines `wss-transport`; `/root/A1-TRUNK-TEMPLATE.txt`
  and `/root/WEBRTC-EXTENSION-TEMPLATE.txt` document exactly which FreePBX fields to fill.
- Hardened: SSH key‑only, fail2ban, firewalld, auto‑updates, SELinux Permissive.

### CRM software (already production‑wired around the mock)
- **`VoipContext`** ([../src/contexts/VoipContext.tsx](../src/contexts/VoipContext.tsx)) — the swap seam.
  Its consumer surface (`startCall`, `hangup`, `endCall`, `confirmCall`, `state`, `call`, `lastFinished`)
  is final; only the implementation behind it changes.
- **Telemetry is real**: `POST /call-logs` already stores `started_at`/`connected_at`/`ended_at`/
  `connection_state`; columns `ring_seconds`/`talk_seconds`/`total_seconds` exist. Analytics already read
  `talk_seconds`/`connection_state` ([INSIGHTS_ANALYTICS.md](INSIGHTS_ANALYTICS.md)).
- **Outcome → order status** (`applyOutcomeToOrder`), queue auto‑pick, TAKE soft‑lock, two‑level outcome
  picker, notes boards, and the Recordings shell are all done. See [CALLS.md](CALLS.md).

So the only missing pieces are: (a) plug A1 creds into FreePBX, (b) replace the mock dialer with sip.js,
(c) wire recordings.

---

## 4. Phase 1 — go live on real audio (when A1 creds arrive)

### Step 1 — FreePBX (≈15 min, GUI, on the VPS)
1. **Connectivity → Trunks → Add SIP (chan_pjsip) Trunk** "A1-BusinessVoice". Fill from `/root/A1-TRUNK-TEMPLATE.txt`
   using A1's registrar host, username/password (or IP auth), and the allowed source IP. Codecs: alaw + Opus; DTMF RFC2833.
2. **Outbound Route** "A1-out" → dial patterns for BG mobile/national → A1 trunk. Set the default outbound
   caller‑ID to one of the 10 DIDs.
3. **Inbound Route(s)** for the DIDs (optional now; needed if customers call back / for IVR).
4. **Applications → Extensions → Add 3 PJSIP extensions** `1001/1002/1003` (one per agent) from
   `/root/WEBRTC-EXTENSION-TEMPLATE.txt`: **WebRTC = Yes**, transport `wss-transport`, media encryption DTLS,
   AVPF/ICE on. Note each extension's secret.
5. Verify: `asterisk -rx "pjsip show registrations"` (trunk registered), `pjsip show endpoints` (extensions),
   then a test call to a mobile from the FreePBX "Echo"/originate or a softphone.

### Step 2 — CRM softphone (replace the mock; ≈1–2 days)
- Add `sip.js` (or `jssip`) to the frontend.
- New `src/lib/sip.ts` — thin wrapper: `createUserAgent({ wsUrl, uri, password })`, `dial(target)`,
  `hangup`, `mute`, mapping SIP events → the existing `VoipContext` states (`idle/dialing/in_call/wrapping/ending`).
- Rewrite the **mock answer timer** in `VoipContext.startCall()` to drive a real `Inviter`; set
  `connected_at` on SIP **answered**, `ended_at` on **BYE**, and pass the true `connection_state`
  (answered/no_answer/busy/failed/voicemail) into `finalize()`. **Keep `apiLogCall(...)` exactly as is** —
  the telemetry contract doesn't change.
- Connection target: `wss://pbx.elyoncall.com:8089/ws`. Each browser registers as one of `1001/1002/1003`.
- **Credential delivery:** do **not** hardcode SIP secrets in the browser bundle. Add a small authed
  endpoint (e.g. `GET /calls/sip-credentials`) that returns the caller's extension `{ ws_url, uri, password,
  caller_id }` from Edge‑Function env/secrets, mapped by user. (Short‑lived creds are nicer but a static
  per‑extension secret behind auth is acceptable for 3 agents.)
- Microphone permission is requested by the browser on first dial.

### Step 3 — verify Phase 1
1. `asterisk -rx "pjsip show registrations"` shows the A1 trunk **Registered**.
2. Log in as an agent on `/calls`, pick a customer, **Dial** → Chrome asks for mic once → customer's BG
   mobile rings showing an **A1 BG caller‑ID** → talk → End → pick outcome → `call_logs` row has real
   `connection_state` + durations, and the order status flipped correctly.
3. A second agent dials simultaneously (2 channels in use) without contention; confirm ≤4 concurrent.

---

## 5. Phase 2 — call recordings

A1 Business Voice is a trunk (recording is our responsibility), so record on **our** PBX:
1. Enable **MixMonitor** on the outbound route / extensions → WAV per call in `/var/spool/asterisk/monitor`.
2. Create the **`call-recordings`** Supabase Storage bucket (private) + RLS (owner agent + admin read;
   service‑role write).
3. Small uploader on the VPS (cron or post‑call hook) → POST the WAV to a new authed/HMAC endpoint
   (`POST /webhook/pbx` recording event) → upload to the bucket, set `call_logs.recording_path`.
   *(Optionally add a `call_sessions` table for live in‑flight state + a `recording_path` column already
   anticipated in the old plan; with only 3 agents the `call_logs`‑based approach is sufficient.)*
4. Populate [../src/pages/RecordingsPage.tsx](../src/pages/RecordingsPage.tsx) for real: replace the
   `mockCalls.ts` placeholder with `GET /calls/:id/recording-url` (1‑hour signed URL) and an `<audio>` player
   in Call History.

**Legal:** Bulgaria requires call‑recording consent — add the consent line to `call_scripts` and verify
wording before go‑live.

---

## 6. Phase 3 — polish (optional, after steady state)
- **Per‑agent caller‑ID** using the 10 DIDs (each extension presents its own BG number).
- Mute / hold / warm transfer.
- Stuck‑session sweeper (age dead in‑flight sessions to `failed`).
- Voicemail‑to‑email (FreePBX mail queue currently unconfigured — flagged, not blocking).
- Second VPS for redundancy only if volume outgrows one box (current handles 20+ concurrent; we use ~3).

---

## 7. Volumes & cost (for sizing)
- ~25–30k outbound minutes/year. 3 agents, ~6–8 h dial‑time/agent/active day. Peak concurrency ~3 (4 channels = headroom).
- Fixed infra ≈ **€84/yr** (Sofia VPS) + domain. Carrier: **A1 Business Voice €160.03/mo ex‑VAT** incl. 5,000 min + 10 DIDs.
- Twilio was rejected (BG mobile termination ~$0.21/min ≈ €20k/yr, and no BG mobile DIDs). Zadarma was a
  parallel fallback, now moot — A1 signed.

---

## 8. Quick reference (when you sit down to implement)

```bash
# On the PBX (SSH):
ssh -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222
scp -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222:/root/A1-TRUNK-TEMPLATE.txt .
scp -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222:/root/WEBRTC-EXTENSION-TEMPLATE.txt .
asterisk -rx "pjsip show registrations"      # trunk status after entering A1 creds
asterisk -rx "pjsip show endpoints"          # the 3 WebRTC extensions
```

- PBX ops & traps: [../PBX-SETUP.md](../PBX-SETUP.md) (Apache user must be `asterisk`, PHP 7.4, SELinux
  Permissive, only `*_custom.conf` for custom additions).
- Frontend swap point: `VoipContext` only. Don't refactor the Calls page first ([CALLS.md](CALLS.md) §8).
- Secrets you'll receive from A1 go into [VAULT.md](VAULT.md) (local) and FreePBX — **never** the browser bundle.
