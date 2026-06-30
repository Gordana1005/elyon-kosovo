import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay } from '../lib/time';
import { agentPerf } from '../db/queries/reports';
import { perfEmbed } from '../lib/report-embed';
import { resolveAgent } from '../lib/resolve-agent';
import { errorEmbed, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('reportdaily')
    .setDescription('Daily report for an agent (team lead / admin)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('agent').setDescription('Agent name or email').setRequired(true))
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD (default: today)').setRequired(false)),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, ctx) {
    const term = interaction.options.getString('agent', true);
    const dateStr = interaction.options.getString('date') ?? undefined;
    let day;
    try {
      day = sofiaDay(dateStr);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const r = await resolveAgent(term);
    if (r.none) {
      await interaction.editReply({ embeds: [errorEmbed(`No agent matched “${term}”.`)] });
      return;
    }
    if (r.ambiguous) {
      await interaction.editReply({
        embeds: [infoEmbed(`Multiple agents match “${term}” — be more specific:\n` + r.ambiguous.map((a) => `• ${a.full_name} — ${a.email}`).join('\n'))],
      });
      return;
    }
    const a = r.agent!;
    const perf = await agentPerf(day.startISO, day.endISO, a.user_id);
    await interaction.editReply({
      embeds: [perfEmbed(`📅 Daily report — ${a.full_name}`, `Date: **${day.label}** (Europe/Belgrade)`, perf, { commission: ctx.isSuper })],
    });
  },
};
