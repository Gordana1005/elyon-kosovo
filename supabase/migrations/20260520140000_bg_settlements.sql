-- Bulgarian settlements reference (cities + villages), sourced from Econt's
-- public Nomenclatures API. Powers (1) accurate address parsing in the
-- backfill — distinguishing с. (village) from a city and auto-filling the
-- postal code from the official record — and (2) the live city/quarter/street
-- autocomplete on the order form (Phase 3).

CREATE TABLE public.bg_settlements (
  id          text PRIMARY KEY,        -- Econt settlement id
  name        text NOT NULL,           -- Bulgarian name (e.g. "Стожер")
  name_en     text,
  name_lc     text NOT NULL,           -- lowercased for matching
  post_code   text,                    -- official postal code
  region      text,                    -- област
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bg_settlements_name_lc ON public.bg_settlements(name_lc);
CREATE INDEX idx_bg_settlements_post   ON public.bg_settlements(post_code);

ALTER TABLE public.bg_settlements ENABLE ROW LEVEL SECURITY;

-- Reference data — any authenticated user can read; writes via service role.
CREATE POLICY "Authenticated can read settlements" ON public.bg_settlements
  FOR SELECT TO authenticated USING (true);
