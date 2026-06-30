-- TV Leaderboard + daily gamification bonus.
--
-- A separate, daily, CONFIRMED-gated game layer for the wall-screen leaderboard.
-- It does NOT touch the real paid per-package commission (see elyon-agent-commissions);
-- that stays the payroll source of truth. These tables only drive the live board.
--
-- All reads/writes go through the service-role edge function (`/api/leaderboard` is
-- token-gated and public; the admin CRUD is role-gated). So we ENABLE RLS with NO
-- policies: direct PostgREST/anon access is denied, keeping access tokens + bonus
-- rules private. The service role bypasses RLS by design.

-- ── Who appears on the board, per day (hides non-working agents) ──────────────
CREATE TABLE IF NOT EXISTS public.leaderboard_roster (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_date date NOT NULL DEFAULT current_date,
  agent_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roster_date, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_roster_date ON public.leaderboard_roster (roster_date);

-- ── Tiered daily bonus config, one row per metric ────────────────────────────
-- tiers: ascending JSON array [{ "min": <number>, "bonus": <eur> }]. The bonus for
-- a metric = the single HIGHEST tier whose `min` <= the agent's value (NOT a sum of
-- tiers). A negative `bonus` is a penalty. Total daily bonus = sum across active
-- metrics. avg_order_value is in EUR; answer_rate is a percentage (0-100).
CREATE TABLE IF NOT EXISTS public.leaderboard_bonus_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric     text NOT NULL UNIQUE
             CHECK (metric IN ('confirmed_count','avg_order_value','conversion_rate')),
  tiers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- ── Revocable read-only access tokens for the TV (?key=...) ───────────────────
CREATE TABLE IF NOT EXISTS public.leaderboard_access_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text NOT NULL UNIQUE,
  label      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leaderboard_roster        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_bonus_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_access_tokens ENABLE ROW LEVEL SECURITY;
-- (No policies on purpose — service-role-only access via the edge function.)

-- ── Seed starter bonus tiers (tune in Settings → Leaderboard) ────────────────
INSERT INTO public.leaderboard_bonus_rules (metric, tiers, is_active) VALUES
  -- Milestone bonus on number of confirmed orders.
  ('confirmed_count',
   '[{"min":0,"bonus":0},{"min":10,"bonus":5},{"min":20,"bonus":10},{"min":30,"bonus":20}]'::jsonb,
   true),
  -- Avg-order bonus. NOTE: the engine only applies this for agents with 10+ orders.
  ('avg_order_value',
   '[{"min":0,"bonus":0},{"min":50,"bonus":5},{"min":75,"bonus":10},{"min":100,"bonus":20}]'::jsonb,
   true),
  -- Conversion = confirmed sales ÷ answered calls. Sales-based, so 0 sales => 0%.
  -- Off by default (bonus is on sales, not on the %); operator can enable + set tiers.
  ('conversion_rate',
   '[{"min":0,"bonus":0}]'::jsonb,
   false)
ON CONFLICT (metric) DO NOTHING;

-- ── Seed one access token (rotate/relabel in Settings → Leaderboard) ──────────
INSERT INTO public.leaderboard_access_tokens (token, label, is_active)
SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       'Office TV', true
WHERE NOT EXISTS (SELECT 1 FROM public.leaderboard_access_tokens);
