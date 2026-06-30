-- Municipality (община) for each settlement, so a village can show its parent
-- city. Sourced from the EKATTE classifier (yurukov/Bulgaria-geocoding) and
-- joined onto bg_settlements by name + oblast (region) to handle the ~103
-- duplicate settlement names.
ALTER TABLE public.bg_settlements ADD COLUMN IF NOT EXISTS municipality text;
