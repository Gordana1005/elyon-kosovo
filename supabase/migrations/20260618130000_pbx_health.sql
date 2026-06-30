-- VOIP / Telephony Health observability.
--
-- The CRM already captures call data (call_logs, missed_calls) but has zero
-- visibility into the PBX/VPS itself. These two tables hold the data the new
-- superadmin "VOIP Health" page needs that ISN'T derivable from call_logs:
--
--   pbx_health_snapshots — periodic server/PBX health pushed by a VPS cron
--     (disk, memory, load, lines in use, trunk reachability, recordings/min,
--      fail2ban bans). Drives the live cards + the historical trend charts.
--   call_quality — per-call hangup cause + RTP stats posted by an Asterisk
--     hangup hook. This is brand-new data: it's what makes "agent couldn't
--     hear the client" (one-way audio / packet loss) visible instead of silent.
--
-- Both are written by the PBX via the existing HMAC-signed webhook mechanism
-- (WEBHOOK_SECRET) and read by the Edge Function with the service role, so the
-- RLS policies below are a defence-in-depth backstop (admin-only), mirroring
-- the missed_calls table.

-- ── pbx_health_snapshots ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pbx_health_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at       timestamptz NOT NULL DEFAULT now(),
  pbx_reachable     boolean NOT NULL DEFAULT true,
  -- Parsed hot columns (indexed/queried for trends + thresholds); full payload in raw.
  disk_pct          int,          -- root filesystem % used
  rec_bytes         bigint,       -- size of /var/spool/asterisk/monitor
  mem_pct           int,          -- RAM % used
  load1             numeric,      -- 1-min load average
  asterisk_up       boolean,
  active_lines      int,          -- channels in use (cap is 10 — the A1 trunk limit; was 4 until 2026-06-29)
  max_lines         int,
  trunk_reachable   boolean,
  trunk_rtt_ms      int,
  recordings_today  int,
  newest_rec_age_s  int,          -- seconds since the newest recording (detects "recording stopped")
  banned_ips        int,          -- fail2ban currently-banned count (attacks)
  raw               jsonb,        -- full health payload as collected on the box
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pbx_health_captured ON public.pbx_health_snapshots (captured_at DESC);

ALTER TABLE public.pbx_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read pbx health"
  ON public.pbx_health_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

-- ── call_quality ───────────────────────────────────────────────────────────
-- One row per call (keyed by Asterisk uniqueid). Posted by the dialplan hangup
-- hook. one_way_audio is the headline flag (no inbound RTP / heavy loss).
CREATE TABLE IF NOT EXISTS public.call_quality (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uniqueid          text UNIQUE NOT NULL,         -- Asterisk uniqueid (dedupe)
  call_log_id       uuid,                         -- best-effort link to call_logs (may be null)
  extension         text,                         -- agent extension (1001…)
  direction         text,                         -- 'outbound' | 'inbound'
  dialed            text,                          -- the other party
  hangup_cause      int,                          -- Asterisk HANGUPCAUSE code
  hangup_cause_txt  text,
  jitter_ms         numeric,
  packet_loss_pct   numeric,
  rtt_ms            numeric,
  rxcount           int,                           -- RTP packets received (0 with txcount>0 ⇒ one-way)
  txcount           int,
  one_way_audio     boolean NOT NULL DEFAULT false,
  occurred_at       timestamptz,
  captured_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_quality_captured ON public.call_quality (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_quality_oneway ON public.call_quality (one_way_audio, captured_at DESC) WHERE one_way_audio;
CREATE INDEX IF NOT EXISTS idx_call_quality_ext ON public.call_quality (extension);

ALTER TABLE public.call_quality ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read call quality"
  ON public.call_quality FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

-- ── Module registration (superadmin-only) ──────────────────────────────────
-- voip_health is admin-only: admins bypass role_permissions via the in-code
-- canAccessModule shortcut, so no non-admin grant is created. The module_settings
-- row makes the page togglable + surfaces it in the Role Permissions UI.
INSERT INTO public.module_settings (module_key, module_label, is_enabled, is_protected) VALUES
  ('voip_health', 'VOIP / Telephony Health', true, true)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('admin', 'voip_health', true, true, true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;
