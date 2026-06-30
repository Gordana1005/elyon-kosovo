-- Add barcode column to products (sourced from the BigArena fulfilment
-- panel). Unique-when-present so two different SKUs can't share the same
-- physical EAN; multiple NULLs are fine because the unique index is
-- partial.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique
  ON public.products(barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';
