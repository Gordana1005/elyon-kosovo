-- AlterCPA → Elyon lead bridge (2026-08-06)
--
-- Leads keep arriving at AlterCPA from the affiliate network; this mirrors them
-- into the CRM so there is one place where the business is visible. We PULL
-- (read-only merchant token against comp/list.json) rather than being pushed to,
-- so nothing has to be configured in their panel.
--
-- ── The one structural decision, and why ────────────────────────────────────
-- EVERY record lands in altercpa_leads — every geo, every offer, every
-- webmaster, with the raw payload. Only records whose geo is in the account's
-- callable_geos are ALSO written into public.orders.
--
-- The rejected alternative was to put every geo into `orders` and filter the
-- foreign ones out downstream. That is the monadon_legacy pattern
-- (`source_type IS DISTINCT FROM 'monadon_legacy'`, repeated in every segment
-- engine migration since 20260627000000), and it would mean auditing the
-- engine, prediction lists, the assigner, Insights, commissions, payouts and
-- stock — each of which reads `orders` unconditionally — against 80.360 live
-- orders. Ledger-first has zero blast radius on all of them.
--
-- It also contains a live data-corruption hazard: normalizeMkPhone (the api
-- edge function) is a REWRITER, not a validator. A Romanian +40 721 234 567
-- becomes +38940721234567 — stored, dialled and matched that way. Foreign leads
-- therefore never reach any code path that would normalize them; the ledger
-- keeps phone_raw verbatim.
--
-- ── Idempotency comes free ──────────────────────────────────────────────────
-- The 2026-08 historical import wrote external_source='altercpa',
-- external_order_id=<altercpa id>, and 20260521150000 put a partial-unique
-- index on (external_source, external_order_id). The live poller reusing that
-- exact pair continues from the 81.657 already-imported orders with no
-- duplicates and no cutover date to get right.
--
-- ── Nothing flows back to AlterCPA ──────────────────────────────────────────
-- Their operators own the outcome on their side; we decide independently on
-- ours. Mirrored orders get NO affiliate_leads row, so
-- tg_enqueue_affiliate_postback (20260904000200) finds nothing and returns —
-- the absence of postbacks is enforced by construction, not by a flag someone
-- can flip. Do not "fix" that by giving these orders a sidecar.

-- ── 1) Accounts ──────────────────────────────────────────────────────────────
-- One row per AlterCPA install. There are several networks (cpa.moe, cpa.toys,
-- cashfactories.com) with different offer catalogues and different reason
-- tables, so "many affiliators" has to be DATA, not a code branch.
CREATE TABLE IF NOT EXISTS public.altercpa_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  api_base          text NOT NULL DEFAULT 'https://api.cpa.moe',

  -- The NAME of a Supabase function secret (e.g. 'ALTERCPA_TOKEN_MAIN'), never
  -- the token itself. A merchant token can read every order in the account, so
  -- it must not sit in a table that any future admin-readable view could
  -- expose, nor in a migration committed to git.
  token_secret_name text NOT NULL,

  is_active         boolean NOT NULL DEFAULT true,

  -- Geos whose leads enter the CALLING pipeline (2-letter, uppercase).
  -- Everything else is mirrored to the ledger and reported on, never called.
  -- Adding a geo here is NOT sufficient to make it callable — see
  -- docs/ALTERCPA-BRIDGE.md "Promoting a geo" for the blockers (phone
  -- normalization, currency, agent routing).
  callable_geos     text[] NOT NULL DEFAULT ARRAY['MK'],

  -- How much of AlterCPA's outcome we accept onto an order we already mirrored:
  --   off            never; the order's status is ours alone after intake
  --   until_touched  only while nobody here has worked it (the default)
  --   always         AlterCPA is the source of truth for status
  -- 'until_touched' is the default because their operators and ours can work
  -- the same lead during the transition, and an agent who just confirmed a sale
  -- must not have it silently reverted by a stale phase from the other system.
  status_mirror     text NOT NULL DEFAULT 'until_touched'
                    CHECK (status_mirror IN ('off', 'until_touched', 'always')),

  sync_from         date,          -- earliest day a backfill may reach
  last_synced_at    timestamptz,   -- high-water mark of the rolling poll
  last_cursor_to    timestamptz,   -- upper bound of the last successful window
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.altercpa_accounts.token_secret_name IS
  'Name of the Supabase function secret holding the merchant token. NEVER store the token itself here.';
COMMENT ON COLUMN public.altercpa_accounts.callable_geos IS
  'Geos whose leads are written into public.orders. All other geos are ledger-only (mirror + report).';

