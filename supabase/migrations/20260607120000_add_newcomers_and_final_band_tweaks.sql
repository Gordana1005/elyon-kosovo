-- Add NEWCOMERS lists for 0-21 days (as requested) and ensure 21d lists start strictly after 21 days.
-- The 21-day protection is now expressed by routing 0-21 day clients to NEWCOMERS instead of the 21d+ buckets.

BEGIN;

-- Create NEWCOMERS lists for 0-21 days (one per frequency group, no price split as per user)
INSERT INTO prediction_segment_lists (name, category, trigger_event, recency_months_min, recency_months_max, priority, display_order, is_active, is_static)
VALUES 
  ('NEWCOMERS (1-3 orders)', 'value', 'last_paid', 0, 0.7, 1, 5, true, false),
  ('NEWCOMERS (3+ orders)', 'value', 'last_paid', 0, 0.7, 2, 6, true, false),
  ('NEWCOMERS (5+ orders)', 'value', 'last_paid', 0, 0.7, 3, 7, true, false),
  ('NEWCOMERS (7+ orders)', 'value', 'last_paid', 0, 0.7, 4, 8, true, false);

-- Ensure 21d lists have min at least 0.7 (21 days) so they don't accept <21 day clients.
-- (The function will also explicitly route <21d to NEWCOMERS)
UPDATE prediction_segment_lists
SET recency_months_min = 0.7
WHERE name LIKE '21d %' AND is_static = false AND recency_months_min < 0.7;

-- The 57d lists should start at 1.9 (57 days) - already set in previous alignment attempts.
-- If not, the following ensures it:
UPDATE prediction_segment_lists
SET recency_months_min = 1.9
WHERE name LIKE '57d %' AND is_static = false AND recency_months_min < 1.9;

-- Recompute so the NEWCOMERS and adjusted bands take effect
SELECT public.recompute_all_segments();

COMMIT;

COMMENT ON TABLE prediction_segment_lists IS 'Added NEWCOMERS (0-21d) buckets. 21d buckets now start strictly after 21 days per user clarification.';