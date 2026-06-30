-- Per-agent telephony identity (Phase 2).
--
-- Today every browser registers as the SAME SIP extension (1001) with one
-- secret baked into the JS bundle, so only one agent can be on VoIP at a time
-- and the secret is exposed. This table is the source of truth that maps PBX
-- extensions <-> CRM users and the caller-IDs they present. The browser fetches
-- ONLY its own row (incl. secret) via GET /api/voip/credentials — secrets are
-- NEVER returned by any list endpoint.
--
-- Keyed by EXTENSION so the pool (unassigned extensions, user_id NULL) and
-- assigned extensions live in one table. SIP *extensions* are unlimited; the A1
-- trunk only caps *simultaneous calls* (10 since 2026-06-29; was 4 at launch).

CREATE TABLE IF NOT EXISTS public.telephony_extensions (
  extension            text PRIMARY KEY,                                -- e.g. '1001'..'1020'
  sip_secret           text NOT NULL,                                   -- SERVER-ONLY; mirrors the PBX secret; never in list endpoints
  user_id              uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = available in pool
  primary_caller_id    text NOT NULL DEFAULT '+35924234100',            -- the ".100" — what the main Call button presents
  secondary_caller_id  text,                                            -- topbar "dial new number" DID; NULL => global default
  caller_id_locked     boolean NOT NULL DEFAULT false,                  -- if true only admins can change this agent's caller-IDs
  label                text,                                            -- e.g. agent display name / note
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telephony_extensions_user ON public.telephony_extensions (user_id);

ALTER TABLE public.telephony_extensions ENABLE ROW LEVEL SECURITY;

-- Admins (superadmins) manage everything directly. Everyone else goes through
-- the Edge Function (service role), which returns only the caller's own secret.
CREATE POLICY "Admins manage telephony_extensions"
  ON public.telephony_extensions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

-- A user may read their OWN row (RLS), but the secret is excluded from clients
-- by always selecting through the public view below (or the Edge Function).
CREATE POLICY "Users read own telephony row"
  ON public.telephony_extensions FOR SELECT
  USING (user_id = auth.uid());

-- Public-safe view: everything EXCEPT sip_secret. Used by admin UIs + self-reads.
CREATE OR REPLACE VIEW public.telephony_extensions_public AS
  SELECT extension, user_id, primary_caller_id, secondary_caller_id,
         caller_id_locked, label, created_at, updated_at
  FROM public.telephony_extensions;
ALTER VIEW public.telephony_extensions_public SET (security_invoker = true);
GRANT SELECT ON public.telephony_extensions_public TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_telephony_extensions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_telephony_extensions_updated_at ON public.telephony_extensions;
CREATE TRIGGER trg_telephony_extensions_updated_at
  BEFORE UPDATE ON public.telephony_extensions
  FOR EACH ROW EXECUTE FUNCTION public.touch_telephony_extensions_updated_at();
