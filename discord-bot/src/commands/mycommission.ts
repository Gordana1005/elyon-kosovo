import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay, sofiaRange } from '../lib/time';
import { agentPerf } from '../db/queries/reports';
import { fmtDual } from '../lib/currency';
import { errorEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('mycommission')
    .setDescription('Your commission earned')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('from').setDescription('YYYY-MM-DD (default: today)'))
    .addStringOption((o) => o.setName('to').setDescription('YYYY-MM-DD (default: from)')),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    if (!ctx.link) {
      await interaction.editReply({ embeds: [errorEmbed('You’re not linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')] });
      return;
    }
    const from = interaction.options.getString('from') ?? undefined;
    const to = interaction.options.getString('to') ?? undefined;
    let range;
    try {
      range = from ? sofiaRange(from, to ?? from) : sofiaDay();
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const perf = await agentPerf(range.startISO, range.endISO, ctx.link.userId);
    const e = new EmbedBuilder()
      .setTitle(`💶 My commission — ${ctx.link.fullName}`)
      .setColor(0x059669)
      .setDescription(`Range: **${range.label}** (Europe/Belgrade)`)
      .addFields(
        { name: 'Paid orders', value: String(perf.paid), inline: true },
        { name: 'Packages sold', value: String(perf.packagesSold), inline: true },
        { name: 'Commission', value: fmtDual(perf.commission), inline: true },
      )
      .setFooter({ text: '€1/€2/€3 per package by unit price, on paid orders' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
