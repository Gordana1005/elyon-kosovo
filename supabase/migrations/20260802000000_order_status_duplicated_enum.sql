-- Add 'duplicated' to order_status enum.
-- MUST stay alone in this migration: a new enum value cannot be referenced
-- in the same transaction that adds it.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'duplicated';
