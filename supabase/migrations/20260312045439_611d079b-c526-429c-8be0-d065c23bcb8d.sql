
-- Lead Distribution Configuration
CREATE TABLE public.lead_distribution_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy text NOT NULL DEFAULT 'round_robin' CHECK (strategy IN ('round_robin', 'load_balance', 'priority')),
  is_active boolean NOT NULL DEFAULT false,
  max_leads_per_agent integer NOT NULL DEFAULT 50,
  priority_threshold numeric NOT NULL DEFAULT 500,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.lead_distribution_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage lead_distribution_config" ON public.lead_distribution_config
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage lead_distribution_config" ON public.lead_distribution_config
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Authenticated can view lead_distribution_config" ON public.lead_distribution_config
  FOR SELECT TO authenticated USING (true);

-- Seed default config
INSERT INTO public.lead_distribution_config (strategy, is_active, max_leads_per_agent, priority_threshold)
VALUES ('round_robin', false, 50, 500);
