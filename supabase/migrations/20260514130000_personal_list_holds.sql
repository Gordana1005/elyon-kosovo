-- Personal List: agent-self-claim of a customer phone number for a bounded
-- window. Other agents cannot pick this customer in their queue and see a
-- read-only "held by X — reason: Y" badge. The agent who claimed has the
-- customer surfaced in their queue normally. Holds expire after 10 days
-- and a separate cron job sets escalated_at so admins/managers see them in
-- a review queue.
--
-- Per-agent ceiling of 25 active holds is enforced in the API (in
-- supabase/functions/api/index.ts) for friendly errors; a CHECK constraint
-- can't express "count rows by agent" cleanly.

CREATE TABLE IF NOT EXISTS public.personal_list_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name      text NOT NULL,
  customer_phone  text NOT NULL,
  customer_name   text,
  reason          text NOT NULL CHECK (length(trim(reason)) > 0),
  follow_up_by    date,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '10 days'),
  escalated_at    timestamptz,
  status          text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'extended', 'returned_to_pool')),
  released_at     timestamptz,
  released_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  released_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Only one active hold per phone — partial unique index lets us keep
-- historical released/returned rows for audit.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_personal_list_active_phone
  ON public.personal_list_holds (customer_phone)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_personal_list_active_agent
  ON public.personal_list_holds (agent_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_personal_list_active_expiry
  ON public.personal_list_holds (expires_at)
  WHERE status = 'active';

CREATE TRIGGER trg_personal_list_holds_updated_at
BEFORE UPDATE ON public.personal_list_holds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ──
ALTER TABLE public.personal_list_holds ENABLE ROW LEVEL SECURITY;

-- Every authenticated user can SEE every active hold so the lock badge
-- ("held by Petya M. — promised to call back Friday") renders for everyone.
-- Released/returned rows are hidden from non-admins to keep the UI clean.
CREATE POLICY "Authenticated can read active holds"
  ON public.personal_list_holds FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      status = 'active'
      OR agent_id = auth.uid()
      OR public.is_admin_or_manager(auth.uid())
    )
  );

-- An agent can claim a customer for themselves.
CREATE POLICY "Agents can insert own holds"
  ON public.personal_list_holds FOR INSERT
  WITH CHECK (agent_id = auth.uid());

-- An agent can release / update their own hold; admins can mutate any.
CREATE POLICY "Agents can update own holds"
  ON public.personal_list_holds FOR UPDATE
  USING (
    agent_id = auth.uid()
    OR public.is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Admins can delete holds"
  ON public.personal_list_holds FOR DELETE
  USING (public.is_admin_or_manager(auth.uid()));
