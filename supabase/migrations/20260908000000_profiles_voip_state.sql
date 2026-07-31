-- Live softphone state, self-reported by the agent's browser via
-- POST /presence/heartbeat (VoipContext posts every state transition; the 45s
-- presence beat refreshes it during long calls). voip_state_at is the
-- staleness anchor: a crashed tab stops refreshing it and agents/online
-- treats the state as idle after ~3 minutes.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS voip_state text NOT NULL DEFAULT 'idle'
    CHECK (voip_state IN ('idle','dialing','in_call','wrapping','ending')),
  ADD COLUMN IF NOT EXISTS voip_state_at timestamptz;

COMMENT ON COLUMN public.profiles.voip_state IS
  'Browser-reported softphone state (idle/dialing/in_call/wrapping/ending). Written only by the edge function service role.';
COMMENT ON COLUMN public.profiles.voip_state_at IS
  'When voip_state was last reported; stale (>3 min) states are treated as idle.';
