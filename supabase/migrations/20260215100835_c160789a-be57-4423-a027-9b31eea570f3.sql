-- Fix: Add RLS policy for warehouse role users on user_warehouse table
CREATE POLICY "Warehouse users can manage all warehouse items"
ON public.user_warehouse
FOR ALL
USING (public.has_role(auth.uid(), 'warehouse'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'warehouse'::app_role));