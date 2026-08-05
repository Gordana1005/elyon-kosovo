-- Trigram index for the GET /orders leading-wildcard ILIKE on product_name.
-- Rationale and the single-statement-per-file constraint that CONCURRENTLY
-- imposes are documented in 20260912000000_orders_search_trgm.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_trgm_product_name ON public.orders USING gin (product_name gin_trgm_ops);
