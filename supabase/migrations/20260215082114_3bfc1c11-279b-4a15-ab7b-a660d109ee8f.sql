
-- Shifts table
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage shifts" ON public.shifts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Shift Assignments table
CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id, user_id)
);

ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage shift assignments" ON public.shift_assignments FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can view own assignments" ON public.shift_assignments FOR SELECT
  USING (user_id = auth.uid());

-- Now safe to reference shift_assignments from shifts
CREATE POLICY "Agents can view their assigned shifts" ON public.shifts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shift_assignments sa WHERE sa.shift_id = shifts.id AND sa.user_id = auth.uid()
  ));

-- Trigger for updated_at
CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
