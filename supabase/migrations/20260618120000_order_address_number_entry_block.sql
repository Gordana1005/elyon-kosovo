-- Address granularity, round 2 — split the house number out of the street and
-- add Entry (вход), plus rename the existing "building" field to "block" (бл.),
-- which is what it has always exported as on the warehouse CSV anyway.
--
-- The warehouse (BigArena) address column now reads in proper Bulgarian order:
--   quarter, street № number, бл. block, вх. entry, ет. floor, ап. apartment
-- City and postal_code stay in their own CSV columns (import contract unchanged).
--
-- Mirrors on both orders and customer_profiles so the Create/Edit-Order modals
-- can save and pre-fill the new fields. Passive metadata — no trigger/classifier
-- changes needed. Existing rows keep their values (rename preserves data).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'building') THEN
    ALTER TABLE public.orders RENAME COLUMN building TO block;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'customer_profiles' AND column_name = 'building') THEN
    ALTER TABLE public.customer_profiles RENAME COLUMN building TO block;
  END IF;
END $$;

ALTER TABLE public.orders            ADD COLUMN IF NOT EXISTS street_number TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders            ADD COLUMN IF NOT EXISTS entry         TEXT NOT NULL DEFAULT '';
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS street_number TEXT;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS entry         TEXT;
