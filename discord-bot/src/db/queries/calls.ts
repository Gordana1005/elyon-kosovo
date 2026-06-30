import { q } from '../pool';

export interface OutcomeRow {
  outcome: string;
  n: number;
  talk: number;
}

export async function callsForAgent(userId: string, startISO: string, endISO: string): Promise<OutcomeRow[]> {
  return q<OutcomeRow>(
    `SELECT outcome, count(*)::int AS n, COALESCE(sum(talk_seconds),0)::int AS talk
     FROM call_logs WHERE agent_id = $1 AND started_at >= $2 AND started_at < $3
     GROUP BY outcome ORDER BY n DESC`,
    [userId, startISO, endISO],
  );
}
