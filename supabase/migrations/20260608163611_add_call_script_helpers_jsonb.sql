-- Add helpers (jsonb array) to call_scripts for the new combined Scripts + Helpers / Call Support system on the Calls page.
-- Each product script can now carry its own set of 8-12+ pressable helpers (cross-sell, objections like "I am not feeling anything", nutrients, dosage, safety, value props, etc.).
-- Stored as: [{"title": "...", "content": "...", "category": "objection|crosssell|fact|..."}]
-- Default [] keeps all existing rows (legacy + current product scripts) working with zero migration pain.
-- This is purely additive and forward-only.

ALTER TABLE public.call_scripts
  ADD COLUMN IF NOT EXISTS helpers jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.call_scripts.helpers IS 'Agent support helpers (FAQ-style quick references) attached to a product script. Used in the 30% pane of the Calls dossier Scripts+Helpers view. Array of {title, content, category?}.';
