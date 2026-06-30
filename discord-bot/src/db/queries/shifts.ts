import { q } from '../pool';

export interface ShiftWindow {
  start_time: string;
  end_time: string;
  name: string;
}
export interface LoginSession {
  login_time: string;
  logout_time: string | null;
}

export interface AgentWorkTime {
  scheduled: ShiftWindow[];
  sessions: LoginSession[];
  loggedSeconds: number;
  talkSeconds: number;
  calls: number;
  breaks: number;
}

export async function workTimeForAgent(
  userId: string,
  dayLabel: string,
  startISO: string,
  endISO: string,
): Promise<AgentWorkTime> {
  const scheduled = await q<ShiftWindow>(
    `SELECT s.start_time, s.end_time, s.name FROM shifts s
     JOIN shift_assignments sa ON sa.shift_id = s.id
     WHERE sa.user_id = $1 AND s.date = $2 ORDER BY s.start_time`,
    [userId, dayLabel],
  );
  const sessions = await q<LoginSession>(
    `SELECT login_time, logout_time FROM shift_login_logs
     WHERE user_id = $1 AND shift_date = $2 ORDER BY login_time`,
    [userId, dayLabel],
  );
  const callAgg = await q<{ talk: number; n: number }>(
    `SELECT COALESCE(sum(talk_seconds),0)::int AS talk, count(*)::int AS n
     FROM call_logs WHERE agent_id = $1 AND started_at >= $2 AND started_at < $3`,
    [userId, startISO, endISO],
  );
  const brk = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM shift_breaks WHERE user_id = $1 AND shift_date = $2`,
    [userId, dayLabel],
  );

  let logged = 0;
  for (const s of sessions) {
    const start = new Date(s.login_time).getTime();
    const end = s.logout_time ? new Date(s.logout_time).getTime() : Date.now();
    if (end > start) logged += Math.floor((end - start) / 1000);
  }

  return {
    scheduled,
    sessions,
    loggedSeconds: logged,
    talkSeconds: callAgg[0]?.talk ?? 0,
    calls: callAgg[0]?.n ?? 0,
    breaks: brk[0]?.n ?? 0,
  };
}

export interface TeamWorkRow {
  user_id: string;
  logged: number;
  talk: number;
  calls: number;
}

export async function teamWorkTime(dayLabel: string, startISO: string, endISO: string): Promise<TeamWorkRow[]> {
  const logged = await q<{ user_id: string; logged: number }>(
    `SELECT user_id, COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(logout_time, now()) - login_time))),0)::int AS logged
     FROM shift_login_logs WHERE shift_date = $1 GROUP BY user_id`,
    [dayLabel],
  );
  const talk = await q<{ agent_id: string; talk: number; calls: number }>(
    `SELECT agent_id, COALESCE(sum(talk_seconds),0)::int AS talk, count(*)::int AS calls
     FROM call_logs WHERE started_at >= $1 AND started_at < $2 GROUP BY agent_id`,
    [startISO, endISO],
  );

  const map = new Map<string, TeamWorkRow>();
  for (const l of logged) map.set(l.user_id, { user_id: l.user_id, logged: l.logged, talk: 0, calls: 0 });
  for (const t of talk) {
    const row = map.get(t.agent_id) ?? { user_id: t.agent_id, logged: 0, talk: 0, calls: 0 };
    row.talk = t.talk;
    row.calls = t.calls;
    map.set(t.agent_id, row);
  }
  return [...map.values()].sort((a, b) => b.logged - a.logged);
}
