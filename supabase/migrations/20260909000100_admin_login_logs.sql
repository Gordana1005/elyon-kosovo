-- M8: admin and manager logins were never recorded anywhere.
--
-- check-login returns {allowed:true, bypass:true} for admin/manager without
-- writing a row, and LoginPage only writes shift_login_logs when !bypass — so
-- the highest-privilege accounts had no login trail at all, while agents had a
-- full one. audit_log has no auth.* actions either.
--
-- A separate table rather than reusing shift_login_logs: that table's shift_id,
-- shift_date, shift_start_time and shift_end_time are all NOT NULL and eight
-- consumers read it as "who was on shift". An admin login has no shift, so
-- relaxing those columns would mean teaching every consumer to filter.
--
-- Rollback: DROP TABLE public.admin_login_logs;

CREATE TABLE IF NOT EXISTS public.admin_login_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  roles      text[] NOT NULL DEFAULT '{}',
  ip         text,
  user_agent text,
  login_time timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_login_logs_time
  ON public.admin_login_logs (login_time DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_logs_user
  ON public.admin_login_logs (user_id, login_time DESC);

ALTER TABLE public.admin_login_logs ENABLE ROW LEVEL SECURITY;

-- Read-only, admins only. Managers are excluded on purpose: this is the record
-- of privileged access, and a manager is one of the subjects it records.
CREATE POLICY "Admins can read admin login logs"
  ON public.admin_login_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Writes are service-role only (the edge function inserts on the bypass branch).
-- No INSERT/UPDATE/DELETE policy exists, and the grants go too so that a future
-- policy cannot silently re-open the table.
REVOKE ALL ON public.admin_login_logs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.admin_login_logs FROM authenticated;

NOTIFY pgrst, 'reload schema';
