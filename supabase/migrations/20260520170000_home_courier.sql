-- Which courier delivers a home (door) order: 'speedy' or 'econt'.
-- Office orders carry their courier in delivery_type; home orders previously
-- had no courier, so the warehouse CSV defaulted them to econt. This column
-- lets the agent choose per order. NULL = not chosen (export falls back to econt).
ALTER TABLE public.orders            ADD COLUMN IF NOT EXISTS home_courier TEXT;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS home_courier TEXT;
