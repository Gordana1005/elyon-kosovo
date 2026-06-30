import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { listCallbacksDue } from '../db/queries/orders';
import { replyBriefList } from '../lib/list-render';
import { errorEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder().setName('mycallbacks').setDescription('Your call-again orders that are due now').setDMPermission(false),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    if (!ctx.link) {
      await interaction.editReply({ embeds: [errorEmbed('You’re not linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')] });
      return;
    }
    const rows = await listCallbacksDue({ ownerId: ctx.link.userId, limit: 100 });
    await replyBriefList(interaction, {
      title: `🔁 My callbacks due — ${ctx.link.fullName}`,
      rows,
      masked: false,
      color: 0x0ea5e9,
      emptyMsg: 'No callbacks due right now. 🎉',
      csvName: 'my-callbacks.csv',
    });
  },
};
