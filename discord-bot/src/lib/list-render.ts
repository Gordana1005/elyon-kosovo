import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { BriefOrder } from '../db/queries/orders';
import { fmtDual } from './currency';
import { statusBadge } from './status';
import { maskName, maskPhone } from './pii';
import { csvAttachment } from './csv';
import { clip, infoEmbed, BRAND } from './embeds';

export function briefLine(o: BriefOrder, masked: boolean): string {
  const name = masked ? maskName(o.customer_name) : o.customer_name || '—';
  const phone = masked ? maskPhone(o.customer_phone) : o.customer_phone || '';
  const tail = [name, phone, o.customer_city].filter(Boolean).join(' · ');
  return `\`${o.display_id}\` ${statusBadge(o.status)} · ${fmtDual(o.price)} · ${tail}`;
}

export function briefCsv(filename: string, rows: BriefOrder[]) {
  return csvAttachment(
    filename,
    ['order', 'status', 'price_eur', 'customer', 'phone', 'city', 'created_at', 'owner'],
    rows.map((o) => [o.display_id, o.status, o.price, o.customer_name, o.customer_phone, o.customer_city, o.created_at, o.owner_name ?? '']),
  );
}

/** Reply with a list: inline up to 15 rows, attach CSV when longer. */
export async function replyBriefList(
  interaction: ChatInputCommandInteraction,
  opts: { title: string; rows: BriefOrder[]; masked: boolean; color?: number; emptyMsg: string; csvName: string; totalLine?: string },
): Promise<void> {
  if (opts.rows.length === 0) {
    await interaction.editReply({ embeds: [infoEmbed(opts.emptyMsg)] });
    return;
  }
  const top = opts.rows.slice(0, 15);
  const e = new EmbedBuilder()
    .setTitle(opts.title)
    .setColor(opts.color ?? BRAND)
    .setDescription(clip(top.map((o) => briefLine(o, opts.masked)).join('\n'), 4000))
    .setTimestamp(new Date());

  const bits = [`${opts.rows.length} order(s)`];
  if (opts.totalLine) bits.push(opts.totalLine);
  if (opts.rows.length > 15) bits.push('full list attached as CSV');
  e.setFooter({ text: bits.join(' · ') });

  const files = opts.rows.length > 15 ? [briefCsv(opts.csvName, opts.rows)] : [];
  await interaction.editReply({ embeds: [e], files });
}
