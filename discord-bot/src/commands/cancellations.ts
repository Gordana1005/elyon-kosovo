import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaRange } from '../lib/time';
import { cancellationsByReason } from '../db/queries/reports';
import { resolveOptionalAgent } from '../lib/optional-agent';
import { fmtDual } from '../lib/currency';
import { errorEmbed, infoEmbed, clip } from '../lib/embeds';
import { csvAttachment } from '../lib/csv';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('cancellations')
    .setDescription('Cancellation analysis by reason')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('from').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption((o) => o.setName('to').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption((o) => o.setName('agent').setDescription('Filter by agent name/email')),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, _ctx) {
    const from = interaction.options.getString('from', true);
    const to = interaction.options.getString('to', true);
    let range;
    try {
      range = sofiaRange(from, to);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const agent = await resolveOptionalAgent(interaction);
    if (!agent) return;

    const rows = await cancellationsByReason(range.startISO, range.endISO, agent.ownerId);
    if (rows.length === 0) {
      await interaction.editReply({ embeds: [infoEmbed(`No cancellations for ${agent.who} in ${range.label}.`)] });
      return;
    }
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const lines = rows.map((r) => `• **${r.reason}** — ${r.count} (${fmtDual(r.value)})`);

    const e = new EmbedBuilder()
      .setTitle(`❌ Cancellations — ${agent.who}`)
      .setColor(0xef4444)
      .setDescription(clip(lines.join('\n'), 4000))
      .addFields(
        { name: 'Total cancelled', value: String(totalCount), inline: true },
        { name: 'Total value', value: fmtDual(totalValue), inline: true },
      )
      .setFooter({ text: `Range: ${range.label} (by cancelled date)` })
      .setTimestamp(new Date());

    const files = rows.length > 15 ? [csvAttachment('cancellations.csv', ['reason', 'count', 'value_eur'], rows.map((r) => [r.reason, r.count, r.value]))] : [];
    await interaction.editReply({ embeds: [e], files });
  },
};
