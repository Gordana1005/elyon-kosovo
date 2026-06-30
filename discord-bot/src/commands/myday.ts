import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay } from '../lib/time';
import { agentPerf } from '../db/queries/reports';
import { perfEmbed } from '../lib/report-embed';
import { errorEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('myday')
    .setDescription('Your own daily report')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD (default: today)').setRequired(false)),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    if (!ctx.link) {
      await interaction.editReply({
        embeds: [errorEmbed('You’re not linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')],
      });
      return;
    }
    const dateStr = interaction.options.getString('date') ?? undefined;
    let day;
    try {
      day = sofiaDay(dateStr);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const perf = await agentPerf(day.startISO, day.endISO, ctx.link.userId);
    await interaction.editReply({
      embeds: [perfEmbed(`📅 My day — ${ctx.link.fullName}`, `Date: **${day.label}** (Europe/Belgrade)`, perf, { commission: true })],
    });
  },
};
