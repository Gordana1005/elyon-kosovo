import { SlashCommandBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { identity } from '../identity/store';
import { infoEmbed } from '../lib/embeds';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('unlinkagent')
    .setDescription('Remove a Discord user ↔ CRM agent link (admin only)')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Discord user').setRequired(true)),
  allowedTiers: ['SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, _ctx) {
    const user = interaction.options.getUser('user', true);
    const ok = identity.remove(user.id);
    await interaction.editReply({
      embeds: [infoEmbed(ok ? `🔌 Unlinked <@${user.id}>.` : `<@${user.id}> wasn’t linked.`, ok ? 0x22c55e : 0x6b7280)],
    });
  },
};
