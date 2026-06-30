
-- Table for landing page webhook leads
CREATE TABLE public.inbound_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT DEFAULT 'landing_page',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inbound_leads ENABLE ROW LEVEL SECURITY;

-- Admins can manage all inbound leads
CREATE POLICY "Admins can manage inbound leads"
  ON public.inbound_leads FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role inserts via webhook (no user auth needed - handled in edge function)
-- No public policy needed since webhook uses service role key

-- Timestamp trigger
CREATE TRIGGER update_inbound_leads_updated_at
  BEFORE UPDATE ON public.inbound_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
