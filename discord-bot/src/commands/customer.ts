import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { customerOrders } from '../db/queries/orders';
import { briefLine } from '../lib/list-render';
import { fmtDual } from '../lib/currency';
import { clip, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('customer')
    .setDescription('Customer order history by phone (admin — shows PII)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('phone').setDescription('Customer phone (any format)').setRequired(true)),
  allowedTiers: ['SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, _ctx) {
    const phone = interaction.options.getString('phone', true);
    const rows = await customerOrders(phone);
    if (rows.length === 0) {
      await interaction.editReply({ embeds: [infoEmbed(`No orders found for phone “${phone}”.`)] });
      return;
    }
    const recent = rows[0]!;
    const paid = rows.filter((o) => o.status === 'paid');
    const returned = rows.filter((o) => o.status === 'returned');
    const ltv = paid.reduce((s, o) => s + Number(o.price || 0), 0);
    const lines = rows.slice(0, 20).map((o) => briefLine(o, false));

    const e = new EmbedBuilder()
      .setTitle(`👤 ${recent.customer_name || 'Customer'} — ${recent.customer_phone}`)
      .setColor(0x8b5cf6)
      .setDescription(clip(lines.join('\n'), 4000))
      .addFields(
        { name: 'Orders', value: String(rows.length), inline: true },
        { name: 'Paid', value: String(paid.length), inline: true },
        { name: 'Returned', value: String(returned.length), inline: true },
        { name: 'Lifetime value (paid)', value: fmtDual(ltv), inline: true },
      )
      .setFooter({ text: 'Matched by last 8 phone digits · PII — keep to a private channel' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
