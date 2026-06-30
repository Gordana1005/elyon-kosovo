import { AgentRow, findAgentByEmail, searchAgents } from '../db/queries/agents';

export interface ResolveResult {
  agent?: AgentRow;
  ambiguous?: AgentRow[];
  none?: boolean;
}

/** Resolve a free-text agent reference (email, full or partial name) to one CRM agent. */
export async function resolveAgent(term: string): Promise<ResolveResult> {
  const t = (term || '').trim();
  if (!t) return { none: true };

  if (t.includes('@')) {
    const a = await findAgentByEmail(t);
    return a ? { agent: a } : { none: true };
  }

  const matches = await searchAgents(t);
  if (matches.length === 0) return { none: true };
  if (matches.length === 1) return { agent: matches[0] };

  const exact = matches.find((m) => m.full_name.toLowerCase() === t.toLowerCase());
  if (exact) return { agent: exact };

  return { ambiguous: matches };
}
