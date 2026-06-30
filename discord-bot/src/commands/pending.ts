import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { listOpenOrders } from '../db/queries/orders';
import { OPEN_SET } from '../lib/status';
import { resolveAgent } from '../lib/resolve-agent';
import { replyBriefList } from '../lib/list-render';
import { errorEmbed, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('pending')
    .setDescription('Open orders still to be worked (pending / taken / call-again)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('agent').setDescription('Filter by agent name/email').setRequired(false)),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, ctx) {
    const term = interaction.options.getString('agent') ?? '';
    let ownerId: string | undefined;
    let who = 'team-wide';
    if (term.trim()) {
      const r = await resolveAgent(term);
      if (r.none) {
        await interaction.editReply({ embeds: [errorEmbed(`No agent matched “${term}”.`)] });
        return;
      }
      if (r.ambiguous) {
        await interaction.editReply({ embeds: [infoEmbed('Multiple agents match:\n' + r.ambiguous.map((a) => `• ${a.full_name} — ${a.email}`).join('\n'))] });
        return;
      }
      ownerId = r.agent!.user_id;
      who = r.agent!.full_name;
    }
    const rows = await listOpenOrders({ ownerId, statuses: OPEN_SET, limit: 100 });
    await replyBriefList(interaction, {
      title: `⏳ Open orders — ${who}`,
      rows,
      masked: ctx.masked,
      color: 0xf59e0b,
      emptyMsg: `No open orders for ${who}.`,
      csvName: 'pending.csv',
    });
  },
};
