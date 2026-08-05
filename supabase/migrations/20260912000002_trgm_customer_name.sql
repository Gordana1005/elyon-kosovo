-- Trigram index for the GET /orders leading-wildcard ILIKE on customer_name.
-- Rationale and the single-statement-per-file constraint that CONCURRENTLY
-- imposes are documented in 20260912000000_orders_search_trgm.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_trgm_customer_name ON public.orders USING gin (customer_name gin_trgm_ops);
