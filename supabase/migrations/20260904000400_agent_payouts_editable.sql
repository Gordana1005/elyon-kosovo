-- Editable agent payouts.
--
-- Some agents are not on the per-package 1/2/3 EUR ladder (e.g. a flat 10% of
-- what they sold), so the operator must be able to overwrite the number the
-- formula produced — both when settling and afterwards. We keep BOTH numbers:
--   computed_amount_eur = what the commission engine said
--   amount_eur          = what was actually handed over
-- so a settlement always shows its own audit trail. amount_source flags which
-- of the two the operator went with.
--
-- Note on balances: Insights → Payout derives "unpaid" from unsettled ORDERS
-- (agent_payout_items), not from earned-minus-settled, so overriding the money
-- never desyncs the balance. Only "Earned" (formula) and "Settled" (real cash)
-- legitimately drift apart.

ALTER TABLE public.agent_payouts
  ADD COLUMN IF NOT EXISTS computed_amount_eur numeric(12,2),
  ADD COLUMN IF NOT EXISTS amount_source text NOT NULL DEFAULT 'formula',
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_payouts_amount_source_check'
  ) THEN
    ALTER TABLE public.agent_payouts
      ADD CONSTRAINT agent_payouts_amount_source_check
      CHECK (amount_source IN ('formula', 'manual'));
  END IF;
END $$;

-- Historical rows predate the override feature: they were all formula amounts.
UPDATE public.agent_payouts
   SET computed_amount_eur = amount_eur
 WHERE computed_amount_eur IS NULL;

COMMENT ON COLUMN public.agent_payouts.computed_amount_eur IS
  'What the per-package commission engine calculated for this period. Kept even when the operator pays a different amount.';
COMMENT ON COLUMN public.agent_payouts.amount_eur IS
  'Amount actually paid. Equals computed_amount_eur unless amount_source = ''manual''.';
COMMENT ON COLUMN public.agent_payouts.amount_source IS
  '''formula'' = engine amount accepted as-is; ''manual'' = operator typed a different amount (see override_reason).';

-- Writes stay service-role only (edge function). No new RLS policies:
-- the SELECT policies from 20260903000000_agent_payouts.sql already cover
-- these columns, and authenticated users still cannot INSERT/UPDATE/DELETE.
