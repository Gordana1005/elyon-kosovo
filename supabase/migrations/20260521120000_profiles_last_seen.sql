-- Real presence tracking: profiles.last_seen_at is bumped by a frontend
-- heartbeat (POST /api/presence/heartbeat) every ~45s while a user has the
-- app open. The agents/online endpoint then derives is_online from whether
-- last_seen_at is within the last 2 minutes — instead of hardcoding true.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at
  ON public.profiles (last_seen_at);
