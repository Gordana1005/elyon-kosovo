import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaRange } from '../lib/time';
import { agentPerf, fetchOrdersForRange, fetchItemsForOrders } from '../db/queries/reports';
import { computePerf } from '../lib/perf';
import { perfEmbed } from '../lib/report-embed';
import { resolveAgent } from '../lib/resolve-agent';
import { errorEmbed, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('reportrange')
    .setDescription('Report over a date range (one agent, or the whole team)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('from').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption((o) => o.setName('to').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption((o) => o.setName('agent').setDescription('Agent name/email (omit for whole team)').setRequired(false)),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, ctx) {
    const from = interaction.options.getString('from', true);
    const to = interaction.options.getString('to', true);
    const term = interaction.options.getString('agent') ?? '';
    let range;
    try {
      range = sofiaRange(from, to);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }

    if (term.trim()) {
      const r = await resolveAgent(term);
      if (r.none) {
        await interaction.editReply({ embeds: [errorEmbed(`No agent matched “${term}”.`)] });
        return;
      }
      if (r.ambiguous) {
        await interaction.editReply({
          embeds: [infoEmbed(`Multiple agents match “${term}”:\n` + r.ambiguous.map((a) => `• ${a.full_name} — ${a.email}`).join('\n'))],
        });
        return;
      }
      const a = r.agent!;
      const perf = await agentPerf(range.startISO, range.endISO, a.user_id);
      await interaction.editReply({ embeds: [perfEmbed(`📈 ${a.full_name}`, `Range: **${range.label}**`, perf, { commission: ctx.isSuper })] });
      return;
    }

    const orders = await fetchOrdersForRange(range.startISO, range.endISO);
    const items = await fetchItemsForOrders(orders.filter((o) => o.status === 'paid').map((o) => o.id));
    const perf = computePerf(orders, items);
    await interaction.editReply({ embeds: [perfEmbed('📈 Whole team', `Range: **${range.label}**`, perf, { commission: ctx.isSuper })] });
  },
};
