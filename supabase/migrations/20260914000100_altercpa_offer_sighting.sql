-- altercpa_offer_map: make the sighting counter correct and upsertable.
--
-- 20260914000000 put the uniqueness on an EXPRESSION index
-- (account_id, geo, lower(btrim(offer_name))). Two consequences that only show
-- up at runtime:
--
--   1. PostgREST's on_conflict= takes COLUMN names; it cannot target an
--      expression index. The sync's upsert would fail on every second sighting.
--   2. Falling back to ignoreDuplicates (ON CONFLICT DO NOTHING) makes
--      seen_count frozen at whatever the first batch saw — and seen_count is
--      the volume column an admin uses to decide which unmapped offer to map
--      first. A silently wrong number is worse than no number.
--
-- Fixed by doing the whole thing in one statement server-side. The function is
-- also the only writer of seen_count, so concurrent sync runs add up instead of
-- clobbering each other.

-- A stored, normalized key: a real column, so a plain unique index can target
-- it. The historical map needed byte-identical names and a stray double space
-- silently broke the link — normalizing here means that class of bug cannot
-- come back.
ALTER TABLE public.altercpa_offer_map
  ADD COLUMN IF NOT EXISTS offer_name_key text
  GENERATED ALWAYS AS (lower(btrim(offer_name))) STORED;

DROP INDEX IF EXISTS public.uniq_altercpa_offer_map;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_altercpa_offer_map
  ON public.altercpa_offer_map (account_id, geo, offer_name_key);

-- Record N sightings of an offer name, creating the queue row on first sight.
-- Returns the row id so the caller can link without a second round-trip.
CREATE OR REPLACE FUNCTION public.altercpa_record_offer_sighting(
  _account_id uuid,
  _geo        text,
  _offer_name text,
  _n          integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.altercpa_offer_map (account_id, geo, offer_name, seen_count, last_seen_at)
  VALUES (_account_id, upper(coalesce(nullif(btrim(_geo), ''), '??')), btrim(_offer_name),
          greatest(coalesce(_n, 1), 0), now())
  ON CONFLICT (account_id, geo, offer_name_key) DO UPDATE
    SET seen_count   = public.altercpa_offer_map.seen_count + greatest(coalesce(_n, 1), 0),
        last_seen_at = now()
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Service role only: this is called by the sync function, never from a browser.
REVOKE ALL ON FUNCTION public.altercpa_record_offer_sighting(uuid, text, text, integer) FROM public, anon, authenticated;
