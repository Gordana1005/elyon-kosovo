-- Team-wide "listened" mark on call recordings: set once a reviewer
-- (hear-all recording role) has actually played >=10s of the recording.
-- First listener wins; the point is "someone reviewed this call", not
-- per-user tracking. Written only by POST /api/call-logs/:id/listened.
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS listened_at timestamptz,
  ADD COLUMN IF NOT EXISTS listened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
