-- altercpa_summary — the rollups behind the Mirror tab's header.
--
-- Done in SQL rather than in the edge function because the ledger holds every
-- geo of a multi-country network: counting by pulling rows into Deno would move
-- tens of thousands of jsonb payloads over the wire to produce nine numbers.
--
-- Returns one jsonb object so the whole header is a single round trip:
--   { totals: {...}, geos: [...], offers: [...], webmasters: [...] }
--
-- Money note: sums are EUR and are computed ONLY over rows where price_eur is
-- non-null. A lead in a currency we have no rate for contributes to the counts
-- and not to the money, which is the honest split — the alternative (treating
-- it as 0) understates revenue invisibly.
CREATE OR REPLACE FUNCTION public.altercpa_summary(
  _account_id uuid DEFAULT NULL,
  _from       text DEFAULT NULL,
  _to         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH filtered AS (
  SELECT *
  FROM public.altercpa_leads l
  WHERE (_account_id IS NULL OR l.account_id = _account_id)
    AND (_from IS NULL OR l.created_remote >= _from::timestamptz)
    AND (_to   IS NULL OR l.created_remote <= _to::timestamptz)
)
SELECT jsonb_build_object(
  'totals', (
    SELECT jsonb_build_object(
      'leads',    count(*),
      'mirrored', count(*) FILTER (WHERE skip_reason IS NULL),
      'ledger_only', count(*) FILTER (WHERE skip_reason IS NOT NULL),
      'geos',     count(DISTINCT geo),
      'offers',   count(DISTINCT offer_name),
      'webmasters', count(DISTINCT webmaster),
      'approved', count(*) FILTER (WHERE phase = 3),
      'revenue_eur', COALESCE(round(sum(price_eur * quantity) FILTER (WHERE phase = 3), 2), 0),
      'priced',   count(*) FILTER (WHERE price_eur IS NOT NULL),
      'unpriced', count(*) FILTER (WHERE price_eur IS NULL)
    ) FROM filtered
  ),
  'geos', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'leads')::int DESC) FROM (
      SELECT jsonb_build_object(
        'geo', COALESCE(geo, '??'),
        'leads', count(*),
        'mirrored', count(*) FILTER (WHERE skip_reason IS NULL),
        'approved', count(*) FILTER (WHERE phase = 3),
        'currencies', (SELECT jsonb_agg(DISTINCT upper(c)) FROM unnest(array_agg(currency_raw)) AS c WHERE c IS NOT NULL),
        'revenue_eur', COALESCE(round(sum(price_eur * quantity) FILTER (WHERE phase = 3), 2), 0)
      ) AS x
      FROM filtered GROUP BY COALESCE(geo, '??')
    ) s
  ), '[]'::jsonb),
  'offers', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'leads')::int DESC) FROM (
      SELECT jsonb_build_object(
        'geo', COALESCE(geo, '??'),
        'offer', offer_name,
        'leads', count(*),
        'approved', count(*) FILTER (WHERE phase = 3),
        'mapped', bool_or(product_id IS NOT NULL)
      ) AS x
      FROM filtered GROUP BY COALESCE(geo, '??'), offer_name
      ORDER BY count(*) DESC LIMIT 100
    ) s
  ), '[]'::jsonb),
  'webmasters', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'leads')::int DESC) FROM (
      SELECT jsonb_build_object(
        'webmaster', COALESCE(webmaster, '—'),
        'leads', count(*),
        'approved', count(*) FILTER (WHERE phase = 3),
        'geos', count(DISTINCT geo)
      ) AS x
      FROM filtered GROUP BY COALESCE(webmaster, '—')
      ORDER BY count(*) DESC LIMIT 100
    ) s
  ), '[]'::jsonb)
);
$$;

-- Called by the edge function with the service role. Not exposed to browsers:
-- the whole point of the admin route is that it re-checks the role first.
REVOKE ALL ON FUNCTION public.altercpa_summary(uuid, text, text) FROM public, anon, authenticated;
