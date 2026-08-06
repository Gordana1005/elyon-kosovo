-- Add two more ways a settlement can resolve to a MEX zone.
--
-- The first mapping run left 222 settlements unroutable, including СКОПЈЕ
-- itself — the capital, and by far our largest delivery destination. Two causes,
-- both structural rather than accidental:
--
--   1. MEX has NO bare "Skopje" zone. All ~60 of their Skopje entries are
--      prefixed ("Skopje - Centar", "Skopje - Aerodrom"), so a lookup for the
--      leaf "skopje" finds nothing. Because every village around Skopje
--      inherits the capital's zone through the `parent` tier, one unmapped
--      Скопје cascaded into ~200 unmapped settlements.
--      → 'parent_prefix': the settlement names a zone GROUP rather than a zone.
--
--   2. MEX's transliterations are one letter off ours in a handful of cases —
--      Јурумлери vs their "Jurumlari", Ченто vs "Cento". Their zones existed and
--      were simply never reachable.
--      → 'fuzzy': edit distance 1, and ONLY when the candidate zone's parent
--        prefix matches the settlement's own hub. That constraint is what makes
--        it safe: "Jurumlari" can only match a settlement that already sits
--        under Skopje, so it cannot silently route a parcel to another town.
--
-- Anything still unresolved stays NULL and is rejected at push time. MEX has no
-- cancellation endpoint, so we never guess.

ALTER TABLE public.mk_settlements DROP CONSTRAINT IF EXISTS mk_settlements_mex_match_method_check;
ALTER TABLE public.mk_settlements ADD CONSTRAINT mk_settlements_mex_match_method_check
  CHECK (mex_match_method IN ('exact','alias','parent','parent_prefix','fuzzy','manual','unmapped'));
