import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { listPendingShipment } from '../db/queries/orders';
import { replyBriefList } from '../lib/list-render';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('pendingshipment')
    .setDescription('Confirmed orders awaiting shipment (warehouse hand-off)')
    .setDMPermission(false),
  allowedTiers: ['WAREHOUSE', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, _ctx) {
    const rows = await listPendingShipment(500);
    await replyBriefList(interaction, {
      title: '🏭 Awaiting shipment (confirmed)',
      rows,
      masked: false,
      color: 0x22c55e,
      emptyMsg: 'Nothing awaiting shipment. 🎉',
      csvName: 'pending-shipment.csv',
    });
  },
};
