-- Leaderboard MODES: 'pending' (warm inbound orders waiting for a confirm call)
-- and 'prediction' (cold-call lists). The two motions are scored differently, so
-- bonus rules and rosters are now per-mode.
--   • pending    → per-package + confirmed-count milestones + avg-order (10+ gate)
--   • prediction → per-package + daily REVENUE targets (cold lists can't aim for %)

-- Bonus rules: add mode, allow the new revenue_target metric, key per (mode, metric).
ALTER TABLE public.leaderboard_bonus_rules ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'pending';
ALTER TABLE public.leaderboard_bonus_rules DROP CONSTRAINT IF EXISTS leaderboard_bonus_rules_metric_check;
ALTER TABLE public.leaderboard_bonus_rules ADD CONSTRAINT leaderboard_bonus_rules_metric_check
  CHECK (metric IN ('confirmed_count','avg_order_value','conversion_rate','revenue_target'));
ALTER TABLE public.leaderboard_bonus_rules DROP CONSTRAINT IF EXISTS leaderboard_bonus_rules_metric_key;
ALTER TABLE public.leaderboard_bonus_rules DROP CONSTRAINT IF EXISTS leaderboard_bonus_rules_mode_metric_key;
ALTER TABLE public.leaderboard_bonus_rules ADD CONSTRAINT leaderboard_bonus_rules_mode_metric_key UNIQUE (mode, metric);

-- Roster: add mode, key per (roster_date, mode, agent_id).
ALTER TABLE public.leaderboard_roster ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'pending';
ALTER TABLE public.leaderboard_roster DROP CONSTRAINT IF EXISTS leaderboard_roster_roster_date_agent_id_key;
ALTER TABLE public.leaderboard_roster DROP CONSTRAINT IF EXISTS leaderboard_roster_date_mode_agent_key;
ALTER TABLE public.leaderboard_roster ADD CONSTRAINT leaderboard_roster_date_mode_agent_key UNIQUE (roster_date, mode, agent_id);

-- Existing confirmed_count / avg_order_value / conversion_rate rows become the
-- PENDING rule set (mode defaulted to 'pending' above).

-- Seed PREDICTION rules: per-package is automatic; the daily revenue targets are
-- the milestone bonus. Bonus amounts here are PLACEHOLDERS — operator sets them.
INSERT INTO public.leaderboard_bonus_rules (metric, mode, tiers, is_active) VALUES
  ('revenue_target','prediction',
   '[{"min":0,"bonus":0},{"min":1500,"bonus":10},{"min":2500,"bonus":20},{"min":4000,"bonus":40}]'::jsonb,
   true)
ON CONFLICT (mode, metric) DO NOTHING;
