import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { sofiaDay, fmtDuration } from '../lib/time';
import { workTimeForAgent } from '../db/queries/shifts';
import { errorEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('myshift')
    .setDescription('Your work time (logged-in, talk time, breaks)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD (default: today)')),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    if (!ctx.link) {
      await interaction.editReply({ embeds: [errorEmbed('You’re not linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')] });
      return;
    }
    const dateStr = interaction.options.getString('date') ?? undefined;
    let day;
    try {
      day = sofiaDay(dateStr);
    } catch (e: any) {
      await interaction.editReply({ embeds: [errorEmbed(e.message)] });
      return;
    }
    const wt = await workTimeForAgent(ctx.link.userId, day.label, day.startISO, day.endISO);
    const sched = wt.scheduled.length
      ? wt.scheduled.map((s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${s.name ? ` (${s.name})` : ''}`).join(', ')
      : 'no shift assigned';

    const e = new EmbedBuilder()
      .setTitle(`🕒 My work time — ${ctx.link.fullName}`)
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
