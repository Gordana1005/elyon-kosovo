
-- Step 1: Add ads_admin to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'ads_admin';
