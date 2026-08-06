-- ============================================================================
-- Trash reason: add 'duplicate_order' (2026-08-05)
-- ============================================================================
-- Leads now arrive from affiliates and per-product webhooks, and the same
-- customer sometimes lands twice. Operators need to trash the duplicate with a
-- truthful reason instead of falling back to 'other'.
--
-- This is DISTINCT from the status='duplicated' feature (orders.duplicated_from,
-- POST /orders/:id/duplicate) — that is an admin deliberately copying an order.
-- This reason marks a redundant *lead* record as junk.
--
-- Additive only: existing rows keep their values, the partial index
-- idx_orders_trash_reason is unaffected, and no data is rewritten.
--
-- Keep in sync with:
--   src/lib/trashReasons.ts        (TRASH_REASON_VALUES)
--   src/lib/api.ts                 (TrashReason union)
--   supabase/functions/api/index.ts (three zod enums)
--   src/i18n/locales/*.json        (trashReason.*)
-- ============================================================================

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_trash_reason_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_trash_reason_check
  CHECK (
    trash_reason IS NULL OR trash_reason IN (
      'wrong_number',
      'wrong_person',
      'not_reachable',
      'rude',
      'uncooperative',
      'duplicate_order',
      'other'
    )
  );

COMMENT ON COLUMN public.orders.trash_reason IS
  'Structured trash reason key (translated for display via i18n trashReason.*). '
  'wrong_number / wrong_person / not_reachable are "dead number" reasons — the '
  'segment engine drops those customers from every calling band. duplicate_order '
  'is lead de-duplication housekeeping: the customer stays callable and (engine '
  'v3.7+) is kept out of the Trash List entirely.';
