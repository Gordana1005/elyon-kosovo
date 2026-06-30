import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay, fmtDuration } from '../lib/time';
import { callsForAgent } from '../db/queries/calls';
import { resolveAgent } from '../lib/resolve-agent';
import { errorEmbed, infoEmbed, clip } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('calls')
    .setDescription('Call activity for an agent on a day')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('agent').setDescription('Agent name/email').setRequired(true))
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD (default: today)')),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, _ctx) {
    const term = interaction.options.getString('agent', true);
    const dateStr = interaction.options.getString('date') ?? undefined;
    let day;
    try {
      day = sofiaDay(dateStr);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const r = await resolveAgent(term);
    if (r.none) {
      await interaction.editReply({ embeds: [errorEmbed(`No agent matched “${term}”.`)] });
      return;
    }
    if (r.ambiguous) {
      await interaction.editReply({ embeds: [infoEmbed('Multiple agents match:\n' + r.ambiguous.map((a) => `• ${a.full_name} — ${a.email}`).join('\n'))] });
      return;
    }
    const a = r.agent!;
    const rows = await callsForAgent(a.user_id, day.startISO, day.endISO);
    if (rows.length === 0) {
      await interaction.editReply({ embeds: [infoEmbed(`No calls for ${a.full_name} on ${day.label}.`)] });
      return;
    }
    const totalN = rows.reduce((s, o) => s + o.n, 0);
    const totalTalk = rows.reduce((s, o) => s + o.talk, 0);
    const lines = rows.map((o) => `• **${o.outcome}** — ${o.n} (${fmtDuration(o.talk)} talk)`);

    const e = new EmbedBuilder()
      .setTitle(`📞 Calls — ${a.full_name}`)
      .setColor(0x0ea5e9)
      .setDescription(clip(lines.join('\n'), 4000))
      .addFields(
        { name: 'Total calls', value: String(totalN), inline: true },
        { name: 'Talk time', value: fmtDuration(totalTalk), inline: true },
      )
      .setFooter({ text: `Date: ${day.label}` })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
