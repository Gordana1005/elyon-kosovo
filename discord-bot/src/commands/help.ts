import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { canRun, tierLabel } from '../lib/authz';
import { commands } from './index';
import { clip } from '../lib/embeds';

function groupOf(cmd: BotCommand): string {
  if (cmd.public) return '🌐 Everyone';
  const a = cmd.allowedTiers;
  if (a.includes('AGENT')) return '👤 Agent (your own data)';
  if (a.includes('WAREHOUSE') && !a.includes('TEAMLEAD')) return '🏭 Warehouse';
  if (a.includes('TEAMLEAD')) return '📊 Team Lead & Admin';
  return '🔑 Admin only';
}

const GROUP_ORDER = ['🌐 Everyone', '👤 Agent (your own data)', '🏭 Warehouse', '📊 Team Lead & Admin', '🔑 Admin only'];

export const command: BotCommand = {
  data: new SlashCommandBuilder().setName('help').setDescription('List the commands you can use').setDMPermission(false),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'WAREHOUSE', 'SUPERADMIN'],
  public: true,
  ephemeral: true,
  async execute(interaction, ctx) {
    const runnable = commands.filter((c) => c.public || canRun(ctx.tiers, c.allowedTiers));

    const byGroup = new Map<string, string[]>();
    for (const c of runnable) {
      const json = c.data.toJSON() as { name: string; description?: string };
      const line = `**/${json.name}** — ${json.description ?? ''}`;
      const g = groupOf(c);
      let arr = byGroup.get(g);
      if (!arr) {
        arr = [];
        byGroup.set(g, arr);
      }
      arr.push(line);
    }

    const access = ctx.tiers.size ? tierLabel(ctx.tiers) : 'no access role yet';
    const linkLine = ctx.link ? `linked to **${ctx.link.fullName}**` : 'not linked to a CRM agent';

    const e = new EmbedBuilder()
      .setTitle('🤖 Elyon Bot — commands you can use')
      .setColor(0x5865f2)
      .setDescription(`Your access: **${access}** · ${linkLine}\nPersonal commands reply privately (only you see them).`)
      .setTimestamp(new Date());

    for (const g of GROUP_ORDER) {
      const lines = byGroup.get(g);
      if (lines && lines.length) e.addFields({ name: g, value: clip(lines.join('\n'), 1024) });
    }

    if (runnable.filter((c) => !c.public).length === 0) {
      e.addFields({
        name: '⚠️ No access yet',
        value: 'You don’t have an access role. Ask an admin to add you to **@Agent** and run `/linkagent` for you.',
      });
    }

    await interaction.editReply({ embeds: [e] });
  },
};
