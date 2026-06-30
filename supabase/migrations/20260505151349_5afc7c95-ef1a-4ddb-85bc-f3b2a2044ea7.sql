DROP POLICY IF EXISTS "Agents can view inventory logs" ON public.inventory_logs;
CREATE POLICY "Admins managers and warehouse can view inventory logs"
  ON public.inventory_logs FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  );