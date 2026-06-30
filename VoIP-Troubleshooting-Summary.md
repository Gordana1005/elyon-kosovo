# VoIP Troubleshooting Summary – Elyon CRM + A1 SIP Trunk + Browser WebRTC

**Date Range:** May 2026 (ongoing session)  
**Goal:** Enable stable browser-based WebRTC calling from the Elyon CRM (www.elyoncall.com) using sip.js, connected to the production Asterisk 20 + FreePBX 16 PBX, with outbound calls via the A1 Bulgaria SIP trunk.

---

## Executive Summary

The project evolved from severe WebSocket and client-side failures to a state where the signaling path can occasionally reach 101 Switching Protocols. However, calls still die quickly after "dialing" due to WSS connection instability during INVITE/SDP negotiation.

**Major Wins Achieved:**
- WebRTC endpoints (1001–1004) now register over a dedicated `wss-public` transport.
- Apache reverse proxy for `/ws` cleaned up and capable of successful upgrades in some attempts.
- A1 trunk correctly pointed at the proper SBC (`sbc-nature-thrp.a1.bg` / 195.149.255.243) with TCP transport.
- Client-side code (`RealVoipEngine.ts`) partially modernized to sip.js 0.21+ patterns (Registerer + Inviter + stateChange).

**Current Blocking Issue:**
The WSS contact for the WebRTC endpoint collapses ("Broken pipe", "shutdown", endpoint goes Unreachable) the moment a real INVITE is sent. This prevents stable SDP negotiation and call completion.

---

## Background

- **PBX:** Asterisk 20 + FreePBX 16 on VPS (104.152.48.222)
- **Trunk:** A1 Bulgaria – IP-authenticated, TCP 5061 to SBC `sbc-nature-thrp.a1.bg` (195.149.255.243)
- **Client:** Browser-based calling via sip.js (target: sip.js 0.21.2)
- **Proxy:** Apache 2.4 on the public domain with `ProxyPass /ws → wss://127.0.0.1:8089/ws`
- **Extensions:** 1001–1004 (Mile, Miki, Boris, Ilija) – must use WebRTC over WSS

---

## Timeline of Major Issues & Fixes

### Phase 1: Initial State – Complete Failure
- WebSocket connections failing with code 1006 immediately.
- No registration visible on Asterisk.
- Heavy client-side errors from outdated sip.js usage in `RealVoipEngine.ts` (`userAgent.on`, `userAgent.invite`).
- Apache proxy config heavily corrupted with conflicting ProxyPass rules from earlier experiments.

### Phase 2: Apache Reverse Proxy Hell
- Multiple full rewrites of `/etc/httpd/conf.d/pbx-elyoncall.conf`.
- Issues: Missing Upgrade/Connection headers, no `ProxyPreserveHost`, insufficient timeouts, SSLProxy directives in wrong context, duplicate Location blocks.
- Repeated "Broken pipe" and contact removal errors on Asterisk side.
- Eventually reached a cleaner state with proper headers and `ProxyTimeout 3600`.

### Phase 3: Asterisk WSS Transport & Endpoint Configuration
- Created dedicated `wss-public` transport (port 8089) with correct external signaling/media addresses and Let's Encrypt certs (via renewal hook).
- Forced extensions 1001–1004 to use `transport=wss-public` via `pjsip_custom_post.conf` (GUI only offered UDP).
- Added `direct_media=no` + `webrtc=yes` after repeated SDP negotiation failures ("Couldn't negotiate stream").
- Restricted codecs to `ulaw,alaw` only (removed opus) on both endpoints and A1 trunk.

### Phase 4: Trunk Configuration (A1)
- Initially missing or incorrectly configured A1 trunk.
- A1 support clarified: outbound calls must target `sbc-nature-thrp.a1.bg` (195.149.255.243) on TCP 5061.
- Created `tcp-public` transport on 5061.
- Forced A1 trunk (`a1-bulgaria`) to use `transport=tcp-public` via custom post file.
- Outbound CallerID set on trunk (one of the professional DIDs).

### Phase 5: Client-Side Code Modernization (Ongoing)
- Original `RealVoipEngine.ts` used pre-0.20 sip.js event API.
- Partial rewrite to 0.21+:
  - Proper `UserAgent` + `Registerer` + `Inviter`
  - `stateChange` listeners instead of `.on()`
  - `ensureRegistered()`, `dispose()`, registration retry, transport reconnection logic
  - Added `onRegistrationChange` and `onError` callbacks
- Proactive registration added in `VoIPContext.tsx`
- Secret moved to centralized `pbxConfig.ts`

---

## Current Status (as of 30 May 2026)

### What Works
- Extensions 1001–1004 register over WSS (`wss-public` transport).
- Apache can perform WebSocket upgrades (101 seen in Network tab on some attempts).
- A1 trunk correctly configured for the new SBC with TCP transport.
- Client no longer crashes with the old `userAgent.on` / `invite` errors on every attempt (when using updated code).
- Calls reach "dialing" state in the UI.

### What Still Fails
- Calls almost always end within seconds of "dialing".
- WSS contact for 1001 is repeatedly destroyed ("due to shutdown") the moment an INVITE is sent.
- Endpoint 1001 flaps between Reachable ↔ Unreachable during call attempts.
- "Broken pipe" SSL errors and "Couldn't negotiate stream" persist in many attempts.
- No stable registration + INVITE flow that survives to the A1 trunk in a usable way.

---

## Root Cause Summary

The fundamental remaining issue is **instability of the WSS signaling path** during actual SIP signaling.

