-- SECURITY FIX (2026-07-22) — CRITICAL, PUBLIC PII EXPOSURE.
--
-- Six prediction_segment_members_backup_* snapshot tables were created by
-- `CREATE TABLE … AS SELECT` inside the segment-engine migrations. That form
-- inherits Supabase's default public-schema grants (anon + authenticated get
-- ALL privileges) and does NOT enable row level security. Result, verified
-- live against production with the publishable key that ships inside our own
-- JS bundle:
--
--   GET /rest/v1/prediction_segment_members_backup_20260610
--       ?select=customer_name,customer_phone
--   → HTTP 200, 11071 rows
--
-- 59,477 rows total across the six tables, every one carrying customer_name +
-- customer_phone. Anonymous callers could also INSERT/UPDATE/DELETE/TRUNCATE
-- them. The 2026-07-11 lockdown (20260802000200) fixed five hand-written
-- tables and never covered these, because they are not referenced anywhere in
-- application code — they exist purely as rollback snapshots.
--
-- Fix = revoke the grants and turn RLS on with NO policies (deny-all). The
-- service-role key bypasses RLS, so any future rollback still works. This is
-- deliberately NON-DESTRUCTIVE: locking is reversible, dropping is not. Decide
-- separately whether these snapshots are still needed at all.

DO $$
DECLARE
  _t text;
  _tables text[] := ARRAY[
    'prediction_segment_members_backup_20260610',
    'prediction_segment_members_backup_20260618',
    'prediction_segment_members_backup_20260623',
    'prediction_segment_members_backup_20260623_returns',
    'prediction_segment_members_backup_20260625_trashed',
    'prediction_segment_members_backup_20260707_trashlist'
  ];
BEGIN
  FOREACH _t IN ARRAY _tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = _t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', _t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
      RAISE NOTICE 'locked down public.%', _t;
    ELSE
      RAISE NOTICE 'skipped (absent) public.%', _t;
    END IF;
  END LOOP;
END $$;

-- Belt and braces: any FUTURE table created in `public` by a migration that
-- forgets this will still be caught by the audit query documented in the
-- elyon-security skill. Snapshot tables should be created in a dedicated
-- `backup` schema (not exposed by PostgREST) rather than in `public`.
