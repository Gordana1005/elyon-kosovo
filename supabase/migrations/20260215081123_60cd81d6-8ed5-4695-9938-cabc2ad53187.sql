
-- Call scripts (admin-editable, one per context type)
CREATE TABLE public.call_scripts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  context_type text NOT NULL UNIQUE CHECK (context_type IN ('prediction_lead', 'order')),
  script_text text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.call_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view call scripts"
  ON public.call_scripts FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage call scripts"
  ON public.call_scripts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed default scripts
INSERT INTO public.call_scripts (context_type, script_text) VALUES
  ('prediction_lead', 'Hello, this is [Your Name] calling from [Company]. Am I speaking with [Customer Name]?

I am calling regarding [Product]. We have a special offer for you today.

Key points to cover:
- Confirm customer interest
- Verify delivery address and phone number
- Explain pricing and delivery terms
- Answer any questions

Thank you for your time!'),
  ('order', 'Hello, this is [Your Name] calling from [Company]. Am I speaking with [Customer Name]?

I am calling regarding your order [Order ID] for [Product].

Key points:
- Confirm order details
- Verify delivery address
- Confirm delivery time preference
- Answer any questions

Thank you for your time!');

-- Call logs
CREATE TABLE public.call_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL,
  context_type text NOT NULL CHECK (context_type IN ('prediction_lead', 'order')),
  context_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('no_answer', 'interested', 'not_interested', 'wrong_number', 'call_again')),
  notes text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can insert own call logs"
  ON public.call_logs FOR INSERT
  WITH CHECK (agent_id = auth.uid());

CREATE POLICY "Agents can view own call logs"
  ON public.call_logs FOR SELECT
  USING (agent_id = auth.uid());

CREATE POLICY "Admins can manage all call logs"
  ON public.call_logs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for fast lookups
CREATE INDEX idx_call_logs_context ON public.call_logs (context_type, context_id);
CREATE INDEX idx_call_logs_agent ON public.call_logs (agent_id);
