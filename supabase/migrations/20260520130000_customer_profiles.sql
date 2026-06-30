-- Customer profiles — the first real customer-level store in the CRM.
-- Until now "customers" were virtual (inferred by grouping orders on
-- customer_phone), so per-customer facts like birthday, home address,
-- delivery preferences and free-form notes could only be saved by creating
-- an order. This table lets agents save that info during a call WITHOUT
-- creating an order, keyed by phone (E.164, e.g. +359...). The CreateOrder
-- modal pre-fills from it.

CREATE TABLE public.customer_profiles (
  phone                 text PRIMARY KEY,
  customer_name         text,
  birthday              date,
  street                text,
  apartment             text,
  floor                 text,
  building              text,
  city                  text,
  postal_code           text,
  delivery_type         text,
  courier_office_code   text,
  courier_office_name   text,
  courier_office_city   text,
  delivery_instructions text,
  gift_note             text,
  notes                 text,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

-- Shared operational data — any authenticated user (agents included) can read.
-- Writes go through the Edge Function (service role bypasses RLS), but allow
-- authenticated writes too so the table is usable directly if ever needed.
CREATE POLICY "Authenticated can view customer profiles" ON public.customer_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert customer profiles" ON public.customer_profiles
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update customer profiles" ON public.customer_profiles
  FOR UPDATE TO authenticated USING (true);
