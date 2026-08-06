-- ============================================================================
-- orders.trashed_at — when the order was actually junked (2026-08-05)
-- ============================================================================
-- WHY NOW: engine v3.7 gives "Unreachable" trashes a 21-day parking period —
-- after 21 days the customer leaves the Trash List and returns to their normal
-- calling band. That timer needs a truthful "when was this trashed" instant.
--
-- created_at is NOT it: a lead arrives as `pending` and is trashed days later,
-- so created_at is the lead-arrival date. updated_at drifts on every later edit.
-- So we mirror what cancelled_at / returned_at already do on this table
-- (20260711000000 and 20260713000000): a dedicated column, backfilled from
-- order_history, guaranteed forward by a BEFORE trigger.
--
-- NULL-only trigger, so any code that sets trashed_at explicitly still wins.
-- ============================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS trashed_at timestamptz;

COMMENT ON COLUMN public.orders.trashed_at IS
  'When the order entered status=trashed. Drives the engine v3.7 21-day parking '
  'period for not_reachable trashes. Backfilled from order_history; stamped '
  'forward by trg_orders_set_trashed_at.';

-- 1. Backfill: best available signal, newest 'trashed' history event first.
--    Legacy rows with no history row fall back to updated_at, then created_at.
UPDATE public.orders o
SET trashed_at = COALESCE(
  (SELECT max(h.changed_at) FROM public.order_history h
    WHERE h.order_id = o.id AND h.to_status = 'trashed'),
  o.updated_at,
  o.created_at
)
WHERE o.status = 'trashed' AND o.trashed_at IS NULL;

-- 2. Forward guarantee on every writer: the agent picker, the Order Editor, the
--    9-no-answer auto-trash, and anything added later.
CREATE OR REPLACE FUNCTION public.orders_set_trashed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'trashed' AND NEW.trashed_at IS NULL THEN
    NEW.trashed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_set_trashed_at() IS
'2026-08-05: stamps orders.trashed_at = now() whenever a row enters status=trashed without one. NULL-only, so explicit code-set values win. Powers the engine v3.7 21-day Unreachable parking period.';

DROP TRIGGER IF EXISTS trg_orders_set_trashed_at ON public.orders;
CREATE TRIGGER trg_orders_set_trashed_at
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_set_trashed_at();

-- The engine asks "is this phone permanently trashed / temporarily parked?" for
-- every recompute, so index the trash lookup by phone.
CREATE INDEX IF NOT EXISTS idx_orders_trashed_phone
  ON public.orders (customer_phone, trashed_at DESC)
  WHERE status = 'trashed';

COMMIT;
