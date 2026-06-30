
-- Create a helper function to check if user is admin or manager
CREATE OR REPLACE FUNCTION public.is_admin_or_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'manager')
  );
$$;

-- Update RLS policies for tables that managers should also access

-- orders: allow managers full access
CREATE POLICY "Managers can manage orders"
ON public.orders FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- order_history: allow managers full access
CREATE POLICY "Managers can manage order history"
ON public.order_history FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- order_notes: allow managers full access
CREATE POLICY "Managers can manage notes"
ON public.order_notes FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- prediction_leads: allow managers full access
CREATE POLICY "Managers can manage prediction leads"
ON public.prediction_leads FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- prediction_lists: allow managers full access
CREATE POLICY "Managers can manage prediction lists"
ON public.prediction_lists FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- products: allow managers full access
CREATE POLICY "Managers can manage products"
ON public.products FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- profiles: allow managers to view all profiles
CREATE POLICY "Managers can view all profiles"
ON public.profiles FOR SELECT
USING (public.has_role(auth.uid(), 'manager'));

-- user_roles: allow managers to view and manage roles
CREATE POLICY "Managers can view roles"
ON public.user_roles FOR SELECT
USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Managers can manage agent roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- shifts: allow managers full access
CREATE POLICY "Managers can manage shifts"
ON public.shifts FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- shift_assignments: allow managers full access
CREATE POLICY "Managers can manage shift assignments"
ON public.shift_assignments FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- call_scripts: allow managers full access
CREATE POLICY "Managers can manage call scripts"
ON public.call_scripts FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- call_logs: allow managers full access
CREATE POLICY "Managers can manage call logs"
ON public.call_logs FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- inbound_leads: allow managers full access
CREATE POLICY "Managers can manage inbound leads"
ON public.inbound_leads FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- webhooks: allow managers full access
CREATE POLICY "Managers can manage webhooks"
ON public.webhooks FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- inventory_logs: allow managers full access
CREATE POLICY "Managers can manage inventory logs"
ON public.inventory_logs FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- user_warehouse: allow managers full access
CREATE POLICY "Managers can manage user warehouse"
ON public.user_warehouse FOR ALL
USING (public.has_role(auth.uid(), 'manager'));

-- profiles: allow managers to update profiles
CREATE POLICY "Managers can update profiles"
ON public.profiles FOR UPDATE
USING (public.has_role(auth.uid(), 'manager'));

-- profiles: allow managers to delete profiles
CREATE POLICY "Managers can delete profiles"
ON public.profiles FOR DELETE
USING (public.has_role(auth.uid(), 'manager'));
