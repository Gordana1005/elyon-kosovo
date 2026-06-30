import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { listCallbacksDue } from '../db/queries/orders';
import { resolveAgent } from '../lib/resolve-agent';
import { replyBriefList } from '../lib/list-render';
import { errorEmbed, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('callbacksdue')
    .setDescription('Call-again orders that are due now')
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
    const rows = await listCallbacksDue({ ownerId, limit: 100 });
    await replyBriefList(interaction, {
      title: `🔁 Callbacks due — ${who}`,
      rows,
      masked: ctx.masked,
      color: 0x0ea5e9,
      emptyMsg: `No callbacks due for ${who}.`,
      csvName: 'callbacks-due.csv',
    });
  },
};
