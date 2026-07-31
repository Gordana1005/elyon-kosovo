-- Affiliate/CPA program — step 2 of 4: core tables, RLS, permission seeds.
--
-- AlterCPA-Moe-style affiliate program: external webmasters send leads via a
-- public key-authed API (Increment 2), the call center works them as normal
-- pending orders (source_type='affiliate'), and status changes fire postbacks
-- back to the affiliate's tracker (Increment 3, tables in 20260801000200).
--
-- Design decisions (operator, 2026-07-09):
--   * Affiliates get REAL Supabase logins with the new 'affiliate' role; their
--     S2S api_key is a separate credential used only by the intake API.
--   * Payout is earned ONLY at orders.status='paid' (buyout / hold-until-cash,
--     the same gate as agent commissions). It is snapshotted per lead at intake
--     (affiliate_leads.payout_eur_snapshot) so later offer edits never rewrite
--     history. This is a SEPARATE money concept from the internal per-package
--     agent bonus — never mix it into calcAgentBonus/orderPackageBonus.
--   * Managers are read-only on the admin surface; the edge function enforces
--     that (RLS here is the PostgREST backstop, per house convention).
--
-- Orders table gets NO new columns: the affiliate linkage lives in
-- affiliate_leads (1:1 by order_id), and intake reuses the existing
-- (external_source, external_order_id) partial-unique index for idempotency
-- with external_source = 'affiliate:<code>'.

-- ── 1) Admins must NOT auto-receive the 'affiliate' role ──────────────────────
-- admin_grant_all_roles() grants every enum value to admins (20260519100000).
-- 'affiliate' is an external identity, not an operator capability: an admin
-- holding it would show up in affiliate-scoped queries. Exclude it.
CREATE OR REPLACE FUNCTION public.admin_grant_all_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.app_role;
BEGIN
  IF NEW.role = 'admin' THEN
    FOR r IN
      SELECT unnest(enum_range(NULL::public.app_role))
      EXCEPT
      SELECT unnest(ARRAY['admin'::public.app_role, 'affiliate'::public.app_role])
    LOOP
      INSERT INTO public.user_roles(user_id, role)
      VALUES (NEW.user_id, r)
      ON CONFLICT (user_id, role) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- Defensive cleanup: strip 'affiliate' from anyone who also holds 'admin'
-- (covers an admin created in the window between step 1 and this file).
DELETE FROM public.user_roles ur
WHERE ur.role = 'affiliate'
  AND EXISTS (
    SELECT 1 FROM public.user_roles a
    WHERE a.user_id = ur.user_id AND a.role = 'admin'
  );

-- ── 2) Tables ─────────────────────────────────────────────────────────────────

-- One row per webmaster. api_key is the S2S intake credential ('aff_'+64 hex,
-- generated app-side like the leaderboard tokens); user_id links the portal
-- login. code is a short stable slug used in orders.external_source
-- ('affiliate:<code>') and never renamed once leads exist.
CREATE TABLE public.affiliates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  contact          text,
  api_key          text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','banned')),
  postback_url     text,
  postback_enabled boolean NOT NULL DEFAULT false,
  postback_events  jsonb NOT NULL DEFAULT '{"lead":true,"hold":true,"approve":true,"cancel":true,"trash":true,"return":true}'::jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- What affiliates can run: one product per offer, payout in EUR (currency law:
-- store EUR only; in Macedonia the denar shown to customers is derived at
-- display time from the frozen MKD_PER_EUR constant — affiliate payouts stay
-- EUR because partner networks are priced in EUR). Offers are retired via
-- is_active=false, never deleted (leads reference them).
CREATE TABLE public.offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid REFERENCES public.products(id) ON DELETE SET NULL,
  name        text NOT NULL,
  geo         text NOT NULL DEFAULT 'MK',   -- Macedonia (upstream default is 'BG')
  payout_eur  numeric(10,2) NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  description text,
  terms       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-affiliate offer approval + optional payout override. An affiliate may
-- only send leads for offers with an 'approved' row here.
CREATE TABLE public.affiliate_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id        uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  offer_id            uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','paused')),
  payout_override_eur numeric(10,2),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, offer_id)
);

-- 1:1 sidecar of an affiliate-sourced order: the tracking payload (their
-- ext_id, clickid, sub1-5) plus the payout snapshot. Keeping this OFF the
-- orders table keeps the call-center flow untouched.
CREATE TABLE public.affiliate_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id        uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  offer_id            uuid NOT NULL REFERENCES public.offers(id),
  order_id            uuid UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  ext_id              text,
  clickid             text,
  sub1                text,
  sub2                text,
  sub3                text,
  sub4                text,
  sub5                text,
  ip                  text,
  ua                  text,
  country             text,
  payout_eur_snapshot numeric(10,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Their id is idempotent per affiliate (resends return 'duplicate').
CREATE UNIQUE INDEX uniq_affiliate_leads_ext
  ON public.affiliate_leads (affiliate_id, ext_id) WHERE ext_id IS NOT NULL;
CREATE INDEX idx_affiliate_leads_affiliate_created
  ON public.affiliate_leads (affiliate_id, created_at DESC);

-- updated_at bumpers (same helper the orders table uses)
CREATE TRIGGER trg_affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_offers_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3) RLS ────────────────────────────────────────────────────────────────────
-- The edge function (service role) is the primary gate and re-checks roles in
-- code; these policies are the backstop for direct PostgREST access.

CREATE OR REPLACE FUNCTION public.get_my_affiliate_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.affiliates WHERE user_id = auth.uid()
$$;

ALTER TABLE public.affiliates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_leads  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and managers manage affiliates" ON public.affiliates
  FOR ALL TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));
-- Own row only, read-only (api_key is the owner's own credential).
CREATE POLICY "Affiliate reads own row" ON public.affiliates
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins and managers manage offers" ON public.offers
  FOR ALL TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));
CREATE POLICY "Affiliates read active offers" ON public.offers
  FOR SELECT TO authenticated
  USING (is_active AND public.get_my_affiliate_id() IS NOT NULL);

CREATE POLICY "Admins and managers manage affiliate_offers" ON public.affiliate_offers
  FOR ALL TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));
CREATE POLICY "Affiliate reads own approvals" ON public.affiliate_offers
  FOR SELECT TO authenticated
  USING (affiliate_id = public.get_my_affiliate_id());

CREATE POLICY "Admins and managers manage affiliate_leads" ON public.affiliate_leads
  FOR ALL TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));
CREATE POLICY "Affiliate reads own leads" ON public.affiliate_leads
  FOR SELECT TO authenticated
  USING (affiliate_id = public.get_my_affiliate_id());

-- ── 4) Module + permission seeds ─────────────────────────────────────────────
-- role_permissions.role is TEXT, so no enum dependency here. Managers get the
-- admin module read-only (mutations are admin-gated in the edge function).
-- NO role_privacy row for 'affiliate' on purpose: absent row = every privacy
-- flag false, which is exactly what an external identity should have.
INSERT INTO public.module_settings (module_key, module_label, is_enabled, is_protected) VALUES
  ('affiliate_portal', 'Affiliate Portal',   true, false),
  ('affiliates_admin', 'Affiliates (Admin)', true, false)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('affiliate', 'affiliate_portal', true, false, false, false, false),
  ('manager',   'affiliates_admin', true, false, false, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- Intake phone-dedupe window (hours); admin-tunable via app_settings.
INSERT INTO public.app_settings (key, value) VALUES
  ('affiliate_dedupe_window_hours', '24'::jsonb)
ON CONFLICT (key) DO NOTHING;
