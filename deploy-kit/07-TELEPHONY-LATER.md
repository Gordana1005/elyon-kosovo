# 07 — Telephony (Phase 2, deferred)

Phase 1 ships a fully usable CRM with **manual call logging and no dialer**
(`VITE_USE_REAL_VOIP=false`). Add real calling when the business is ready and a Macedonia trunk is
sorted. This is the **biggest infrastructure piece** and the main recurring cost.

The Bulgarian telephony stack is fully documented and battle-tested — reuse it as the blueprint:

- [`../PBX-SETUP.md`](../PBX-SETUP.md) — VPS + FreePBX + A1 + TLS + ops commands
- [`../docs/telephony/RUNBOOK.md`](../docs/telephony/RUNBOOK.md) — smoke test, inventory, restore-from-zero
- [`../docs/telephony/MONITORING.md`](../docs/telephony/MONITORING.md) — the VOIP Health dashboard + PBX collectors
- [`../docs/telephony/RECORDING_LINKAGE.md`](../docs/telephony/RECORDING_LINKAGE.md) — how recordings link to call logs
- [`../A1-TRUNK-TEMPLATE.txt`](../A1-TRUNK-TEMPLATE.txt) + [`../WEBRTC-EXTENSION-TEMPLATE.txt`](../WEBRTC-EXTENSION-TEMPLATE.txt) — exact FreePBX fields
- Rule of law: [`../.grok/skills/elyon-voip-and-pbx/SKILL.md`](../.grok/skills/elyon-voip-and-pbx/SKILL.md)

---

## What you need to buy / decide

| Item | Notes |
|---|---|
| **SIP trunk** (Macedonia/Albania carrier) | The unknown. Options to evaluate: **IPKO**, **Vodafone**, **Albtelecom**, or any SIP/VoIP wholesaler that serves +383. You need: SBC address, auth type (IP-auth vs user/pass), concurrent-channel limit, codecs. (BG uses A1 "Business Voice": IP-auth, TLS:5061, 4 channels, G.711.) |
| **DID numbers (+383)** | The numbers customers see / that ring in. Buy a small pool from the trunk carrier. |
| **A VPS** | New box (recommended for independence) or reuse the Sofia box. Specs like BG: ~2 vCPU / 8 GB / small SSD; AlmaLinux/Debian. |
| **A PBX hostname** | e.g. `pbx.elyon-mk.com`, DNS → the VPS IP. |
| **TLS cert** | Free Let's Encrypt for the PBX host (needed for WSS browser audio + trunk TLS). |

> **Cheapest shortcut:** *reuse the Sofia PBX* (point Macedonia CRM at `pbx.elyoncall.com`). It
> works, but it couples the two operations and routes through Bulgarian infrastructure/numbers —
> generally **not** recommended for a clean, independent Macedonia brand. A dedicated Macedonia PBX +
> trunk is the proper path.

---

## Build outline (mirrors Bulgaria)

1. **Provision the VPS**; install Asterisk + FreePBX (follow [`../PBX-SETUP.md`](../PBX-SETUP.md)).
2. **DNS + TLS**: point `pbx.elyon-mk.com` → VPS; issue Let's Encrypt; copy cert to Asterisk
   (renewal hook), so `wss://pbx.elyon-mk.com:8089/ws` is valid.
3. **Configure the trunk** with the Macedonia carrier's details (template:
   [`../A1-TRUNK-TEMPLATE.txt`](../A1-TRUNK-TEMPLATE.txt)). Set codecs to what the carrier wants
   (likely G.711); enable SRTP if required.
4. **Create WebRTC extensions** per agent (template:
   [`../WEBRTC-EXTENSION-TEMPLATE.txt`](../WEBRTC-EXTENSION-TEMPLATE.txt)); DTLS-SRTP on.
5. **Inbound routing**: point the +383 DIDs at a ring group → the agent extensions.
6. **Recording webhook**: set `REC_SHARED_SECRET` (Supabase secret + PBX) and wire the hangup
   hook that posts to `/api/webhook/recording` (see RECORDING_LINKAGE.md).
7. **Health collectors**: deploy the PBX-side health/recording PHP + cron (MONITORING.md), and
   update the recording/health host URLs in the Edge Function (Group B in
   [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md)).

---

## Code switch-on (the Group B edits from file 06)

Once the Macedonia PBX answers:

1. Apply **Group B** edits in [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md): replace
   every `pbx.elyoncall.com` and the Sofia DID list with the Macedonia host + +383 numbers.
2. Set `VITE_USE_REAL_VOIP=true` in Vercel and redeploy.
3. Smoke test per [`../docs/telephony/RUNBOOK.md`](../docs/telephony/RUNBOOK.md) §1:
   browser → +383 test call → confirm two-way audio + a recording that links to the call log.

➡ Next: [08-SECRETS-TEMPLATE.md](08-SECRETS-TEMPLATE.md)
