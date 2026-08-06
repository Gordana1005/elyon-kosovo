-- AlterCPA bridge — take the PENDINGS, not the whole book (operator decision 2026-08-06).
--
-- Mile: "I want Macedonian pendings to be arriving only in pendings, not
-- everything." AlterCPA's own operators work their queue and mark confirm or
-- cancel there. An order that is already approved, cancelled or trashed on their
-- side has been decided; pulling it into Elyon would drop a finished order into
-- the calling pipeline, and for phase 3 (approved) it would book revenue and
-- commission our agents never earned.
--
-- So: only phase 1 (processing) and 2 (hold) become orders here. Everything else
-- still lands in altercpa_leads with skip_reason='not_pending' — fully present in
-- every report and in the mirror, just never in a calling queue.
--
-- Note this changes nothing about the 80.360 historical orders already imported
-- in August: those came through scripts/import-altercpa-mk.mjs, which
-- deliberately DID import every phase because it was reconstructing history.
-- This rule governs the LIVE bridge only.

ALTER TABLE public.altercpa_accounts
  ADD COLUMN IF NOT EXISTS import_scope text NOT NULL DEFAULT 'pending_only';

DO $$
BEGIN
  ALTER TABLE public.altercpa_accounts
    ADD CONSTRAINT altercpa_accounts_import_scope_check
    CHECK (import_scope IN ('pending_only', 'all'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.altercpa_accounts.import_scope IS
  'pending_only (default) = only AlterCPA phase 1/2 become orders here; their already-decided '
  'orders stay ledger-only. all = mirror every phase, for an account nobody works on their side.';

-- 'not_pending' joins the skip vocabulary.
ALTER TABLE public.altercpa_leads
  DROP CONSTRAINT IF EXISTS altercpa_leads_skip_reason_check;
ALTER TABLE public.altercpa_leads
  ADD CONSTRAINT altercpa_leads_skip_reason_check
  CHECK (skip_reason IN
    ('test_order','no_phone','geo_not_callable','unmapped_offer','no_fx_rate','not_pending'));

-- Default status mirroring to OFF, for the same reason.
--
-- 'until_touched' made sense while we assumed AlterCPA's outcome should flow
-- down onto an untouched order. It should not: once we have taken a pending, the
-- order is ours and Mile decides it here. Leaving it on would let their operator
-- cancelling their copy silently cancel a lead our agent is about to call.
ALTER TABLE public.altercpa_accounts
  ALTER COLUMN status_mirror SET DEFAULT 'off';

-- Existing rows (there are none in production yet, but a dev/staging row would
-- otherwise keep the old behaviour invisibly).
UPDATE public.altercpa_accounts
SET status_mirror = 'off'
WHERE status_mirror = 'until_touched';
