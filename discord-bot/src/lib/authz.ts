import { ChatInputCommandInteraction } from 'discord.js';
import { config } from '../config';

export type Tier = 'AGENT' | 'TEAMLEAD' | 'WAREHOUSE' | 'SUPERADMIN';

/** Read the invoker's Discord role IDs, handling both cached members and raw interaction members. */
export function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const m: any = interaction.member;
  if (!m) return [];
  const r = m.roles;
  if (Array.isArray(r)) return r as string[]; // APIInteractionGuildMember (raw)
  if (r && r.cache) return [...r.cache.keys()] as string[]; // GuildMember (cached)
  return [];
}

/** Map role IDs to the tiers the user holds. */
export function tiersFor(roleIds: string[]): Set<Tier> {
  const ids = new Set(roleIds);
  const tiers = new Set<Tier>();
  const R = config.discord.roles;
  if (R.superadmin && ids.has(R.superadmin)) tiers.add('SUPERADMIN');
  if (R.teamlead && ids.has(R.teamlead)) tiers.add('TEAMLEAD');
  if (R.warehouse && ids.has(R.warehouse)) tiers.add('WAREHOUSE');
  if (R.agent && ids.has(R.agent)) tiers.add('AGENT');
  return tiers;
}

/** Fail-closed: superadmin can run anything; otherwise the user must hold an allowed tier. */
export function canRun(tiers: Set<Tier>, allowed: Tier[]): boolean {
  if (tiers.has('SUPERADMIN')) return true;
  return allowed.some((t) => tiers.has(t));
}

export function tierLabel(tiers: Set<Tier>): string {
  if (tiers.size === 0) return 'no-role';
  const order: Tier[] = ['SUPERADMIN', 'TEAMLEAD', 'WAREHOUSE', 'AGENT'];
  return order.filter((t) => tiers.has(t)).join('+');
}
