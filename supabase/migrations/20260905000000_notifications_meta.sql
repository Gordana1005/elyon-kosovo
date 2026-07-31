-- ============================================================================
-- notifications.meta — translatable notification bodies (2026-09-05)
-- ============================================================================
-- Every notification written so far stores ENGLISH title/message text produced
-- inside a SQL trigger (missed_call, order_returned, order_paid, low_stock), so
-- an agent running the UI in Bulgarian or Albanian still reads English in the
-- bell. That breaks the elyon-i18n rule ("never hardcode user-facing text").
--
-- Rather than translate inside SQL (the DB has no notion of the reader's
-- language), a notification may now carry a small structured payload:
--
--   meta = {"i18n": "notif.shippedUnpaid", "order": "ORD-37262",
--           "customer": "Ivan Petrov", "days": 4, ...}
--
-- The bell renders `t(meta.i18n + '.title' | '.body', { ...meta })` and falls
-- back to the stored title/message via i18next `defaultValue`. So:
--   * meta IS NULL      -> legacy row, rendered verbatim (all 11.5k existing rows)
--   * meta present      -> rendered in the reader's own language
--   * meta present but the locale key is missing -> falls back to the English
--     text that is ALWAYS still written alongside it. There is no way for this
--     to render an empty or `⟪key⟫` notification.
--
-- Interpolated values are DB data (order id, customer name, counts) — never
-- translated, per the i18n skill's "what is NEVER translated" list.
--
-- No RLS change: the existing own-row SELECT policy covers every column.
-- ============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS meta jsonb;

COMMENT ON COLUMN public.notifications.meta IS
  '2026-09: optional {i18n:"notif.<key>", ...interpolation vars} so the bell can render the row in the reader''s language (BG/EN/SQ). NULL = legacy row, render title/message verbatim. The English title/message are always written too and act as the fallback.';
