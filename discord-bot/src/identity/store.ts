import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/** One Discord user linked to one CRM agent. Stored locally — the CRM is never written to. */
export interface AgentLink {
  discordId: string;
  userId: string; // profiles.user_id (== auth.users.id)
  fullName: string;
  email: string;
  linkedBy: string; // discord tag of the admin who linked
  linkedAt: string; // ISO
}

const FILE = config.identityPath;

function load(): Record<string, AgentLink> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, AgentLink>;
  } catch {
    return {};
  }
}

function persist(map: Record<string, AgentLink>): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  fs.renameSync(tmp, FILE); // atomic replace
}

export const identity = {
  get(discordId: string): AgentLink | null {
    return load()[discordId] ?? null;
  },
  set(link: AgentLink): void {
    const m = load();
    m[link.discordId] = link;
    persist(m);
  },
  remove(discordId: string): boolean {
    const m = load();
    if (!m[discordId]) return false;
    delete m[discordId];
    persist(m);
    return true;
  },
  all(): AgentLink[] {
    return Object.values(load());
  },
  byUserId(userId: string): AgentLink | null {
    return this.all().find((l) => l.userId === userId) ?? null;
  },
};
