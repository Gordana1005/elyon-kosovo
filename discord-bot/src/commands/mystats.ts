import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaRange } from '../lib/time';
import { agentPerf } from '../db/queries/reports';
import { perfEmbed } from '../lib/report-embed';
import { errorEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Your own KPIs over a date range')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('from').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption((o) => o.setName('to').setDescription('YYYY-MM-DD').setRequired(true)),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    if (!ctx.link) {
      await interaction.editReply({ embeds: [errorEmbed('You’re not linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')] });
      return;
    }
    const from = interaction.options.getString('from', true);
    const to = interaction.options.getString('to', true);
    let range;
    try {
      range = sofiaRange(from, to);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const perf = await agentPerf(range.startISO, range.endISO, ctx.link.userId);
    await interaction.editReply({ embeds: [perfEmbed(`📈 My stats — ${ctx.link.fullName}`, `Range: **${range.label}**`, perf, { commission: true })] });
  },
};
