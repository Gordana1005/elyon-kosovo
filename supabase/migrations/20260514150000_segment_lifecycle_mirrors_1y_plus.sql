-- Bug fix: the previous mirror migration dropped the coarse `1y+ Cancel`
-- and `1y+ Return` lists but only added per-tier mirrors for 0-12m. As a
-- result every customer cancelled or returned more than a year ago lost
-- their list membership entirely. Add the missing 12+m tier mirrors so
-- the full lifetime is covered, then recompute.

INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event,
   recency_months_min, recency_months_max,
   single_price_min, single_price_max, display_order)
VALUES
  ('1y+ Cancel <€50',     'Cancelled 12+ months ago, last order under €50', 'cancel', 'last_cancelled', 12, NULL,  NULL,  50, 84),
  ('1y+ Cancel €50+',     'Cancelled 12+ months ago, €50–€99.99',           'cancel', 'last_cancelled', 12, NULL,    50, 100, 85),
  ('1y+ Cancel €100+',    'Cancelled 12+ months ago, €100–€199.99',         'cancel', 'last_cancelled', 12, NULL,   100, 200, 86),
  ('1y+ Cancel Premium',  'Cancelled 12+ months ago, €200+',                'cancel', 'last_cancelled', 12, NULL,   200, NULL, 87),

  ('1y+ Return <€50',     'Returned 12+ months ago, last order under €50',  'return', 'last_returned',  12, NULL,  NULL,  50, 114),
  ('1y+ Return €50+',     'Returned 12+ months ago, €50–€99.99',            'return', 'last_returned',  12, NULL,    50, 100, 115),
  ('1y+ Return €100+',    'Returned 12+ months ago, €100–€199.99',          'return', 'last_returned',  12, NULL,   100, 200, 116),
  ('1y+ Return Premium',  'Returned 12+ months ago, €200+',                 'return', 'last_returned',  12, NULL,   200, NULL, 117);

-- Reclassify every customer with a cancelled or returned order so they
-- land in the right tier — including the 13 cancelled + 1279 returned
-- legacy orders from the CPA imports.
SELECT public.recompute_customer_segments(customer_phone)
FROM (
  SELECT DISTINCT customer_phone
  FROM public.orders
  WHERE status IN ('cancelled', 'returned')
    AND customer_phone IS NOT NULL
) s;
