
CREATE TABLE public.blocked_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  attempt_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reason TEXT NOT NULL DEFAULT 'Outside shift hours',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.blocked_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage blocked login attempts" ON public.blocked_login_attempts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage blocked login attempts" ON public.blocked_login_attempts FOR ALL TO public USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Agents can insert own blocked attempts" ON public.blocked_login_attempts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
