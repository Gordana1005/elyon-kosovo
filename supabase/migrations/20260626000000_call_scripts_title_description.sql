-- Add title and description to call_scripts to support multiple product scripts
ALTER TABLE call_scripts ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE call_scripts ADD COLUMN IF NOT EXISTS description TEXT;

-- Backfill titles for any existing legacy scripts
UPDATE call_scripts SET title = 'Prediction Lead Script' WHERE context_type = 'prediction_lead' AND title = '';
UPDATE call_scripts SET title = 'Order Script'           WHERE context_type = 'order'           AND title = '';
