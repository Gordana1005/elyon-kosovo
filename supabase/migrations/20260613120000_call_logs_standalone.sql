-- Allow logging calls that have NO order/lead context — e.g. dialing a brand-new
-- number from the topbar "dial new number" box. Previously finalize() silently
-- dropped these ("not saved to history"). Adds a 'standalone' context_type and
-- makes context_id nullable. Order/lead side-effects are skipped server-side for
-- standalone calls (the handler only acts when context_type is 'order'/'prediction_lead').

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_context_type_check;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_context_type_check
  CHECK (context_type IN ('prediction_lead', 'order', 'standalone'));

ALTER TABLE public.call_logs ALTER COLUMN context_id DROP NOT NULL;
