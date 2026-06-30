
-- Add 'delivered' to the order_status enum
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'delivered' AFTER 'shipped';

-- Add source tracking columns to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'manual';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_lead_id uuid REFERENCES public.prediction_leads(id) ON DELETE SET NULL;

-- Index for fast lookups by source lead
CREATE INDEX IF NOT EXISTS idx_orders_source_lead_id ON public.orders(source_lead_id) WHERE source_lead_id IS NOT NULL;
