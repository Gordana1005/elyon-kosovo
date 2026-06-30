
-- Create order_items table for multi-product orders
CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  price_per_unit NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- RLS policies matching orders table access
CREATE POLICY "Admins can manage order items"
ON public.order_items FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage order items"
ON public.order_items FOR ALL
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Agents can view order items for assigned orders"
ON public.order_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.assigned_agent_id = auth.uid()
));

CREATE POLICY "Agents can manage order items for assigned orders"
ON public.order_items FOR ALL
USING (EXISTS (
  SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.assigned_agent_id = auth.uid()
));

-- Warehouse can view order items
CREATE POLICY "Warehouse can view order items"
ON public.order_items FOR SELECT
USING (has_role(auth.uid(), 'warehouse'::app_role));

-- Index for fast lookups
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);

-- Trigger for updated_at
CREATE TRIGGER update_order_items_updated_at
BEFORE UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
