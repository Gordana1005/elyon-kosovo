
-- Shift login logs table for tracking agent login/logout per shift
CREATE TABLE public.shift_login_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE CASCADE NOT NULL,
  shift_date date NOT NULL,
  shift_start_time time NOT NULL,
  shift_end_time time NOT NULL,
  login_time timestamptz NOT NULL DEFAULT now(),
  logout_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shift_login_logs ENABLE ROW LEVEL SECURITY;

-- Admins can manage all
CREATE POLICY "Admins can manage shift login logs" ON public.shift_login_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Managers can manage all
CREATE POLICY "Managers can manage shift login logs" ON public.shift_login_logs
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'manager'));

-- Agents can view own logs
CREATE POLICY "Agents can view own shift login logs" ON public.shift_login_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Agents can insert own logs
CREATE POLICY "Agents can insert own shift login logs" ON public.shift_login_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Agents can update own logs (for logout_time)
CREATE POLICY "Agents can update own shift login logs" ON public.shift_login_logs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