-- ── 2) The ledger ────────────────────────────────────────────────────────────
-- Direct analogue of affiliate_leads, which 20260801000100 deliberately built
-- as a 1:1 sidecar so the orders table gained no columns. Same call here: the
-- call-centre flow stays untouched and every AlterCPA-specific field lives out
-- of the way.
CREATE TABLE IF NOT EXISTS public.altercpa_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.altercpa_accounts(id) ON DELETE CASCADE,

  -- Their order id. TEXT, not bigint: it is an opaque foreign key and some
  -- AlterCPA installs issue non-numeric ids.
  altercpa_id     text NOT NULL,

  -- NULL for every ledger-only record (foreign geo, test order, unmapped
  -- offer). NOT a failure state — it is the normal case for most geos.
  order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,

  geo             text,            -- uppercased o.country
  offer_name      text,            -- goods[0].name, falling back to offername
  offer_ext_id    text,            -- their numeric offer id, when present
  product_id      uuid REFERENCES public.products(id) ON DELETE SET NULL,
  webmaster       text,            -- o.wm — which affiliate sent it

  -- AlterCPA's own vocabulary, stored as-is so a decoding change never needs a
  -- re-fetch. phase (1-5) is the reliable outcome field; status (1-12) is
  -- noisier; reason 0-19 includes this account's custom 16-19, which their API
  -- exposes no lookup for.
  phase           smallint,
  status          smallint,
  reason          smallint,
  phase_seen_at   timestamptz,     -- when WE first saw the current phase
  created_remote  timestamptz,     -- o.time — creation on their side

  -- Phone is kept RAW and never rewritten. phone_e164 is best-effort and is
  -- NULL whenever the geo's dialling rules are not known, because a wrong
  -- E.164 is worse than none: it is dialled and matched as if it were right.
  phone_raw       text,
  phone_e164      text,
  customer_name   text,
  city            text,

  -- Money as they sent it, plus our EUR conversion. price_eur is NULL when the
  -- currency has no known rate — never a guessed number, because a guess is
  -- indistinguishable from a real figure once it is in a report.
  price_raw       numeric(14,2),
  currency_raw    text,
  price_eur       numeric(10,2),
  quantity        integer NOT NULL DEFAULT 1,

  -- The complete record. Every derived column above is reconstructible from
  -- this, so a mapping or decoding fix can be replayed without touching the API.
  payload         jsonb NOT NULL,

  -- Why this record is not in `orders`. NULL = it is (or should be).
  --   test_order       AlterCPA + affiliates smoke-test the live funnel
  --   no_phone         nothing dialable
  --   geo_not_callable the normal path for foreign traffic
  --   unmapped_offer   offer name not in altercpa_offer_map yet — actionable
  --   no_fx_rate       currency we cannot convert
  skip_reason     text CHECK (skip_reason IN
                    ('test_order','no_phone','geo_not_callable','unmapped_offer','no_fx_rate')),

  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, altercpa_id)
);

CREATE INDEX IF NOT EXISTS idx_altercpa_leads_geo_created
  ON public.altercpa_leads (geo, created_remote DESC);
CREATE INDEX IF NOT EXISTS idx_altercpa_leads_offer
  ON public.altercpa_leads (account_id, offer_name);
CREATE INDEX IF NOT EXISTS idx_altercpa_leads_webmaster
  ON public.altercpa_leads (account_id, webmaster);
CREATE INDEX IF NOT EXISTS idx_altercpa_leads_order
  ON public.altercpa_leads (order_id) WHERE order_id IS NOT NULL;
-- The unmapped-offer queue is read on every admin page load; keep it cheap.
CREATE INDEX IF NOT EXISTS idx_altercpa_leads_skip
  ON public.altercpa_leads (skip_reason) WHERE skip_reason IS NOT NULL;

-- ── 3) Offer → product mapping ───────────────────────────────────────────────
-- Replaces the static scripts/data/altercpa-product-map.json for live traffic.
-- A name the map does not cover must NEVER import with product_id = NULL: such
-- an order is invisible to every product report and to stock, and nothing ever
-- surfaces the gap. build-product-map.mjs exists precisely to catch that in the
-- one-off import; this table plus the 'unmapped_offer' skip is the live
-- equivalent — the lead is still mirrored, and the gap becomes a work queue.
CREATE TABLE IF NOT EXISTS public.altercpa_offer_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.altercpa_accounts(id) ON DELETE CASCADE,
  geo           text NOT NULL,
  -- Matched case-insensitively on the trimmed name; see uniq index below.
  offer_name    text NOT NULL,
  product_id    uuid REFERENCES public.products(id) ON DELETE SET NULL,
  offer_id      uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  -- Rows are auto-created unmapped on first sighting; an admin fills product_id.
  is_mapped     boolean GENERATED ALWAYS AS (product_id IS NOT NULL) STORED,
  -- Deliberately ignore this offer (retired, or a geo we will never call).
  is_ignored    boolean NOT NULL DEFAULT false,
  seen_count    integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  mapped_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mapped_at     timestamptz,
  notes         text
);

