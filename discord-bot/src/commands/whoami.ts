import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { infoEmbed } from '../lib/embeds';
import { tierLabel } from '../lib/authz';

export const command: BotCommand = {
  data: new SlashCommandBuilder().setName('whoami').setDescription('Show your bot access and CRM link').setDMPermission(false),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'WAREHOUSE', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    const role = tierLabel(ctx.tiers);
    const linkLine = ctx.link
      ? `Linked to CRM agent **${ctx.link.fullName}** (${ctx.link.email}).`
      : 'Not linked to a CRM agent yet — an admin can run `/linkagent` for you.';
    await interaction.editReply({ embeds: [infoEmbed(`**Access:** ${role}\n${linkLine}`)] });
  },
};
