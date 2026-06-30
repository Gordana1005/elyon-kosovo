-- Live list: customers whose most recent PAID order (created in the last
-- 6 months) was €46 or more. Single-order price, NOT lifetime total.
-- Purely additive — one new rule row; the existing recompute trigger keeps
-- it up to date as new orders are paid.
--
-- Mechanics: the classifier (recompute_customer_segments) takes the latest
-- status='paid' order's price as the trigger price and checks it against
-- single_price_min/max. So min=46, max=NULL ⇒ "last order ≥ €46", and
-- recency 0-6m ⇒ that order was placed within the last 6 months.

INSERT INTO public.prediction_segment_lists
  (name, description, category, trigger_event,
   recency_months_min, recency_months_max,
   single_price_min, single_price_max,
   min_paid_count, lifetime_min, display_order)
VALUES
  ('Last 6m · last order €46+',
   'Most recent paid order was €46 or more and was placed in the last 6 months (single order, not lifetime total).',
   'other', 'last_paid',
   0, 6,
   46, NULL,
   NULL, NULL, 200);

-- Backfill: re-classify every customer who has any paid order so they land
-- in (or out of) the new list. Idempotent — re-affirms existing memberships
-- via ON CONFLICT and only adds/removes for the new rule.
SELECT public.recompute_customer_segments(customer_phone)
FROM (
  SELECT DISTINCT customer_phone
  FROM public.orders
  WHERE status = 'paid' AND customer_phone IS NOT NULL AND customer_phone <> ''
) s;
