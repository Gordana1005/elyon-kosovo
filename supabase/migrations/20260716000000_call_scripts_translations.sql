-- Make call_scripts locale-aware so the per-product talk tracks + helpers can be
-- shown in the agent's active app language (EN / BG / SQ), not just Bulgarian.
--
-- The existing title / description / script_text / helpers columns remain the
-- BULGARIAN BASE and the per-field fallback. This adds a single jsonb blob that
-- holds the other languages, keyed by the same language codes the UI uses
-- (src/i18n SUPPORTED_LANGUAGES = 'en' | 'bg' | 'sq'):
--
--   {
--     "en": { "title": "...", "description": "...", "script_text": "...",
--             "helpers": [ { "title": "...", "content": "...", "category": "..." } ] },
--     "sq": { ... same shape ... }
--   }
--
-- Resolution (src/lib/callScripts.ts) falls back PER FIELD to the base column, so a
-- partially translated script never renders blanks. Adding a 4th language later needs
-- no migration. Default '{}' keeps every existing row working with zero backfill.
-- Purely additive and forward-only — same pattern as the helpers column.

ALTER TABLE public.call_scripts
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.call_scripts.translations IS
  'Per-language variants of the script, keyed by UI language code (en/bg/sq). Shape: { "<lang>": { title, description, script_text, helpers:[{title,content,category?}] } }. The base columns (title/description/script_text/helpers) are the Bulgarian source + per-field fallback. Resolved in src/lib/callScripts.ts.';
