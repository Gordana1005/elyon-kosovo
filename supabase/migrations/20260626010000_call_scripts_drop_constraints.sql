-- Drop the check constraint that blocked 'product' as a context_type
ALTER TABLE call_scripts DROP CONSTRAINT IF EXISTS call_scripts_context_type_check;

-- Drop the unique constraint on context_type so multiple 'product' scripts can coexist
ALTER TABLE call_scripts DROP CONSTRAINT IF EXISTS call_scripts_context_type_key;

-- Add a partial unique index so prediction_lead/order still upsert correctly,
-- while multiple 'product' rows are freely allowed
CREATE UNIQUE INDEX IF NOT EXISTS call_scripts_legacy_unique
  ON call_scripts (context_type)
  WHERE context_type IN ('prediction_lead', 'order');
