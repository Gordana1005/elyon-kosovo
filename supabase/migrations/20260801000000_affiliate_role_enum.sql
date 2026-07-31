-- Affiliate/CPA program — step 1 of 4: the 'affiliate' role value, alone.
--
-- Affiliates (external webmasters) get real logins that see ONLY the affiliate
-- portal (offers, own stats, postback config). This file adds nothing but the
-- enum value because Postgres cannot USE a new enum value inside the same
-- transaction that ADDs it, and the supabase CLI runs each migration file in
-- its own transaction. The follow-up migration (20260801000100) patches
-- admin_grant_all_roles() and seeds permissions that reference the value.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'affiliate';
