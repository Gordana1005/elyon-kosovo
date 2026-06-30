import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay, sofiaRange } from '../lib/time';
import { leaderboard, LeaderRow } from '../db/queries/reports';
import { agentNameMap } from '../db/queries/agents';
import { fmtDual } from '../lib/currency';
import { clip, infoEmbed, errorEmbed } from '../lib/embeds';

type Metric = 'revenue' | 'paid' | 'confirmed' | 'commission';

const METRIC_LABEL: Record<Metric, string> = {
  revenue: 'Paid revenue',
  paid: 'Paid orders',
  confirmed: 'Confirmed',
  commission: 'Commission',
};

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Rank agents by performance')
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('metric')
        .setDescription('Ranking metric (default: paid revenue)')
        .addChoices(
          { name: 'Paid revenue', value: 'revenue' },
          { name: 'Paid orders', value: 'paid' },
          { name: 'Confirmed', value: 'confirmed' },
          { name: 'Commission', value: 'commission' },
        ),
    )
    .addStringOption((o) => o.setName('from').setDescription('YYYY-MM-DD (default: today)'))
    .addStringOption((o) => o.setName('to').setDescription('YYYY-MM-DD (default: from)')),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, _ctx) {
    const metric = (interaction.options.getString('metric') ?? 'revenue') as Metric;
    const from = interaction.options.getString('from') ?? undefined;
    const to = interaction.options.getString('to') ?? undefined;
    let range;
    try {
      range = from ? sofiaRange(from, to ?? from) : sofiaDay();
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }

    const [rows, names] = await Promise.all([leaderboard(range.startISO, range.endISO), agentNameMap()]);
    if (rows.length === 0) {
      await interaction.editReply({ embeds: [infoEmbed(`No agent activity for **${range.label}**.`)] });
      return;
    }

    const val = (r: LeaderRow) =>
      metric === 'revenue' ? r.perf.paidRevenue : metric === 'paid' ? r.perf.paid : metric === 'confirmed' ? r.perf.confirmed : r.perf.commission;
    rows.sort((a, b) => val(b) - val(a));

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.slice(0, 15).map((r, i) => {
      const nm = names[r.owner_id] ?? r.owner_id.slice(0, 8);
      const p = r.perf;
      const main =
        metric === 'revenue' ? fmtDual(p.paidRevenue) : metric === 'paid' ? `${p.paid} paid` : metric === 'confirmed' ? `${p.confirmed} confirmed` : fmtDual(p.commission);
      return `${medals[i] ?? `\`${i + 1}.\``} **${nm}** — ${main}  ·  ${p.paid} paid / ${p.confirmed} conf / ${p.leads} leads`;
    });

    const e = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard — ${METRIC_LABEL[metric]}`)
      .setColor(0xf59e0b)
      .setDescription(clip(lines.join('\n'), 4000))
      .setFooter({ text: `Range: ${range.label} · ${rows.length} agents` })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
