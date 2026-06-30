-- Courier office picker — Speedy + Econt (data side).
--
-- The Calls workflow used to capture courier offices in a free-text "Street /
-- Courier office" field; warehouse picked typos out by hand. This migration
-- adds (a) a cached snapshot table of all Speedy + Econt offices in Bulgaria
-- and (b) four columns on orders so a delivery method can be expressed
-- structurally instead of via free text.
--
-- The cache is populated by scripts/scrape-courier-offices.mjs (one-time on
-- ship, manual Refresh button afterwards). When real courier API credentials
-- arrive later, the same table gets refreshed by a cron — frontend code
-- stays unchanged.

CREATE TABLE public.courier_offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier TEXT NOT NULL CHECK (courier IN ('speedy', 'econt')),
  office_code TEXT NOT NULL,
  city TEXT NOT NULL,                  -- Cyrillic, as shown on the courier site
  city_normalized TEXT NOT NULL,       -- lowercase Latin, for prefix search
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  lat NUMERIC(9, 6),
  lng NUMERIC(9, 6),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (courier, office_code)
);

CREATE INDEX idx_courier_offices_search
  ON public.courier_offices (courier, city_normalized text_pattern_ops)
  WHERE is_active;

CREATE INDEX idx_courier_offices_city_lookup
  ON public.courier_offices (courier, city)
  WHERE is_active;

ALTER TABLE public.courier_offices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read courier offices"
  ON public.courier_offices FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins/Managers manage courier offices"
  ON public.courier_offices FOR ALL
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));

-- Order-side: structured delivery method.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'home'
    CHECK (delivery_type IN ('home', 'speedy_office', 'econt_office')),
  ADD COLUMN IF NOT EXISTS courier_office_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS courier_office_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS courier_office_city TEXT NOT NULL DEFAULT '';

-- Existing 14k orders default to delivery_type='home' which is correct —
-- they don't have courier-office data, they have street addresses (or empty).
