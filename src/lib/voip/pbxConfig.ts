/**
 * PBX / Asterisk WebRTC connection settings.
 *
 * NOTE: Per-agent SIP credentials (extension + secret) are NO LONGER stored here.
 * They are fetched securely at login from GET /api/voip/credentials and injected
 * into the engine via RealVoipEngine.configure(). This file only holds the
 * non-secret connection defaults + the real/mock master switch.
 */

export const PBX_CONFIG = {
  // WebSocket connection defaults (the backend returns the authoritative ws_url;
  // these are only fallbacks if it's missing).
  wsHost: 'pbx.elyoncall.com',
  wsPortSecure: '443',
  wsNamespace: 'ws',
  wsUrl: 'wss://pbx.elyoncall.com/ws',

  /** Fallback caller ID if the backend doesn't supply one (it normally does). */
  defaultCallerId: '+35924234100',

  /** Master switch for real vs mock engine. */
  useRealVoip: import.meta.env.VITE_USE_REAL_VOIP === 'true',
} as const;

export type PbxConfig = typeof PBX_CONFIG;