Even after:
- Clean Apache proxy configuration
- Correct WSS + TCP transports
- `direct_media=no` + `webrtc=yes`
- Codec restrictions
- Modern client code

...the WebSocket connection between the browser (via Apache) and Asterisk collapses under the load of an INVITE + SDP negotiation. This prevents the call from ever completing successfully.

---

## Key Files Modified (Summary)

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/voip/RealVoipEngine.ts` | Client engine (registration + calls) | Partially modernized (Registerer + Inviter) |
| `src/contexts/VoipContext.tsx` | Wiring + proactive registration | Updated with new callbacks |
| `src/lib/voip/pbxConfig.ts` | Centralized config + secret | Cleaned |
| `/etc/httpd/conf.d/pbx-elyoncall.conf` | Apache /ws proxy | Multiple cleanups – currently clean |
| `/etc/asterisk/pjsip.transports_custom.conf` | wss-public + tcp-public | Created |
| `/etc/asterisk/pjsip_custom_post.conf` | Force transports on extensions + trunk | Heavily used |
| `/etc/asterisk/pjsip.endpoint_custom_post.conf` | Endpoint flags (`direct_media`, `webrtc`, codecs) | Used for overrides |

---

## Recommendations / Next Steps

### Immediate (for testing)
1. Deploy the current version of the updated `RealVoipEngine.ts` + `VoipContext.tsx` to production (with `VITE_USE_REAL_VOIP=true`).
2. Perform a hard cache clear or incognito test.
3. Capture one clean `asterisk -rvvv` + `pjsip set logger on` trace during a failing call.
4. Capture the exact Apache error log at the same second (with debug logging enabled).

### Short Term – Increase WSS Stability
- On Asterisk `wss-public` transport, ensure these settings are present:
  ```ini
  websocket_write_timeout=10000
  keep_alive_interval=30
  ```
- Consider increasing Apache `ProxyTimeout` further or adding wstunnel-specific tuning if still unstable.

### Medium Term
- Evaluate moving the WebRTC signaling termination closer to Asterisk (e.g., dedicated nginx or direct exposure with proper security) if Apache proxy instability continues.
- Implement proper per-user SIP credentials instead of the shared secret.
- Add UI feedback for registration state using the new `onRegistrationChange` callback.

### Long Term
- Consider a more robust WebRTC solution (e.g., official FreePBX UCP WebRTC or a dedicated softphone gateway) if the current stack remains too fragile for production use.

---

**Last Updated:** 30 May 2026  
**Status:** Wire layer significantly improved. Client code modernized but not yet fully deployed in production. Fundamental WSS connection stability during call setup remains the active blocker.

---

*This document was generated to consolidate the long troubleshooting session for future reference.*

---

## ✅ RESOLVED — 30 May 2026 (live SSH session)

The entire "WSS collapses on INVITE" saga had **one** root cause, and it was infrastructure, not client code:

### Root cause 1 — WSS server (8089) never bound
- Asterisk runs as the `asterisk` user but `http_additional.conf` (FreePBX-generated) pointed `tlsprivatekey` at `/etc/letsencrypt/live/pbx.elyoncall.com/privkey.pem`.
- That whole LE tree is `drwx------ root:root` → Asterisk got **"Permission denied"** loading the key → the TLS WebSocket server **silently failed to bind 8089**.
- Apache was proxying `/ws → wss://127.0.0.1:8089/ws` — **to a dead port**. That is the "Broken pipe / contact destroyed the moment an INVITE is sent."
- The pjsip transport's `cert_file`/`priv_key_file` are **ignored** for websockets (log: *"TLS certificate values ignored for websocket transport as they are configured in http.conf"*). The HTTP server's cert is authoritative.

**Fix:** granted `asterisk` read access to the LE certs via ACL (durable across renewals):
```bash
setfacl -m u:asterisk:rx /etc/letsencrypt/live /etc/letsencrypt/archive
setfacl -m u:asterisk:r  /etc/letsencrypt/archive/pbx.elyoncall.com/privkey1.pem
setfacl -d -m u:asterisk:r /etc/letsencrypt/archive/pbx.elyoncall.com   # future renewals inherit
```
(`http_custom.conf` was also repointed to `/etc/asterisk/certs/{fullchain,privkey}.pem` as a belt-and-suspenders fallback.) After `fwconsole restart`: `HTTPS Server Enabled and Bound to 0.0.0.0:8089`, and `/ws` returns **101** on both the direct `:8089` and Apache `:443` paths.

### Root cause 2 — A1 trunk required TLS, was configured as plain TCP
- A1's SBC `sbc-nature-thrp.a1.bg:5061` **speaks TLS** (verified: serves a Sectigo cert, clean handshake). "TCP 5061" in earlier notes was wrong — 5061 is the TLS port.
- The trunk used a plain `tcp-public` transport → A1's inbound TLS connections logged *"no request received in 32s"* and our outbound qualify got no answer → trunk `Unavailable`.

**Fix:** replaced `tcp-public` with a `tls-public` transport (protocol=tls, bind `0.0.0.0:5061`, certs from `/etc/asterisk/certs/`, verify off) and forced the trunk onto it in `pjsip_custom_post.conf`. Trunk is now **Reachable (RTT ~120 ms)**.

### Still to validate
- Live browser registration (1001–1004) + a real test call through A1 to a BG mobile.
- If a connected call has no/one-way audio, A1 likely wants **SRTP** → set `media_encryption=sdes` on the trunk.
- Per-user SIP credentials instead of the shared secret in `pbxConfig.ts`.

**Config backups on the VPS:** `*.bak-precertfix` (http_custom) and `*.bak-pretls` (transports + custom_post).