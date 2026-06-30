-- Complete the symmetric matrix for the new lifetime prediction lists.
-- The user pointed out the asymmetry: we had 26+ with 3+/5+/7+ but no 26+ (1-3),
-- and ≤26 only with (1-3) but missing ≤26 (3+ / 5+ / 7+).
--
-- This migration adds the 24 missing combinations so every client has a clear home.
-- It also ensures NEWCOMERS lists exist for the 0-21 day group (no price split, as requested).

BEGIN;

-- 1. Create NEWCOMERS for 0-21 days (4 lists, frequency only, as user approved)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('NEWCOMERS (1-3 orders)', 'value', 'last_paid', 0, 0.7, 1, 1, true, false),
  ('NEWCOMERS (3+ orders)',  'value', 'last_paid', 0, 0.7, 2, 2, true, false),
  ('NEWCOMERS (5+ orders)',  'value', 'last_paid', 0, 0.7, 3, 3, true, false),
  ('NEWCOMERS (7+ orders)',  'value', 'last_paid', 0, 0.7, 4, 4, true, false)
ON CONFLICT (name) DO NOTHING;

-- 2. Add the missing symmetric lists for every time bucket

-- 21d (21-57 days)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('21d 26+ (1-3 orders)', 'value', 'last_paid', 0.7, 1.9, 5, 10, true, false),
  ('21d ≤26 (3+ orders)',  'value', 'last_paid', 0.7, 1.9, 6, 11, true, false),
  ('21d ≤26 (5+ orders)',  'value', 'last_paid', 0.7, 1.9, 7, 12, true, false),
  ('21d ≤26 (7+ orders)',  'value', 'last_paid', 0.7, 1.9, 8, 13, true, false)
ON CONFLICT (name) DO NOTHING;

-- 57d (57 days - 4 months)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('57d 26+ (1-3 orders)', 'value', 'last_paid', 1.9, 4, 25, 20, true, false),
  ('57d ≤26 (3+ orders)',  'value', 'last_paid', 1.9, 4, 26, 21, true, false),
  ('57d ≤26 (5+ orders)',  'value', 'last_paid', 1.9, 4, 27, 22, true, false),
  ('57d ≤26 (7+ orders)',  'value', 'last_paid', 1.9, 4, 28, 23, true, false)
ON CONFLICT (name) DO NOTHING;

-- 4-6m (120-180 days)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('4-6m 26+ (1-3 orders)', 'value', 'last_paid', 4, 6, 45, 30, true, false),
  ('4-6m ≤26 (3+ orders)',  'value', 'last_paid', 4, 6, 46, 31, true, false),
  ('4-6m ≤26 (5+ orders)',  'value', 'last_paid', 4, 6, 47, 32, true, false),
  ('4-6m ≤26 (7+ orders)',  'value', 'last_paid', 4, 6, 48, 33, true, false)
ON CONFLICT (name) DO NOTHING;

-- 6-12m (180-365 days)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('6-12m 26+ (1-3 orders)', 'value', 'last_paid', 6, 12, 65, 40, true, false),
  ('6-12m ≤26 (3+ orders)',  'value', 'last_paid', 6, 12, 66, 41, true, false),
  ('6-12m ≤26 (5+ orders)',  'value', 'last_paid', 6, 12, 67, 42, true, false),
  ('6-12m ≤26 (7+ orders)',  'value', 'last_paid', 6, 12, 68, 43, true, false)
ON CONFLICT (name) DO NOTHING;

-- 1-2yr (365-730 days)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('1-2yr 26+ (1-3 orders)', 'value', 'last_paid', 12, 24, 85, 50, true, false),
  ('1-2yr ≤26 (3+ orders)',  'value', 'last_paid', 12, 24, 86, 51, true, false),
  ('1-2yr ≤26 (5+ orders)',  'value', 'last_paid', 12, 24, 87, 52, true, false),
  ('1-2yr ≤26 (7+ orders)',  'value', 'last_paid', 12, 24, 88, 53, true, false)
ON CONFLICT (name) DO NOTHING;

-- 2yr+ (730+ days)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES
  ('2yr+ 26+ (1-3 orders)', 'value', 'last_paid', 24, null, 105, 60, true, false),
  ('2yr+ ≤26 (3+ orders)',  'value', 'last_paid', 24, null, 106, 61, true, false),
  ('2yr+ ≤26 (5+ orders)',  'value', 'last_paid', 24, null, 107, 62, true, false),
  ('2yr+ ≤26 (7+ orders)',  'value', 'last_paid', 24, null, 108, 63, true, false)
ON CONFLICT (name) DO NOTHING;

-- 3. Recompute everything so clients (including those with ≤26 last order + 4+ paid orders) get assigned to the now-complete set of lists.
SELECT public.recompute_all_segments();

COMMIT;

COMMENT ON TABLE prediction_segment_lists IS 'Complete symmetric matrix: every time bucket has all 8 combinations of last-order-value (≤26/26+) × frequency (1-3/3+/5+/7+), plus NEWCOMERS for 0-21d.';