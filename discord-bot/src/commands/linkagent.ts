import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { findAgentByEmail, searchAgents } from '../db/queries/agents';
import { identity } from '../identity/store';
import { errorEmbed, infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('linkagent')
    .setDescription('Link a Discord user to a CRM agent (admin only)')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption((o) => o.setName('email').setDescription('CRM agent email (exact)').setRequired(true)),
  allowedTiers: ['SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, _ctx) {
    const user = interaction.options.getUser('user', true);
    const email = interaction.options.getString('email', true).trim();

    let agent = await findAgentByEmail(email);
    if (!agent) {
      const matches = await searchAgents(email);
      if (matches.length === 1) agent = matches[0];
    }
    if (!agent) {
      await interaction.editReply({ embeds: [errorEmbed(`No CRM agent found for “${email}”. Use their exact CRM email.`)] });
      return;
    }

    identity.set({
      discordId: user.id,
      userId: agent.user_id,
      fullName: agent.full_name,
      email: agent.email,
      linkedBy: interaction.user.tag,
      linkedAt: new Date().toISOString(),
    });
    await interaction.editReply({ embeds: [infoEmbed(`✅ Linked <@${user.id}> → **${agent.full_name}** (${agent.email}).`, 0x22c55e)] });
  },
};
