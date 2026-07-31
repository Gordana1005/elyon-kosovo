-- Allow Macedonian ('mk', literary Skopje standard) as a fourth UI language
-- preference, so the choice follows a user across devices instead of living
-- only in that browser's localStorage.
--
-- Idempotent and self-repairing: it drops the existing CHECK (whatever its
-- current set) and recreates it with the FULL allowed set. That also fixes a
-- database where 20260622120000_profiles_language_sq.sql was never applied —
-- 'sq' writes would have been silently rejected there.
--
-- Safe to apply ahead of the frontend deploy: no existing value is invalidated.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_language_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_language_check;
  END IF;

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_language_check CHECK (language IN ('en', 'bg', 'sq', 'mk'));
END $$;

COMMENT ON COLUMN public.profiles.language IS
  'UI language preference: en | bg | sq | mk. Mirrors SUPPORTED_LANGUAGES in src/i18n/index.ts — keep this CHECK in sync when adding a language, or the cross-device write fails silently.';
