-- Align the recency bands on the new lifetime lists to exactly match the user's clarified semantics (May 28 clarification).
--
-- User's intent:
-- - 0-21 days after last paid: No normal prediction list (or optional "New Orders" bucket). Do not show in main queues.
-- - "21d" bucket = starts at day 21, covers up to day 57.
-- - "57d" bucket = starts at day 57, covers up to ~4 months (what was previously called 2-4m in naming).
-- - Then 4-6m, 6-12m, etc. as before.
--
-- This migration updates the recency_months_min/max on the existing rows (no delete/insert of lists, to preserve any manual data or member history if any).

BEGIN;

-- 21d buckets: change from 0-30 days to 21-57 days (0.7 - 1.9 months)
UPDATE prediction_segment_lists
SET recency_months_min = 0.7,
    recency_months_max = 1.9
WHERE name LIKE '21d %'
  AND is_static = false;

-- Current "57d" buckets (30-60 days) → move them to be the post-57-day bucket (1.9 - 4 months)
-- and keep the name "57d ..." because the user wants the "57d" name to represent the bucket that starts at 57 days.
UPDATE prediction_segment_lists
SET recency_months_min = 1.9,
    recency_months_max = 4
WHERE name LIKE '57d %'
  AND is_static = false;

-- Current "2-4m" buckets (60-120 days) → become the next one after the new 57d window, i.e. 4-6 months
UPDATE prediction_segment_lists
SET recency_months_min = 4,
    recency_months_max = 6,
    name = REPLACE(name, '2-4m', '4-6m')
WHERE name LIKE '2-4m %'
  AND is_static = false;

-- The later ones (4-6m → 6-12m, 6-12m → 1-2yr, etc.) stay as-is or shift if you want stricter alignment.
-- For now we leave them; they are already reasonable.

-- For the very new (0-21 days): since the 21d variants now start at 0.7 months, phones with last paid < 21 days will not match any of the normal buckets.
-- If you want a visible "New Orders" bucket for 0-21 days, we can add it in a follow-up. For now this implements "we don't need a list for 0-21".

-- Recompute everything so the new bands take effect immediately
SELECT public.recompute_all_segments();

COMMIT;

COMMENT ON TABLE prediction_segment_lists IS 'Recency bands aligned to user clarification: 21d bucket = 21-57 days, 57d bucket = 57 days to ~4 months, etc. 0-21 days intentionally excluded from normal prediction lists.';