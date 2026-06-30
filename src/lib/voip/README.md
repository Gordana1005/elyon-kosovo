# Real WebRTC Calling (A1 SIP Trunk)

This folder contains the real browser-based SIP/WebRTC implementation.

## Current Status
- Early implementation phase started.
- Goal: Make real outbound (and later inbound) calls directly from the CRM browser using our Asterisk (extensions 1001-1004) → a1-bulgaria trunk.

## How to Enable Real Calling

1. Create a `.env.local` (or update your existing `.env`) file in the project root with:

   ```env
   VITE_USE_REAL_VOIP=true
   ```

2. In `src/lib/voip/RealVoipEngine.ts`, replace the placeholder secret:

   ```ts
   const secret = 'REPLACE_WITH_EXTENSION_SECRET';
   ```

   Use the actual secret of the extension you want to register as (e.g. 1001 during initial testing).

3. Restart the dev server (`npm run dev`).

4. The CRM will now attempt to register to the PBX over WSS when you try to make a call.

## Important Notes

- The first implementation focuses on **outbound calling**.
- Inbound call handling (ringing in the browser when someone calls one of your DIDs) will be added in a follow-up phase.
- The UI (CallsPage, ActiveCallWidget, outcome picker, etc.) remains completely unchanged. Only the engine behind `VoipContext` is swapped.

## Testing Order (Recommended)

1. First validate the PBX works using a normal softphone (MicroSIP / Zoiper) with one of the extensions.
2. Then enable real mode in the CRM and test outbound calling from the browser.
3. Once basic outbound works reliably, we add inbound + the "Choose Outgoing Number" feature.

## Files

- `pbxConfig.ts` — Connection settings and feature flag.
- `RealVoipEngine.ts` — The actual SIP.js implementation (work in progress).
