
-- Create prediction_lead_items table for multi-product support
CREATE TABLE public.prediction_lead_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.prediction_leads(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  price_per_unit NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.prediction_lead_items ENABLE ROW LEVEL SECURITY;

-- RLS policies mirroring prediction_leads access
CREATE POLICY "Admins can manage prediction lead items"
  ON public.prediction_lead_items FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage prediction lead items"
  ON public.prediction_lead_items FOR ALL
  USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Agents can manage items for assigned leads"
  ON public.prediction_lead_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM prediction_leads
    WHERE prediction_leads.id = prediction_lead_items.lead_id
    AND prediction_leads.assigned_agent_id = auth.uid()
  ));

-- Trigger for updated_at
CREATE TRIGGER update_prediction_lead_items_updated_at
  BEFORE UPDATE ON public.prediction_lead_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_prediction_lead_items_lead_id ON public.prediction_lead_items(lead_id);
