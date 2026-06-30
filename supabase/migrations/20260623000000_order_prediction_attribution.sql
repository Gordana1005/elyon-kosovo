-- ============================================================
-- Order → Prediction-List attribution (snapshot at order time)
-- ============================================================
-- WHY: Customers are grouped into prediction lists by two systems:
--   • rule-driven segments  (prediction_segment_members / prediction_segment_lists)
--   • manually-uploaded     (prediction_leads / prediction_lists)
-- Rule-driven membership is DYNAMIC — recomputed by trg_orders_recompute_segments
-- every time an order changes — so the list a customer was in AT ORDER TIME cannot
-- be reconstructed later. We therefore SNAPSHOT the attribution onto the order row
-- when it is created (see resolvePredictionAttribution in functions/api/index.ts).
--
-- These columns power both:
--   1. Prediction-list revenue analytics (Management Insights → Prediction Lists)
--   2. Per-package agent bonuses (only prediction-list orders earn) — see the
--      elyon-agent-commissions skill.
--
-- The *_name snapshot is the durable label: it survives a list being renamed or
-- deleted, so historical analytics never lose their grouping.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prediction_list_id       UUID,
  ADD COLUMN IF NOT EXISTS prediction_list_type     TEXT
    CHECK (prediction_list_type IN ('segment', 'uploaded')),
  ADD COLUMN IF NOT EXISTS prediction_list_name     TEXT,
  ADD COLUMN IF NOT EXISTS prediction_list_category TEXT;

COMMENT ON COLUMN public.orders.prediction_list_id IS
  'Snapshot: id of the prediction list (segment list OR uploaded list) the customer was in when the order was created. NULL = not from a prediction list.';
COMMENT ON COLUMN public.orders.prediction_list_type IS
  'segment = rule-driven (prediction_segment_lists); uploaded = manual campaign (prediction_lists).';
COMMENT ON COLUMN public.orders.prediction_list_name IS
  'Snapshot label of the list at order time — durable even if the list is renamed/deleted.';
COMMENT ON COLUMN public.orders.prediction_list_category IS
  'For segment lists: value | prestige | cancel | return | other. NULL for uploaded lists.';

-- Analytics + bonus gate both filter on "is this a prediction-list order".
CREATE INDEX IF NOT EXISTS idx_orders_prediction_list
  ON public.orders (prediction_list_id)
  WHERE prediction_list_id IS NOT NULL;

-- ── Best-effort backfill (uploaded lists only, reliable) ──────────────
-- Orders explicitly created from an uploaded prediction lead carry
-- source_type='prediction_lead' + source_lead_id. Where present, attribute them.
-- (Segment attribution is NOT backfilled — past membership was dynamic and is
--  unrecoverable; analytics is accurate from this deploy forward.)
UPDATE public.orders o
SET prediction_list_id   = pl.id,
    prediction_list_type = 'uploaded',
    prediction_list_name = pl.name,
    prediction_list_category = NULL
FROM public.prediction_leads pld
JOIN public.prediction_lists pl ON pl.id = pld.list_id
WHERE o.source_type = 'prediction_lead'
  AND o.source_lead_id = pld.id
  AND o.prediction_list_id IS NULL;
