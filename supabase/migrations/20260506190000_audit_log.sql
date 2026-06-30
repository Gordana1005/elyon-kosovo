-- Phase 3 — audit_log table
--
-- Records who did what to whom. Written from the edge function on every
-- privileged operation (user create/delete, role change, bulk assignment,
-- product/webhook CRUD, etc). Read by admins only.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  action       text NOT NULL,                  -- e.g. 'user.create', 'order.bulk_assign'
  target_type  text,                            -- 'user' | 'order' | 'lead' | 'product' | 'webhook' | …
  target_id    text,                            -- string for portability across pk types
  target_name  text,                            -- human-readable identifier
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Hot indexes for the typical queries
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at        ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor             ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action            ON public.audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target            ON public.audit_log(target_type, target_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins (and managers) can read the audit log.
CREATE POLICY "Admins/Managers read audit_log"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

-- Inserts come exclusively from the edge function via the service-role key,
-- which bypasses RLS. We deliberately do NOT add an INSERT policy for any
-- other role — there should be no path for users to forge audit records.

-- Append-only: nobody (including admins) can update or delete audit rows.
-- (Absence of UPDATE/DELETE policies + RLS enabled = denied for everyone
-- including service role for those operations? No — service role still
-- bypasses RLS. So we additionally REVOKE update/delete from service role
-- via a CHECK trigger that simply rejects mutations.)
CREATE OR REPLACE FUNCTION public.audit_log_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_block_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_no_mutation();

CREATE TRIGGER audit_log_block_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_no_mutation();

COMMENT ON TABLE public.audit_log IS
  'Append-only record of privileged operations. Inserted from the edge '
  'function via service role; readable by admin/manager. Tamper-resistant: '
  'BEFORE UPDATE/DELETE triggers reject mutations, even by the service role.';
