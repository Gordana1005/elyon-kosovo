import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaRange } from '../lib/time';
import { topProducts } from '../db/queries/reports';
import { fmtDual } from '../lib/currency';
import { errorEmbed, infoEmbed, clip } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('topproducts')
    .setDescription('Best-selling products (paid orders)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('from').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption((o) => o.setName('to').setDescription('YYYY-MM-DD').setRequired(true)),
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
    const rows = await topProducts(range.startISO, range.endISO, 20);
    if (rows.length === 0) {
      await interaction.editReply({ embeds: [infoEmbed(`No paid product sales in ${range.label}.`)] });
      return;
    }
    const lines = rows.map((p, i) => `\`${String(i + 1).padStart(2, ' ')}.\` **${p.product_name}** — ${p.units} units · ${fmtDual(p.revenue)}`);
    const e = new EmbedBuilder()
      .setTitle('📦 Top products')
      .setColor(0x14b8a6)
      .setDescription(clip(lines.join('\n'), 4000))
      .setFooter({ text: `Range: ${range.label} · paid orders` })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
