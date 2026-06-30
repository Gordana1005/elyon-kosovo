
-- Create webhooks table
CREATE TABLE public.webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  description text DEFAULT '',
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  total_leads integer NOT NULL DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

-- Only admins can manage webhooks
CREATE POLICY "Admins can manage webhooks" ON public.webhooks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Add webhook_id to inbound_leads
ALTER TABLE public.inbound_leads ADD COLUMN webhook_id uuid REFERENCES public.webhooks(id) ON DELETE SET NULL;
ALTER TABLE public.inbound_leads ADD COLUMN product_name text DEFAULT '';

-- Trigger to update updated_at
CREATE TRIGGER update_webhooks_updated_at
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
