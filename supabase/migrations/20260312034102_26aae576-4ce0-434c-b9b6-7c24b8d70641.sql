
CREATE TABLE public.shift_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage shift templates" ON public.shift_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage shift templates" ON public.shift_templates
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Authenticated can view shift templates" ON public.shift_templates
  FOR SELECT TO authenticated
  USING (true);
