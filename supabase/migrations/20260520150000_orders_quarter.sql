-- Quarter / complex (квартал, ж.к., к.к.) as a first-class address field.
-- Bulgarian city addresses commonly need it (e.g. "ж.к. Люлин-3"). Stored as
-- a single string with the type prefix the agent chose.

ALTER TABLE public.orders            ADD COLUMN IF NOT EXISTS quarter text;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS quarter text;
