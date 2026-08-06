-- Carry the resolved MEX delivery zone on the order itself.
--
-- add_shipment.php routes on receiver_city_id and nothing else — there is no
-- postcode field and receiver_address is free text. So the zone is the single
-- value that decides where a parcel physically goes, and it has to be recorded
-- per order, not looked up at push time.
--
-- A SNAPSHOT, not a join. Same reasoning as the existing courier_office_code /
-- _name / _city columns: re-running scripts/map-settlements-to-mex.mjs must
-- never silently rewrite where an already-shipped parcel was sent. The name is
-- stored alongside the id so the history stays readable even if MEX retires a
-- zone.
--
-- Both columns are nullable with no default, so this ALTER is metadata-only —
-- it does NOT rewrite the 80.361 live orders.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS mex_city_id   integer,
  ADD COLUMN IF NOT EXISTS mex_city_name text;

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS mex_city_id   integer,
  ADD COLUMN IF NOT EXISTS mex_city_name text;

-- The operational backlog: confirmed/shipped orders we cannot hand to MEX
-- because the settlement never resolved to a zone. These must fail loudly at
-- push time rather than be guessed into the wrong town.
CREATE INDEX IF NOT EXISTS idx_orders_mex_unmapped
  ON public.orders (status)
  WHERE mex_city_id IS NULL AND status IN ('confirmed', 'shipped');
