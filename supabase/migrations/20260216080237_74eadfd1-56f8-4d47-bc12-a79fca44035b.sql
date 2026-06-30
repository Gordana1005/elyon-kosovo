-- Add inbound_lead_id column to orders for linking to inbound leads
ALTER TABLE public.orders ADD COLUMN inbound_lead_id uuid REFERENCES public.inbound_leads(id);

-- Create index for lookups
CREATE INDEX idx_orders_inbound_lead_id ON public.orders(inbound_lead_id);