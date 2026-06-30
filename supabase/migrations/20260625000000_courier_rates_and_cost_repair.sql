-- Courier rate card + logistics cost accounting + agent-attribution repair.
--
-- WHY: "Pure Profit" only subtracted product cost (COGS) and agent commissions —
-- it ignored what we pay couriers to deliver and what we lose on returns. The
-- BigArena fee ledger (gagag.xlsx, 155 orders / €546.24) was used to calibrate a
-- flat per-courier+service rate card (every package is < 1 kg, so no weight tiers).
-- Deliver = all-in outbound (forwarding + toll + SMS + COD fee). Return =
-- full round-trip loss (outbound + return leg + both tolls), because we pay to
-- send it AND to get it back. A return loses shipping only — the product comes
-- back to stock (see elyon-stock-and-bigarena), so COGS is booked on paid orders.

-- 1) Editable rate card --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courier_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier      text NOT NULL CHECK (courier IN ('speedy', 'econt')),
  service      text NOT NULL CHECK (service IN ('door', 'office')),
  deliver_cost numeric NOT NULL DEFAULT 0,   -- all-in outbound per shipment
  return_cost  numeric NOT NULL DEFAULT 0,   -- full round-trip loss per return
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier, service)
);

-- Seed with the calibrated modes from the BigArena ledger (EUR).
INSERT INTO public.courier_rates (courier, service, deliver_cost, return_cost) VALUES
  ('econt',  'office', 3.05, 5.32),
  ('econt',  'door',   4.56, 7.36),
  ('speedy', 'office', 2.48, 4.24),
  ('speedy', 'door',   3.21, 5.70)
ON CONFLICT (courier, service) DO NOTHING;

ALTER TABLE public.courier_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read courier rates"
  ON public.courier_rates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins/Managers manage courier rates"
  ON public.courier_rates FOR ALL
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));

-- 2) Exact-actuals override columns (used only when a real BigArena bill is
--    imported later; until then the modeled rate-card cost is used). --------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_order_id   text,
  ADD COLUMN IF NOT EXISTS waybill                text,
  ADD COLUMN IF NOT EXISTS actual_logistics_cost  numeric;

-- 3) Attribution repair --------------------------------------------------------
-- The sale + bonus must always belong to the FIRST AGENT who confirmed the order.
-- A super-admin (Mile/Miki) editing & re-confirming an agent's order must not
-- steal the credit. Going forward the API guard handles this; this one-off pass
-- hands credit back for orders since 2026-05-18 where a pure admin/manager
-- currently holds it but an agent confirmed earlier in order_history.
WITH first_agent_confirm AS (
  SELECT DISTINCT ON (h.order_id)
         h.order_id,
         h.changed_by,
         h.changed_by_name,
         h.changed_at
  FROM public.order_history h
  JOIN public.user_roles ur
    ON ur.user_id = h.changed_by
   AND ur.role IN ('agent', 'pending_agent', 'prediction_agent')
  WHERE h.to_status = 'confirmed'
  ORDER BY h.order_id, h.changed_at ASC
)
UPDATE public.orders o
SET confirmed_by_agent_id = fac.changed_by,
    confirmed_by_name     = fac.changed_by_name,
    confirmed_at          = fac.changed_at
FROM first_agent_confirm fac
WHERE o.id = fac.order_id
  AND o.created_at >= '2026-05-18'
  AND fac.changed_by IS DISTINCT FROM o.confirmed_by_agent_id
  AND (
    o.confirmed_by_agent_id IS NULL
    OR (
      -- current holder is a pure super-admin (admin/manager and NOT an agent)
      EXISTS (
        SELECT 1 FROM public.user_roles ura
        WHERE ura.user_id = o.confirmed_by_agent_id
          AND ura.role IN ('admin', 'manager')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles urb
        WHERE urb.user_id = o.confirmed_by_agent_id
          AND urb.role IN ('agent', 'pending_agent', 'prediction_agent')
      )
    )
  );
