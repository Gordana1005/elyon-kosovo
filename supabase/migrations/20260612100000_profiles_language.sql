-- Per-user UI language preference (top-bar switcher). Frontend reads it on
-- login and falls back to localStorage / 'en' until this is applied, so the
-- migration is safe to apply independently of the frontend deploy.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

-- Separate statement so re-running on a DB that already has the column (but
-- not the constraint, or vice versa) stays idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_language_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_language_check CHECK (language IN ('en', 'bg'));
  END IF;
END $$;

-- Adding a 3rd language later:
--   ALTER TABLE public.profiles DROP CONSTRAINT profiles_language_check;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_language_check CHECK (language IN ('en','bg','xx'));
