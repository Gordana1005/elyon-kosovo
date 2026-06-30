import { q } from '../pool';

export interface AgentRow {
  user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

export async function listAgents(): Promise<AgentRow[]> {
  return q<AgentRow>(`SELECT user_id, full_name, email, is_active FROM profiles ORDER BY full_name`);
}

export async function agentNameMap(): Promise<Record<string, string>> {
  const rows = await listAgents();
  const m: Record<string, string> = {};
  for (const r of rows) m[r.user_id] = r.full_name || r.email || r.user_id.slice(0, 8);
  return m;
}

export async function findAgentByEmail(email: string): Promise<AgentRow | null> {
  const rows = await q<AgentRow>(
    `SELECT user_id, full_name, email, is_active FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

/** Fuzzy resolve by name OR email; returns up to 25 matches. */
export async function searchAgents(term: string): Promise<AgentRow[]> {
  return q<AgentRow>(
    `SELECT user_id, full_name, email, is_active FROM profiles
     WHERE full_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
     ORDER BY is_active DESC, full_name LIMIT 25`,
    [term],
  );
}

export async function getAgentRoles(userId: string): Promise<string[]> {
  const rows = await q<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.role);
}
