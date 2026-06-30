-- Office deliveries need the courier office's own postal code on the order so
-- the fulfilment CSV carries a postal_code for office orders (not just home).
-- Econt exposes it as address.city.postCode, Speedy as address.postCode;
-- scripts/scrape-courier-offices.mjs now captures it into this column.

ALTER TABLE public.courier_offices
  ADD COLUMN IF NOT EXISTS post_code TEXT NOT NULL DEFAULT '';
