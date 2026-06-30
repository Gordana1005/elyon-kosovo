
-- Add quantity column to orders (default 1)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- Add quantity and price columns to prediction_leads
ALTER TABLE public.prediction_leads ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;
ALTER TABLE public.prediction_leads ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0;

-- Add cost_price to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0;
