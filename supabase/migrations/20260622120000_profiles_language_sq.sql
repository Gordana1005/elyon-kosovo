-- Allow Albanian ('sq') as a third UI language preference.
-- The frontend keeps 'sq' out of the visible switcher until the professional
-- translation review is signed off, so this is safe to apply independently of
-- (and ahead of) the frontend deploy.
--
-- Idempotent: drop the existing CHECK (whatever its current set) and recreate it
-- with the full allowed set, guarding for a DB that may not have the constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_language_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_language_check;
  END IF;

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_language_check CHECK (language IN ('en', 'bg', 'sq'));
END $$;
