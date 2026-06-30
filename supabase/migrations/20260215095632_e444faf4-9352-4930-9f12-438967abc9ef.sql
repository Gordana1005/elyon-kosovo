
-- Fix 1: Add role-based filtering to check_phone_duplicates
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
    AND (caller_is_admin OR o.assigned_agent_id = auth.uid())
    UNION ALL
    SELECT 'prediction_lead'::TEXT, pl.name, pl2.name
    FROM public.prediction_leads pl
    JOIN public.prediction_lists pl2 ON pl2.id = pl.list_id
    WHERE regexp_replace(pl.telephone, '[^0-9+]', '', 'g') = normalized
    AND (caller_is_admin OR pl.assigned_agent_id = auth.uid());
END;
$function$;

-- Fix 2: Update ads RLS policies to allow admin OR ads_admin
DROP POLICY IF EXISTS "Ads admins can manage campaigns" ON public.ads_campaigns;
CREATE POLICY "Admins and ads admins can manage campaigns"
ON public.ads_campaigns FOR ALL
USING (
  has_role(auth.uid(), 'ads_admin'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Ads admins can view audit logs" ON public.ads_audit_logs;
CREATE POLICY "Admins and ads admins can view audit logs"
ON public.ads_audit_logs FOR ALL
USING (
  has_role(auth.uid(), 'ads_admin'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);
