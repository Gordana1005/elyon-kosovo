-- Lifecycle mirror lists: every value-tier list (price × recency) gets a
-- parallel "Cancel" and "Return" sibling so cancelled / refunded customers
-- land in a list that matches their original lifetime band, not a single
-- coarse bucket. Drops the 4 coarse cancel + 4 coarse return lists in
-- favour of the per-tier mirrors.
--
-- The recompute_customer_segments() trigger already evaluates last_cancelled
-- and last_returned against single_price_min / single_price_max — no
-- function changes needed. Backfill at the end re-classifies every customer
-- with at least one cancelled or returned order against the new lists.

-- 1. Drop the 4 coarse cancel + 4 coarse return seeds (no price tier).
--    Member rows in those lists cascade-delete via the FK on
--    prediction_segment_members(list_id).
DELETE FROM public.prediction_segment_lists
WHERE category IN ('cancel', 'return')
  AND single_price_min IS NULL
  AND single_price_max IS NULL;

-- 2. Insert the 24 per-tier mirrors. Display order keeps cancel siblings
--    grouped after the value tiers (60+) and returns after that (90+).
INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event,
   recency_months_min, recency_months_max,
   single_price_min, single_price_max,
   min_paid_count, lifetime_min, display_order)
VALUES
  -- Cancel mirrors (12)
  ('0-3m Cancel <€50',     'Cancelled in last 3 months, last order under €50', 'cancel', 'last_cancelled', 0, 3,    NULL,  50, NULL, NULL, 60),
  ('0-3m Cancel €50+',     'Cancelled in last 3 months, €50–€99.99',           'cancel', 'last_cancelled', 0, 3,      50, 100, NULL, NULL, 61),
  ('0-3m Cancel €100+',    'Cancelled in last 3 months, €100–€199.99',         'cancel', 'last_cancelled', 0, 3,     100, 200, NULL, NULL, 62),
  ('0-3m Cancel Premium',  'Cancelled in last 3 months, €200+',                'cancel', 'last_cancelled', 0, 3,     200, NULL, NULL, NULL, 63),

  ('3-6m Cancel <€50',     'Cancelled 3–6m ago, last order under €50',         'cancel', 'last_cancelled', 3, 6,    NULL,  50, NULL, NULL, 70),
  ('3-6m Cancel €50+',     'Cancelled 3–6m ago, €50–€99.99',                   'cancel', 'last_cancelled', 3, 6,      50, 100, NULL, NULL, 71),
  ('3-6m Cancel €100+',    'Cancelled 3–6m ago, €100–€199.99',                 'cancel', 'last_cancelled', 3, 6,     100, 200, NULL, NULL, 72),
  ('3-6m Cancel Premium',  'Cancelled 3–6m ago, €200+',                        'cancel', 'last_cancelled', 3, 6,     200, NULL, NULL, NULL, 73),

  ('6+m Cancel <€50',      'Cancelled 6–12m ago, last order under €50',        'cancel', 'last_cancelled', 6, 12,   NULL,  50, NULL, NULL, 80),
  ('6+m Cancel €50+',      'Cancelled 6–12m ago, €50–€99.99',                  'cancel', 'last_cancelled', 6, 12,     50, 100, NULL, NULL, 81),
  ('6+m Cancel €100+',     'Cancelled 6–12m ago, €100–€199.99',                'cancel', 'last_cancelled', 6, 12,    100, 200, NULL, NULL, 82),
  ('6+m Cancel Premium',   'Cancelled 6–12m ago, €200+',                       'cancel', 'last_cancelled', 6, 12,    200, NULL, NULL, NULL, 83),

  -- Return mirrors (12)
  ('0-3m Return <€50',     'Returned in last 3 months, last order under €50',  'return', 'last_returned',  0, 3,    NULL,  50, NULL, NULL, 90),
  ('0-3m Return €50+',     'Returned in last 3 months, €50–€99.99',            'return', 'last_returned',  0, 3,      50, 100, NULL, NULL, 91),
  ('0-3m Return €100+',    'Returned in last 3 months, €100–€199.99',          'return', 'last_returned',  0, 3,     100, 200, NULL, NULL, 92),
  ('0-3m Return Premium',  'Returned in last 3 months, €200+',                 'return', 'last_returned',  0, 3,     200, NULL, NULL, NULL, 93),

  ('3-6m Return <€50',     'Returned 3–6m ago, last order under €50',          'return', 'last_returned',  3, 6,    NULL,  50, NULL, NULL, 100),
  ('3-6m Return €50+',     'Returned 3–6m ago, €50–€99.99',                    'return', 'last_returned',  3, 6,      50, 100, NULL, NULL, 101),
  ('3-6m Return €100+',    'Returned 3–6m ago, €100–€199.99',                  'return', 'last_returned',  3, 6,     100, 200, NULL, NULL, 102),
  ('3-6m Return Premium',  'Returned 3–6m ago, €200+',                         'return', 'last_returned',  3, 6,     200, NULL, NULL, NULL, 103),

  ('6+m Return <€50',      'Returned 6–12m ago, last order under €50',         'return', 'last_returned',  6, 12,   NULL,  50, NULL, NULL, 110),
  ('6+m Return €50+',      'Returned 6–12m ago, €50–€99.99',                   'return', 'last_returned',  6, 12,     50, 100, NULL, NULL, 111),
  ('6+m Return €100+',     'Returned 6–12m ago, €100–€199.99',                 'return', 'last_returned',  6, 12,    100, 200, NULL, NULL, 112),
  ('6+m Return Premium',   'Returned 6–12m ago, €200+',                        'return', 'last_returned',  6, 12,    200, NULL, NULL, NULL, 113);

-- 3. Reclassify every customer with a cancelled or returned order so they
--    land in the new per-tier lists.
SELECT public.recompute_customer_segments(customer_phone)
FROM (
  SELECT DISTINCT customer_phone
  FROM public.orders
  WHERE status IN ('cancelled', 'returned')
    AND customer_phone IS NOT NULL
) s;
