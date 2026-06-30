
-- Order locks table for preventing concurrent editing
CREATE TABLE public.order_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  locked_by uuid NOT NULL,
  locked_by_name text NOT NULL DEFAULT '',
  locked_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.order_locks ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can view locks (to check if locked)
CREATE POLICY "Authenticated can view order locks"
  ON public.order_locks FOR SELECT TO authenticated
  USING (true);

-- Admins/managers can manage all locks
CREATE POLICY "Admins can manage order locks"
  ON public.order_locks FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage order locks"
  ON public.order_locks FOR ALL TO public
  USING (has_role(auth.uid(), 'manager'::app_role));

-- Users can insert their own locks
CREATE POLICY "Users can insert own locks"
  ON public.order_locks FOR INSERT TO authenticated
  WITH CHECK (locked_by = auth.uid());

-- Users can delete their own locks
CREATE POLICY "Users can delete own locks"
  ON public.order_locks FOR DELETE TO authenticated
  USING (locked_by = auth.uid());

-- Auto-expire locks older than 10 minutes via a function
CREATE OR REPLACE FUNCTION public.cleanup_expired_order_locks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.order_locks WHERE locked_at < now() - interval '10 minutes';
$$;
