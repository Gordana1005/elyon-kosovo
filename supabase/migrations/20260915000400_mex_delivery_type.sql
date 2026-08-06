-- Make MEX Poshta a first-class courier: widen the enums, add the rate card.
--
-- ⚠️ Every CHECK below WIDENS. None of them may narrow.
--
-- 80.361 live orders hold delivery_type ∈ (home, speedy_office, econt_office)
-- and home_courier ∈ (speedy, econt). ADD CONSTRAINT validates existing rows,
-- so dropping a legacy value does not "clean up" history — it makes the ALTER
-- fail outright, and if it somehow passed, those rows would become unwritable.
-- The Bulgarian values stay valid forever. MEX simply becomes the only choice
-- offered for NEW orders (enforced in the UI, not the schema).
--
-- home_courier has no CHECK constraint at all, so nothing to widen there — it
-- is validated by the edge function's zod schema instead.

-- ── orders.delivery_type ─────────────────────────────────────────────────────
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_type_check
  CHECK (delivery_type IN ('home', 'speedy_office', 'econt_office', 'mex_office'));

-- ── courier_offices.courier ──────────────────────────────────────────────────
-- MEX has NO office endpoint and no branch network we could find — one depot in
-- Vizbegovo, Skopje. The table gains 'mex' so a pickup-point list can be loaded
-- if MEX supplies one, but it is seeded EMPTY on purpose. The Office tab hides
-- itself while there are zero MEX rows; nothing here is invented.
ALTER TABLE public.courier_offices DROP CONSTRAINT IF EXISTS courier_offices_courier_check;
ALTER TABLE public.courier_offices ADD CONSTRAINT courier_offices_courier_check
  CHECK (courier IN ('speedy', 'econt', 'mex'));

-- Lets an operator load a provisional pickup list and keep it hidden from
-- agents until MEX confirms the addresses.
ALTER TABLE public.courier_offices
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT true;

-- ── courier_rates.courier + the MEX rate card ────────────────────────────────
ALTER TABLE public.courier_rates DROP CONSTRAINT IF EXISTS courier_rates_courier_check;
ALTER TABLE public.courier_rates ADD CONSTRAINT courier_rates_courier_check
  CHECK (courier IN ('speedy', 'econt', 'mex'));

-- 150 ден per delivery. Costs are stored in EUR and MKD_PER_EUR is frozen at
-- 61,5, so 150 / 61,5 = 2,4390. That round-trips exactly: 2,4390 × 61,5 =
-- 149,9985 → 150 ден, and re-saving through the Settings UI gives
-- 150/61,5 = 2,44 → 2,44 × 61,5 = 150,06 → 150 ден. No drift either way.
--
-- return_cost = 0: MEX does not charge for returns. This is a genuine 0, not a
-- missing value — for Speedy/Econt the return cost is the full round-trip loss
-- (outbound leg + return leg), which is why theirs are larger than delivery.
--
-- This is OUR cost. It feeds Pure Profit / Margin Lab / the logistics rollup
-- only. The customer's COD stays exactly the product price — codFor() is
-- untouched and no delivery fee is added to what we collect.
--
-- The econt/speedy rows STAY. Deleting them would silently re-price every
-- historical profit report to the €3,50 / €6,00 blended fallback.
INSERT INTO public.courier_rates (courier, service, deliver_cost, return_cost) VALUES
  ('mex', 'door',   2.4390, 0),
  ('mex', 'office', 2.4390, 0)
ON CONFLICT (courier, service) DO NOTHING;
