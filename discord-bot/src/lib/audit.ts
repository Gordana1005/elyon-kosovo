import { ChatInputCommandInteraction, Client } from 'discord.js';
import { DateTime } from 'luxon';
import { config } from '../config';

/** Log every command invocation (allowed or denied) to console and, if configured, #bot-audit. */
export async function audit(
  client: Client,
  interaction: ChatInputCommandInteraction,
  tierLabelStr: string,
  status: 'ok' | 'denied',
): Promise<void> {
  const opts = interaction.options.data.map((o) => `${o.name}:${String(o.value ?? '')}`).join(' ');
  const icon = status === 'denied' ? '⛔' : '✅';
  const ts = DateTime.now().setZone(config.tz).toFormat('yyyy-LL-dd HH:mm:ss');

  console.log(`[audit] ${ts} ${status} ${interaction.user.tag} /${interaction.commandName} ${opts}`);

  const chId = config.discord.auditChannelId;
  if (!chId) return;
  try {
    const ch = await client.channels.fetch(chId);
    if (ch && ch.isTextBased()) {
      const line = `${icon} \`${ts}\` **${interaction.user.tag}** (${tierLabelStr}) → \`/${interaction.commandName} ${opts}\` in <#${interaction.channelId}>`;
      await (ch as any).send({ content: line, allowedMentions: { parse: [] } });
    }
  } catch {
    /* auditing must never break a command */
  }
}
