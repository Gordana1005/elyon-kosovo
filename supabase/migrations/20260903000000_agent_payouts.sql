-- Agent commission settlements (payroll ledger).
-- History is never deleted: void only. Items snapshot which paid orders were
-- included so the same order cannot be paid out twice while a settlement is live.

CREATE TABLE IF NOT EXISTS public.agent_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES auth.users(id),
  period_from timestamptz NOT NULL,
  period_to   timestamptz NOT NULL,
  packages_count integer NOT NULL CHECK (packages_count >= 0),
  amount_eur numeric(12,2) NOT NULL CHECK (amount_eur >= 0),
  paid_on date NOT NULL DEFAULT ((timezone('utc', now()))::date),
  paid_by uuid REFERENCES auth.users(id),
  method text,
  notes text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'voided')),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.agent_payouts(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  package_units integer NOT NULL CHECK (package_units >= 0),
  bonus_eur numeric(12,2) NOT NULL CHECK (bonus_eur >= 0),
  UNIQUE (payout_id, order_id)
);

-- Never two line items for the same order under non-voided payouts.
CREATE OR REPLACE FUNCTION public.agent_payout_items_prevent_double()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agent_payout_items i
    JOIN public.agent_payouts p ON p.id = i.payout_id
    WHERE i.order_id = NEW.order_id
      AND p.status = 'paid'
      AND i.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'order % is already included in an active agent payout', NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_payout_items_no_double ON public.agent_payout_items;
CREATE TRIGGER trg_agent_payout_items_no_double
  BEFORE INSERT OR UPDATE ON public.agent_payout_items
  FOR EACH ROW EXECUTE FUNCTION public.agent_payout_items_prevent_double();

CREATE INDEX IF NOT EXISTS idx_agent_payouts_agent ON public.agent_payouts (agent_user_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_agent_payouts_status ON public.agent_payouts (status, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_agent_payout_items_payout ON public.agent_payout_items (payout_id);
CREATE INDEX IF NOT EXISTS idx_agent_payout_items_order ON public.agent_payout_items (order_id);

ALTER TABLE public.agent_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_payout_items ENABLE ROW LEVEL SECURITY;

-- Admins/managers: full read
CREATE POLICY "Admins/managers read agent_payouts"
  ON public.agent_payouts FOR SELECT TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

CREATE POLICY "Admins/managers read agent_payout_items"
  ON public.agent_payout_items FOR SELECT TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

-- Agents: read own settlements only
CREATE POLICY "Agents read own agent_payouts"
  ON public.agent_payouts FOR SELECT TO authenticated
  USING (agent_user_id = auth.uid());

CREATE POLICY "Agents read own agent_payout_items"
  ON public.agent_payout_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_payouts p
      WHERE p.id = payout_id AND p.agent_user_id = auth.uid()
    )
  );

-- Writes only via edge function (service role). No INSERT/UPDATE/DELETE for authenticated.

COMMENT ON TABLE public.agent_payouts IS
  'Agent commission settlements. Void (never delete) to reverse; history preserved.';
COMMENT ON TABLE public.agent_payout_items IS
  'Snapshot of paid orders included in a settlement. Prevents double-pay while status=paid.';

-- Grant agents view of performance module so they can open Insights → Agents (self-only).
INSERT INTO public.role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('agent', 'performance', true, false, false, false, false),
  ('pending_agent', 'performance', true, false, false, false, false),
  ('prediction_agent', 'performance', true, false, false, false, false)
ON CONFLICT (role, module_key) DO UPDATE
  SET can_view = EXCLUDED.can_view;
