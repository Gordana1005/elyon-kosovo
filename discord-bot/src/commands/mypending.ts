import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { listOpenOrders } from '../db/queries/orders';
import { OPEN_SET } from '../lib/status';
import { replyBriefList } from '../lib/list-render';
import { errorEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder().setName('mypending').setDescription('Your own open orders (to work next)').setDMPermission(false),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    if (!ctx.link) {
      await interaction.editReply({ embeds: [errorEmbed('You’re not linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')] });
      return;
    }
    const rows = await listOpenOrders({ ownerId: ctx.link.userId, statuses: OPEN_SET, limit: 100 });
    await replyBriefList(interaction, {
      title: `⏳ My open orders — ${ctx.link.fullName}`,
      rows,
      masked: false,
      color: 0xf59e0b,
      emptyMsg: 'You have no open orders. 🎉',
      csvName: 'my-pending.csv',
    });
  },
};
