-- Duplicate-order feature: permanent link to the source order + agent leak-proofing.
-- Duplicated orders (duplicated_from IS NOT NULL) are visible to admin/manager only,
-- forever, regardless of their current status.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS duplicated_from uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicated_from_display text NULL;

CREATE INDEX IF NOT EXISTS orders_duplicated_from_idx ON public.orders(duplicated_from)
  WHERE duplicated_from IS NOT NULL;

-- Agents must never see duplicates, even if one were ever assigned to them.
DROP POLICY IF EXISTS "Agents can view assigned orders" ON public.orders;
CREATE POLICY "Agents can view assigned orders" ON public.orders
  FOR SELECT TO authenticated
  USING (assigned_agent_id = auth.uid() AND duplicated_from IS NULL);

DROP POLICY IF EXISTS "Agents can update assigned orders" ON public.orders;
CREATE POLICY "Agents can update assigned orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (assigned_agent_id = auth.uid() AND duplicated_from IS NULL);

-- check_phone_duplicates is SECURITY DEFINER: exclude duplicates from the
-- non-admin branch so the phone-duplicate popup can't leak them to agents.
CREATE OR REPLACE FUNCTION public.check_phone_duplicates(_phone text, _exclude_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(source text, source_id text, source_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  normalized TEXT;
  caller_is_admin BOOLEAN;
BEGIN
  normalized := regexp_replace(_phone, '[^0-9+]', '', 'g');
  IF length(normalized) < 8 THEN
    RETURN;
  END IF;

  caller_is_admin := public.has_role(auth.uid(), 'admin'::app_role);

  RETURN QUERY
    SELECT 'order'::TEXT, o.display_id, o.customer_name
    FROM public.orders o
    WHERE regexp_replace(o.customer_phone, '[^0-9+]', '', 'g') = normalized
    AND (_exclude_order_id IS NULL OR o.id != _exclude_order_id)
    AND (caller_is_admin OR (o.assigned_agent_id = auth.uid() AND o.duplicated_from IS NULL))
    UNION ALL
    SELECT 'prediction_lead'::TEXT, pl.name, pl2.name
    FROM public.prediction_leads pl
    JOIN public.prediction_lists pl2 ON pl2.id = pl.list_id
    WHERE regexp_replace(pl.telephone, '[^0-9+]', '', 'g') = normalized
    AND (caller_is_admin OR pl.assigned_agent_id = auth.uid());
END;
$function$;

NOTIFY pgrst, 'reload schema';
