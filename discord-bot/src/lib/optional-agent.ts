import { ChatInputCommandInteraction } from 'discord.js';
import { resolveAgent } from './resolve-agent';
import { errorEmbed, infoEmbed } from './embeds';

/**
 * Resolve an optional "agent" option. Returns { ownerId?, who }.
 * If the term is ambiguous/unknown it replies with an error and returns null
 * (the caller should then return).
 */
export async function resolveOptionalAgent(
  interaction: ChatInputCommandInteraction,
  optName = 'agent',
): Promise<{ ownerId?: string; who: string } | null> {
  const term = interaction.options.getString(optName) ?? '';
  if (!term.trim()) return { who: 'team-wide' };

  const r = await resolveAgent(term);
  if (r.none) {
    await interaction.editReply({ embeds: [errorEmbed(`No agent matched “${term}”.`)] });
    return null;
  }
  if (r.ambiguous) {
    await interaction.editReply({
      embeds: [infoEmbed('Multiple agents match:\n' + r.ambiguous.map((a) => `• ${a.full_name} — ${a.email}`).join('\n'))],
    });
    return null;
  }
  return { ownerId: r.agent!.user_id, who: r.agent!.full_name };
}
