-- Fix: the "1-3m" lists were leaving brand-new (<30 day old) buyers in
-- limbo because nothing covered the 0-30 day window. Rename every 1-3m
-- list to "0-3m" and set recency_months_min = 0 so the band covers
-- [0 days, 90 days). All other bands (3-6m, 6+m, 1y+) stay the same.

UPDATE public.prediction_segment_lists
SET
  name = REPLACE(name, '1-3m', '0-3m'),
  description = CASE
    WHEN description LIKE 'Last paid 1-3m ago%' THEN REPLACE(description, 'Last paid 1-3m ago', 'Last paid in the last 3 months')
    WHEN description LIKE 'Cancelled 1-3m ago' THEN 'Cancelled in the last 3 months'
    WHEN description LIKE 'Returned 1-3m ago' THEN 'Returned in the last 3 months'
    ELSE description
  END,
  recency_months_min = 0,
  updated_at = now()
WHERE recency_months_min = 1 AND recency_months_max = 3;

-- Re-classify every customer so members of the renamed lists are populated
-- against the new [0, 90) window.
SELECT public.recompute_all_segments();
