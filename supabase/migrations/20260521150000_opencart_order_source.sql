-- naturatherapy.bg (OpenCart) → CRM order bridge.
--
-- New orders placed on naturatherapy.bg are pushed into the CRM via the
-- HMAC-signed POST /webhook/opencart endpoint. Each push carries the OpenCart
-- order id so re-fires (live event + historical import + status upgrades) are
-- idempotent rather than creating duplicate pendings.
--
--   external_source    'naturatherapy.bg'  — which storefront the order came from
--   external_order_id  the OpenCart order_id (text, so it survives any prefixing)
--
-- The partial-unique index lets us upsert on (external_source, external_order_id):
-- an order that starts life as an abandoned-cart lead and is later completed
-- upgrades the SAME CRM row instead of duplicating it.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_external_ref
  ON public.orders (external_source, external_order_id)
  WHERE external_order_id IS NOT NULL;

-- Fast filter for the Orders/Assigner "source" views.
CREATE INDEX IF NOT EXISTS idx_orders_source_type
  ON public.orders (source_type)
  WHERE source_type IS NOT NULL;
