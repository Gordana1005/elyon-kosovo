-- Phase 3 — granular address + delivery instructions + gift note on orders.
--
-- The Confirm-Order modal (opened during a call) needs to capture:
--   street / apartment / floor / building     (separate from city, postal_code)
--   delivery_instructions                      (free-text, e.g. "after 6pm")
--   gift_note                                  (free-text, e.g. "voucher 10€")
--
-- These are passive metadata — the segment classifier doesn't read them, so no
-- trigger or function changes are needed. Existing rows get '' defaults.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS street TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS apartment TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS floor TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS building TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_instructions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gift_note TEXT NOT NULL DEFAULT '';
