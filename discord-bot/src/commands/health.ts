import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay } from '../lib/time';
import { healthForRange, pendingPoolSize } from '../db/queries/orders';
import { fmtDual } from '../lib/currency';

export const command: BotCommand = {
  data: new SlashCommandBuilder().setName('health').setDescription('Today’s sales pulse').setDMPermission(false),
  allowedTiers: ['SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, _ctx) {
    const day = sofiaDay();
    const [h, pool] = await Promise.all([healthForRange(day.startISO, day.endISO), pendingPoolSize()]);
    const e = new EmbedBuilder()
      .setTitle(`❤️ Today’s pulse — ${day.label}`)
      .setColor(0x059669)
      .addFields(
        { name: 'Orders today', value: String(h.total), inline: true },
        { name: 'Confirmed', value: String(h.confirmed), inline: true },
        { name: 'Paid', value: String(h.paid), inline: true },
        { name: 'Shipped (COD out)', value: String(h.shipped), inline: true },
        { name: 'Cancelled', value: String(h.cancelled), inline: true },
        { name: 'Returned', value: String(h.returned), inline: true },
        { name: 'Paid revenue', value: fmtDual(h.paid_revenue), inline: true },
        { name: 'Outstanding COD', value: fmtDual(h.outstanding), inline: true },
        { name: 'Pending pool (all-time)', value: String(pool), inline: true },
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
