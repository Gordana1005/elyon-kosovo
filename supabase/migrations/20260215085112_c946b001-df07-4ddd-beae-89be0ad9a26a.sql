
-- Create user_warehouse table for assigning products/items to users
CREATE TABLE public.user_warehouse (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);

-- Enable RLS
ALTER TABLE public.user_warehouse ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage user warehouse"
ON public.user_warehouse
FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Agents can view their own assigned items
CREATE POLICY "Users can view own warehouse items"
ON public.user_warehouse
FOR SELECT
USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_user_warehouse_updated_at
BEFORE UPDATE ON public.user_warehouse
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
