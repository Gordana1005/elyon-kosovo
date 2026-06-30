import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay, fmtDuration } from '../lib/time';
import { workTimeForAgent, teamWorkTime } from '../db/queries/shifts';
import { agentNameMap } from '../db/queries/agents';
import { resolveAgent } from '../lib/resolve-agent';
import { errorEmbed, infoEmbed, clip } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('worktime')
    .setDescription('Agent work time: logged-in, talk time, breaks')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('agent').setDescription('Agent name/email, or "all"').setRequired(true))
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD (default: today)')),
  allowedTiers: ['TEAMLEAD', 'SUPERADMIN'],
  ephemeral: false,
  async execute(interaction, _ctx) {
    const agentTerm = interaction.options.getString('agent', true);
    const dateStr = interaction.options.getString('date') ?? undefined;
    let day;
    try {
      day = sofiaDay(dateStr);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }

    if (agentTerm.trim().toLowerCase() === 'all') {
      const [rows, names] = await Promise.all([teamWorkTime(day.label, day.startISO, day.endISO), agentNameMap()]);
      if (rows.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed(`No work-time records for ${day.label}.`)] });
        return;
      }
      const lines = rows.map(
        (r) => `• **${names[r.user_id] ?? r.user_id.slice(0, 8)}** — ⏱ ${fmtDuration(r.logged)} logged · 🗣 ${fmtDuration(r.talk)} talk · ${r.calls} calls`,
      );
      const e = new EmbedBuilder()
        .setTitle(`🕒 Team work time — ${day.label}`)
        .setColor(0x6366f1)
        .setDescription(clip(lines.join('\n'), 4000))
        .setTimestamp(new Date());
      await interaction.editReply({ embeds: [e] });
      return;
    }

    const r = await resolveAgent(agentTerm);
    if (r.none) {
      await interaction.editReply({ embeds: [errorEmbed(`No agent matched “${agentTerm}”.`)] });
      return;
    }
    if (r.ambiguous) {
      await interaction.editReply({ embeds: [infoEmbed('Multiple agents match:\n' + r.ambiguous.map((a) => `• ${a.full_name} — ${a.email}`).join('\n'))] });
      return;
    }
    const a = r.agent!;
    const wt = await workTimeForAgent(a.user_id, day.label, day.startISO, day.endISO);
    const sched = wt.scheduled.length
      ? wt.scheduled.map((s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${s.name ? ` (${s.name})` : ''}`).join(', ')
      : 'no shift assigned';

    const e = new EmbedBuilder()
      .setTitle(`🕒 Work time — ${a.full_name}`)
      .setColor(0x6366f1)
      .setDescription(`Date: **${day.label}**`)
      .addFields(
        { name: 'Scheduled', value: sched },
        { name: 'Logged in', value: fmtDuration(wt.loggedSeconds), inline: true },
        { name: 'Talk time', value: fmtDuration(wt.talkSeconds), inline: true },
        { name: 'Calls', value: String(wt.calls), inline: true },
        { name: 'Sessions', value: String(wt.sessions.length), inline: true },
        { name: 'Breaks', value: String(wt.breaks), inline: true },
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [e] });
  },
};
