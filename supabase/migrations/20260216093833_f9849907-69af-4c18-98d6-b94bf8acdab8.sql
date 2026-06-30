
-- Create suppliers table
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact_info TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage suppliers" ON public.suppliers FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Managers can manage suppliers" ON public.suppliers FOR ALL USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Authenticated can view suppliers" ON public.suppliers FOR SELECT USING (true);

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add category and supplier_id to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Add movement_type, invoice_number, supplier_name to inventory_logs
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS movement_type TEXT DEFAULT 'manual_adjust';
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS invoice_number TEXT DEFAULT '';
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS supplier_name TEXT DEFAULT '';
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
