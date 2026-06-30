-- Shift breaks — track when an agent is on a paused/break period during a shift
-- (cigarette, lunch, etc). One row per break; break_end NULL = currently on break.
-- Surfaced live on the Calls page (Break / End Break button + timer) and
-- summarised per shift on the My Shifts page.

CREATE TABLE public.shift_breaks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_id    uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  shift_date  date NOT NULL,
  break_start timestamptz NOT NULL DEFAULT now(),
  break_end   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast "is this agent currently on break?" lookup (only one open break per user).
CREATE UNIQUE INDEX idx_shift_breaks_one_open_per_user
  ON public.shift_breaks(user_id)
  WHERE break_end IS NULL;

CREATE INDEX idx_shift_breaks_user_date ON public.shift_breaks(user_id, shift_date);

ALTER TABLE public.shift_breaks ENABLE ROW LEVEL SECURITY;

-- Agents manage their own breaks; admins/managers see everyone's.
CREATE POLICY "Agents view own breaks" ON public.shift_breaks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_manager(auth.uid()));

CREATE POLICY "Agents insert own breaks" ON public.shift_breaks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Agents update own breaks" ON public.shift_breaks
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins manage all breaks" ON public.shift_breaks
  FOR ALL TO authenticated
  USING (public.is_admin_or_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_manager(auth.uid()));
