-- Macedonian address reference data — settlements and streets.
--
-- Replaces bg_settlements, which is Econt-shaped, Bulgarian, and has 0 rows in
-- this deployment. bg_settlements is deliberately LEFT IN PLACE: dropping it in
-- the same bundle that repoints the endpoints risks a 500 on any reference we
-- missed, and buys nothing. It gets its own removal migration later.
--
-- Source: OpenStreetMap (ODbL — attribution is required and is rendered under
-- the street field in DeliveryMethodPicker). ~1.725 settlements and ~16.700
-- named streets, in Macedonian Cyrillic with Latin and Albanian names alongside.
-- The schema is source-agnostic: if the Cadastre Agency's official street and
-- house-number register becomes available, it loads into the same tables with
-- source='cadastre'.
--
-- IMPORTANT: this is what the AGENT sees. It is a different thing from
-- mex_cities, which is what the COURIER routes on. A settlement resolves to a
-- MEX zone through mex_city_id below; ~1.725 places map onto 149 zones.

CREATE TABLE IF NOT EXISTS public.mk_settlements (
  -- Stable across re-imports: 'osm:n123456' / 'osm:r789'. Never a serial, so a
  -- re-run updates rather than duplicating.
  id            text PRIMARY KEY,
  name          text NOT NULL,          -- official Macedonian Cyrillic
  name_lc       text NOT NULL,          -- lowercased, for prefix search
  name_norm     text NOT NULL,          -- normalizeMkGeo(name) — the join key
  name_lat      text,                   -- OSM name:en, Latin
  name_sq       text,                   -- OSM name:sq — real usage in Tetovo,
                                        -- Gostivar, Debar, Struga, Kičevo
  municipality  text,                   -- општина
  region        text,                   -- one of the 8 statistical regions
  post_code     text,                   -- 4-digit, same shape as the BG codes
                                        -- the postal_code validator already expects
  kind          text NOT NULL DEFAULT 'village'
                CHECK (kind IN ('city','town','village','city_district')),
  -- Skopje's ~60 neighbourhoods are city_district rows pointing at Скопје.
  -- Streets are assigned to the district, but a street search for the PARENT
  -- city unions in its districts — otherwise picking "Скопје" would show no
  -- streets at all, since every Skopje street belongs to a district.
  parent_id     text REFERENCES public.mk_settlements(id) ON DELETE SET NULL,
  lat           numeric(9,6),
  lng           numeric(9,6),

  -- ── the MEX routing mapping (filled by scripts/map-settlements-to-mex.mjs) ──
  mex_city_id      integer REFERENCES public.mex_cities(city_id),
  -- How we got there, so the tail can be audited and closed by hand:
  --   exact  — normalised names matched
  --   alias  — resolved through mex_city_aliases (Albanian name, MEX typo)
  --   parent — MEX has no zone for this village, so it inherits its
  --            municipality seat's zone. Correct for a depot-routed courier.
  --   manual — an admin set it
  --   unmapped — no zone found. Left NULL ON PURPOSE. Never guessed: MEX has
  --            no cancellation endpoint, so a wrong zone is unrecoverable.
  mex_match_method text CHECK (mex_match_method IN ('exact','alias','parent','manual','unmapped')),
  mex_match_note   text,

  source     text NOT NULL DEFAULT 'osm',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- text_pattern_ops so `name_lc ILIKE 'q%'` uses the index (the default opclass
-- does not serve prefix matching on a non-C collation).
CREATE INDEX IF NOT EXISTS idx_mk_settlements_lc
  ON public.mk_settlements (name_lc text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_mk_settlements_norm
  ON public.mk_settlements (name_norm text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_mk_settlements_lat
  ON public.mk_settlements (name_lat text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_mk_settlements_parent
  ON public.mk_settlements (parent_id);
-- The admin backlog view: everything still unroutable.
CREATE INDEX IF NOT EXISTS idx_mk_settlements_unmapped
  ON public.mk_settlements (mex_match_method) WHERE mex_city_id IS NULL;

CREATE TABLE IF NOT EXISTS public.mk_streets (
  id            bigserial PRIMARY KEY,
  settlement_id text NOT NULL REFERENCES public.mk_settlements(id) ON DELETE CASCADE,
  -- Stored WITH its Macedonian prefix ("бул. Партизански одреди"), because the
  -- whole string is handed to MEX as free text inside receiver_address and read
  -- by a driver. Do not strip it.
  name          text NOT NULL,
  name_lc       text NOT NULL,
  name_norm     text NOT NULL,
  kind          text NOT NULL DEFAULT 'street'
                CHECK (kind IN ('street','boulevard','square','quarter')),
  source        text NOT NULL DEFAULT 'osm',
  UNIQUE (settlement_id, name, kind)
);

CREATE INDEX IF NOT EXISTS idx_mk_streets_lookup
  ON public.mk_streets (settlement_id, kind, name_norm text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_mk_streets_lc
  ON public.mk_streets (settlement_id, name_lc text_pattern_ops);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same predicate as 20260802000200 / 20260904000010. bg_settlements was locked
-- down for exactly this reason: an affiliate login must not enumerate our
-- address reference data. Server paths use the service-role client.
ALTER TABLE public.mk_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk_streets     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Internal staff can read mk settlements" ON public.mk_settlements;
CREATE POLICY "Internal staff can read mk settlements" ON public.mk_settlements
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));

DROP POLICY IF EXISTS "Internal staff can read mk streets" ON public.mk_streets;
CREATE POLICY "Internal staff can read mk streets" ON public.mk_streets
  FOR SELECT TO authenticated USING (public.is_internal_staff(auth.uid()));