-- Case/space-insensitive: the historical map needed byte-identical names and a
-- stray double space silently broke the link. Do not repeat that.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_altercpa_offer_map
  ON public.altercpa_offer_map (account_id, geo, lower(btrim(offer_name)));

-- ── 4) Run log ───────────────────────────────────────────────────────────────
-- Without this a silently-truncating sync is indistinguishable from a quiet
-- day. The export script hit exactly that: the API answers an oversized window
-- with an error OBJECT, and code that only checks Array.isArray reads it as
-- end-of-stream and reports success.
CREATE TABLE IF NOT EXISTS public.altercpa_sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid REFERENCES public.altercpa_accounts(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('rolling','nightly','weekly','backfill','manual','dry')),
  window_from   timestamptz,
  window_to     timestamptz,
  fetched       integer NOT NULL DEFAULT 0,
  ledger_new    integer NOT NULL DEFAULT 0,
  ledger_updated integer NOT NULL DEFAULT 0,
  orders_created integer NOT NULL DEFAULT 0,
  orders_updated integer NOT NULL DEFAULT 0,
  skipped       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {skip_reason: count}
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  duration_ms   integer
);

CREATE INDEX IF NOT EXISTS idx_altercpa_sync_runs_recent
  ON public.altercpa_sync_runs (account_id, started_at DESC);

-- ── 5) updated_at bumper (the same helper orders uses) ───────────────────────
DROP TRIGGER IF EXISTS trg_altercpa_accounts_updated_at ON public.altercpa_accounts;
CREATE TRIGGER trg_altercpa_accounts_updated_at
  BEFORE UPDATE ON public.altercpa_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 6) RLS ───────────────────────────────────────────────────────────────────
-- The edge function uses the service role and bypasses all of this; these
-- policies are the backstop for direct PostgREST access.
--
-- Affiliates hold a REAL Supabase login (app_role 'affiliate') and can query
-- PostgREST with their own JWT, which is the vector 20260802000200 and
-- 20260904000010 were written to close. These four tables are the most
-- sensitive yet: altercpa_leads.payload contains every competing webmaster's
-- volumes, payouts and customer PII across every geo. Admin/manager only —
-- deliberately NOT is_internal_staff, which would let every agent read the
-- whole network's book.
ALTER TABLE public.altercpa_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.altercpa_leads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.altercpa_offer_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.altercpa_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and managers manage altercpa accounts" ON public.altercpa_accounts
  FOR ALL TO authenticated USING (public.is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins and managers read altercpa leads" ON public.altercpa_leads
  FOR ALL TO authenticated USING (public.is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins and managers manage altercpa offer map" ON public.altercpa_offer_map
  FOR ALL TO authenticated USING (public.is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins and managers read altercpa sync runs" ON public.altercpa_sync_runs
  FOR ALL TO authenticated USING (public.is_admin_or_manager(auth.uid()));

-- No anon access, ever — these tables are reachable only with a staff JWT or
-- the service role.
REVOKE ALL ON public.altercpa_accounts  FROM anon;
REVOKE ALL ON public.altercpa_leads     FROM anon;
REVOKE ALL ON public.altercpa_offer_map FROM anon;
REVOKE ALL ON public.altercpa_sync_runs FROM anon;

-- ⚠️ New tables need an explicit GRANT for `authenticated` in this project, or
-- RLS never even gets consulted and the UI sees a permission error instead of
-- an empty list (the trap recorded in the 2026-08-04 security audit).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.altercpa_accounts  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.altercpa_leads     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.altercpa_offer_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.altercpa_sync_runs TO authenticated;

-- ── 7) Module + permissions ──────────────────────────────────────────────────
-- Managers get read-only; mutations are admin-gated in the edge function, the
-- same split affiliates_admin uses.
INSERT INTO public.module_settings (module_key, module_label, is_enabled, is_protected) VALUES
  ('altercpa_bridge', 'AlterCPA Bridge', true, false)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('admin',   'altercpa_bridge', true, true,  true,  true,  true),
  ('manager', 'altercpa_bridge', true, false, false, false, true)
ON CONFLICT (role, module_key) DO NOTHING;
