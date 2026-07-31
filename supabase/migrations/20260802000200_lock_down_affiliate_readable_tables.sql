-- SECURITY FIX (2026-07-11): five tables had permissive SELECT policies that
-- granted access to ANY authenticated login (`true` / `auth.uid() IS NOT NULL`).
-- These predate affiliate logins (external partners, app_role 'affiliate'), who
-- could bypass the edge-function hard wall by querying PostgREST directly with
-- their own JWT and read customer PII, call history, product cost prices, etc.
--
-- Fix: gate those policies behind internal staff (any role that is NOT
-- 'affiliate') — mirroring the edge fn's `hasInternalRole` hard-wall logic.
-- Every server code path to these tables uses the service-role client (bypasses
-- RLS) or is reached only by internal staff (GET /api/products), and the
-- frontend never reads these tables directly, so internal behaviour is unchanged.

-- Internal-staff predicate: has at least one non-affiliate role. SECURITY
-- DEFINER so it can read user_roles regardless of the caller's own RLS.
CREATE OR REPLACE FUNCTION public.is_internal_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role <> 'affiliate'::app_role
  );
$$;

-- ── call_logs: was readable by any authenticated login ──
DROP POLICY IF EXISTS "Authenticated can view all call logs" ON public.call_logs;
CREATE POLICY "Internal staff can view call logs" ON public.call_logs
  FOR SELECT TO authenticated
  USING (public.is_internal_staff(auth.uid()));

-- ── customer_profiles: SELECT/INSERT/UPDATE were open to any authenticated login ──
DROP POLICY IF EXISTS "Authenticated can view customer profiles" ON public.customer_profiles;
CREATE POLICY "Internal staff can view customer profiles" ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (public.is_internal_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can insert customer profiles" ON public.customer_profiles;
CREATE POLICY "Internal staff can insert customer profiles" ON public.customer_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can update customer profiles" ON public.customer_profiles;
CREATE POLICY "Internal staff can update customer profiles" ON public.customer_profiles
  FOR UPDATE TO authenticated
  USING (public.is_internal_staff(auth.uid()))
  WITH CHECK (public.is_internal_staff(auth.uid()));

-- ── products: was readable by any authenticated login (leaked cost_price) ──
DROP POLICY IF EXISTS "Authenticated can view products" ON public.products;
CREATE POLICY "Internal staff can view products" ON public.products
  FOR SELECT TO authenticated
  USING (public.is_internal_staff(auth.uid()));

-- ── app_settings: was readable by any authenticated login ──
DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;
CREATE POLICY "Internal staff can read app_settings" ON public.app_settings
  FOR SELECT TO authenticated
  USING (public.is_internal_staff(auth.uid()));

-- ── courier_offices: was readable by any authenticated login ──
DROP POLICY IF EXISTS "Anyone authenticated can read courier offices" ON public.courier_offices;
CREATE POLICY "Internal staff can read courier offices" ON public.courier_offices
  FOR SELECT TO authenticated
  USING (public.is_internal_staff(auth.uid()));

NOTIFY pgrst, 'reload schema';
