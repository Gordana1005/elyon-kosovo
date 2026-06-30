import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { listCodOutstanding } from '../db/queries/orders';
import { resolveAgent } from '../lib/resolve-agent';
import { replyBriefList } from '../lib/list-render';
import { fmtDual } from '../lib/currency';
import { errorEmbed, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('codoutstanding')
    .setDescription('Shipped orders with COD not yet collected (cash in the field)')
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
    const rows = await listCodOutstanding({ ownerId, limit: 300 });
    const total = rows.reduce((s, o) => s + Number(o.price || 0), 0);
    await replyBriefList(interaction, {
      title: `💰 COD outstanding — ${who}`,
      rows,
      masked: ctx.masked,
      color: 0x3b82f6,
      emptyMsg: `No outstanding COD for ${who}.`,
      csvName: 'cod-outstanding.csv',
      totalLine: `Total outstanding: ${fmtDual(total)}`,
    });
  },
};
