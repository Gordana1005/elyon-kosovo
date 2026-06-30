
-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');

CREATE TYPE public.order_status AS ENUM (
  'pending', 'take', 'call_again', 'confirmed',
  'shipped', 'returned', 'paid', 'trashed', 'cancelled'
);

CREATE TYPE public.lead_status AS ENUM (
  'not_contacted', 'no_answer', 'interested', 'not_interested', 'confirmed'
);

-- ============================================================
-- PROFILES TABLE
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- USER ROLES TABLE
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECURITY DEFINER: has_role (avoids RLS recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Helper: get current user role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- PRODUCTS TABLE
-- ============================================================
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ORDERS TABLE
-- ============================================================
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id TEXT NOT NULL UNIQUE,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_city TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  postal_code TEXT DEFAULT '',
  birthday DATE,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  status order_status NOT NULL DEFAULT 'pending',
  assigned_agent_id UUID REFERENCES auth.users(id),
  assigned_agent_name TEXT,
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Auto-generate display_id sequence
CREATE SEQUENCE public.order_display_id_seq START 1001;

CREATE OR REPLACE FUNCTION public.generate_order_display_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.display_id IS NULL OR NEW.display_id = '' THEN
    NEW.display_id := 'ORD-' || LPAD(nextval('public.order_display_id_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_display_id
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.generate_order_display_id();

-- ============================================================
-- ORDER HISTORY (status changes log)
-- ============================================================
CREATE TABLE public.order_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ORDER NOTES
-- ============================================================
CREATE TABLE public.order_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  author_id UUID REFERENCES auth.users(id),
  author_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PREDICTION LISTS
-- ============================================================
CREATE TABLE public.prediction_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_records INT NOT NULL DEFAULT 0,
  assigned_count INT NOT NULL DEFAULT 0
);

ALTER TABLE public.prediction_lists ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PREDICTION LEADS
-- ============================================================
CREATE TABLE public.prediction_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES public.prediction_lists(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  product TEXT DEFAULT '',
  status lead_status NOT NULL DEFAULT 'not_contacted',
  assigned_agent_id UUID REFERENCES auth.users(id),
  assigned_agent_name TEXT,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.prediction_leads ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prediction_leads_updated_at BEFORE UPDATE ON public.prediction_leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- PROFILES: admins see all, users see own
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- USER ROLES: admins manage, users read own
CREATE POLICY "Users can view own role" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- PRODUCTS: all authenticated can read, admins can manage
CREATE POLICY "Authenticated can view products" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage products" ON public.products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ORDERS: admins see all, agents see assigned
CREATE POLICY "Admins can manage orders" ON public.orders
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view assigned orders" ON public.orders
  FOR SELECT TO authenticated
  USING (assigned_agent_id = auth.uid());

CREATE POLICY "Agents can update assigned orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (assigned_agent_id = auth.uid());

-- ORDER HISTORY: same as orders access
CREATE POLICY "Admins can manage order history" ON public.order_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view own order history" ON public.order_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_history.order_id
      AND orders.assigned_agent_id = auth.uid()
    )
  );

CREATE POLICY "Agents can insert order history" ON public.order_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_history.order_id
      AND orders.assigned_agent_id = auth.uid()
    )
  );

-- ORDER NOTES: admins all, agents on assigned orders
CREATE POLICY "Admins can manage notes" ON public.order_notes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view notes on assigned orders" ON public.order_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_notes.order_id
      AND orders.assigned_agent_id = auth.uid()
    )
  );

CREATE POLICY "Agents can add notes on assigned orders" ON public.order_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_notes.order_id
      AND orders.assigned_agent_id = auth.uid()
    )
  );

-- PREDICTION LISTS: admins manage, agents can view
CREATE POLICY "Admins can manage prediction lists" ON public.prediction_lists
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view prediction lists" ON public.prediction_lists
  FOR SELECT TO authenticated
  USING (true);

-- PREDICTION LEADS: admins manage, agents see assigned
CREATE POLICY "Admins can manage prediction leads" ON public.prediction_leads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view assigned leads" ON public.prediction_leads
  FOR SELECT TO authenticated
  USING (assigned_agent_id = auth.uid());

CREATE POLICY "Agents can update assigned leads" ON public.prediction_leads
  FOR UPDATE TO authenticated
  USING (assigned_agent_id = auth.uid());

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_assigned_agent ON public.orders(assigned_agent_id);
CREATE INDEX idx_orders_created_at ON public.orders(created_at);
CREATE INDEX idx_orders_customer_phone ON public.orders(customer_phone);
CREATE INDEX idx_order_history_order_id ON public.order_history(order_id);
CREATE INDEX idx_order_notes_order_id ON public.order_notes(order_id);
CREATE INDEX idx_prediction_leads_list_id ON public.prediction_leads(list_id);
CREATE INDEX idx_prediction_leads_agent ON public.prediction_leads(assigned_agent_id);
CREATE INDEX idx_prediction_leads_phone ON public.prediction_leads(telephone);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

-- ============================================================
-- DUPLICATE PHONE CHECK FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_phone_duplicates(_phone TEXT, _exclude_order_id UUID DEFAULT NULL)
RETURNS TABLE(source TEXT, source_id TEXT, source_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized TEXT;
BEGIN
  normalized := regexp_replace(_phone, '[^0-9+]', '', 'g');
  IF length(normalized) < 8 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT 'order'::TEXT, o.display_id, o.customer_name
    FROM public.orders o
    WHERE regexp_replace(o.customer_phone, '[^0-9+]', '', 'g') = normalized
    AND (_exclude_order_id IS NULL OR o.id != _exclude_order_id)
    UNION ALL
    SELECT 'prediction_lead'::TEXT, pl.name, pl2.name
    FROM public.prediction_leads pl
    JOIN public.prediction_lists pl2 ON pl2.id = pl.list_id
    WHERE regexp_replace(pl.telephone, '[^0-9+]', '', 'g') = normalized;
END;
$$;
