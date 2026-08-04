-- Security quick-wins bundle — audit of 2026-08-04 (docs/SECURITY-AUDIT-2026-08-04.md).
-- Fixes H1 (manager -> admin escalation), H3 (customer PII readable by any login),
-- M1 (managers could read affiliate API keys) and L6 (service-role-only tables
-- still carrying PostgREST grants).
--
-- Rollback, if ever needed:
--   H1  recreate the policy exactly as in 20260216083623_39c65ba0-...sql:58-60
--   H3  restore the four policies from 20260514130000_personal_list_holds.sql:56-82
--   M1  GRANT SELECT ON public.affiliates TO authenticated;
--   L6  GRANT SELECT ON <table> TO authenticated;   (undesirable — see below)

-- ── H1: manager -> admin privilege escalation ────────────────────────────────
-- "Managers can manage agent roles" was FOR ALL USING has_role(uid,'manager')
-- with no WITH CHECK and no predicate on the target row. Postgres reuses USING
-- as the check, and USING never looks at NEW.role, so despite its name the
-- policy let any manager POST /rest/v1/user_roles {user_id:<self>, role:'admin'}
-- straight to PostgREST with the publishable key. trg_admin_grant_all_roles then
-- backfills every remaining role.
--
-- Dropped rather than patched with a WITH CHECK: every role mutation in the app
-- already goes through the edge function on the service role, which restricts
-- managers to pending_agent/prediction_agent and guards privileged targets. That
-- leaves one enforcement point instead of two that must agree.
-- "Managers can view roles" (SELECT) is deliberately kept.
DROP POLICY IF EXISTS "Managers can manage agent roles" ON public.user_roles;

-- ── H3: personal_list_holds leaked customer phone numbers ────────────────────
-- The table stores customer_phone (NOT NULL) + customer_name. Its SELECT policy
-- was the `auth.uid() IS NOT NULL` shape that the 2026-07-11 and 2026-07-22
-- lockdown sweeps existed to remove, and both missed it — so any authenticated
-- login, including an external affiliate, could walk the active-hold book.
--
-- is_internal_staff() = "holds at least one role that is not 'affiliate'", so
-- every real staff role still passes and the agent queue is unaffected.
DROP POLICY IF EXISTS "Authenticated can read active holds" ON public.personal_list_holds;
CREATE POLICY "Internal staff can read active holds"
  ON public.personal_list_holds FOR SELECT
  USING (
    public.is_internal_staff(auth.uid())
    AND (
      status = 'active'
      OR agent_id = auth.uid()
      OR public.is_admin_or_manager(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agents can insert own holds" ON public.personal_list_holds;
CREATE POLICY "Agents can insert own holds"
  ON public.personal_list_holds FOR INSERT
  WITH CHECK (
    public.is_internal_staff(auth.uid())
    AND agent_id = auth.uid()
  );

DROP POLICY IF EXISTS "Agents can update own holds" ON public.personal_list_holds;
CREATE POLICY "Agents can update own holds"
  ON public.personal_list_holds FOR UPDATE
  USING (
    public.is_internal_staff(auth.uid())
    AND (
      agent_id = auth.uid()
      OR public.is_admin_or_manager(auth.uid())
    )
  );

-- "Admins can delete holds" already gates on is_admin_or_manager — left as is.

-- ── M1: affiliates.api_key was readable by managers ──────────────────────────
-- The edge function masks api_key for non-admins, but RLS does not, and managers
-- hold FOR ALL on this table — so a manager could read every partner's key
-- directly from PostgREST. RLS cannot hide a column, and REVOKE SELECT(col)
-- cannot carve a column out of a table-level grant; the table grant has to go
-- and be replaced by an explicit column list.
--
-- Safe: there are zero `from('affiliates')` calls in src/ — every read goes
-- through the edge function on the service role, which bypasses grants entirely.
-- Column list is the LIVE set as of 2026-08-04 (includes postback_format and
-- altercpa_reason_map, both added after the table's creating migration).
-- NOTE: a future ALTER TABLE ... ADD COLUMN must be added here too, or it will
-- be invisible to PostgREST readers.
REVOKE SELECT ON public.affiliates FROM anon, authenticated;
GRANT SELECT (
  id, user_id, code, name, contact, status,
  postback_url, postback_enabled, postback_events, postback_format,
  altercpa_reason_map, notes, created_at, updated_at
) ON public.affiliates TO authenticated;

-- ── L6: belt-and-braces REVOKE on service-role-only tables ───────────────────
-- These have RLS enabled with zero policies, which already denies PostgREST
-- reads. Removing the grants as well is the pattern from
-- 20260905000100_order_unpaid_alerts.sql:68-70 — it is what would have prevented
-- the anon-readable backup-table incident, since a later CREATE POLICY on any of
-- these would silently re-open them.
-- Verified no frontend reader: the TV leaderboard subscribes to realtime
-- broadcast, not to these tables.
REVOKE ALL ON public.affiliate_postbacks               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leaderboard_roster                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leaderboard_bonus_rules           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leaderboard_access_tokens         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.call_recordings                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.prediction_segment_members_shadow FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
