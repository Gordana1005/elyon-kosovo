import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BotCommand } from './_types';
import { resolveOrderRef } from '../lib/order-ref';
import { getOrderByRef, getOrderItems, getOrderHistory, firstReached, OrderRow } from '../db/queries/orders';
import { statusBadge, statusColor } from '../lib/status';
import { fmtDual } from '../lib/currency';
import { fmtDateTime } from '../lib/time';
import { maskName, maskPhone, maskAddress } from '../lib/pii';
import { errorEmbed, clip } from '../lib/embeds';

function statusFlags(s: string): string {
  const yn = (b: boolean) => (b ? '✅' : '—');
  const shippedOnce = ['shipped', 'delivered', 'returned', 'paid'].includes(s);
  const confirmedOnce = ['confirmed', 'shipped', 'delivered', 'returned', 'paid'].includes(s);
  const pending = ['pending', 'take', 'call_again'].includes(s);
  return [
    `Paid ${yn(s === 'paid')}`,
    `Shipped ${yn(shippedOnce)}`,
    `Confirmed ${yn(confirmedOnce)}`,
    `Pending ${yn(pending)}`,
    `Cancelled ${yn(s === 'cancelled')}`,
    `Returned ${yn(s === 'returned')}`,
  ].join(' · ');
}

function datesBlock(o: OrderRow, shippedAt: string | null, deliveredAt: string | null, paidAt: string | null): string {
  const lines = [
    `Created: ${fmtDateTime(o.created_at)}`,
    `Confirmed: ${fmtDateTime(o.confirmed_at)}`,
    `Shipped: ${fmtDateTime(shippedAt)}`,
    `Delivered: ${fmtDateTime(deliveredAt)}`,
    `Paid: ${fmtDateTime(paidAt)}`,
  ];
  if (o.cancelled_at) lines.push(`Cancelled: ${fmtDateTime(o.cancelled_at)}`);
  if (o.returned_at) lines.push(`Returned: ${fmtDateTime(o.returned_at)}`);
  return lines.join('\n');
}

function courierLine(o: OrderRow): string {
  if (o.delivery_type === 'home') return `🏠 Home delivery${o.home_courier ? ` · ${o.home_courier}` : ''}`;
  if (o.courier_office_name) {
    const c = o.delivery_type === 'speedy_office' ? 'Speedy' : o.delivery_type === 'econt_office' ? 'Econt' : 'Office';
    return `🏢 ${c} office · ${o.courier_office_name}${o.courier_office_city ? ` (${o.courier_office_city})` : ''}`;
  }
  return o.delivery_type || '—';
}

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('order')
    .setDescription('Look up an order’s full current status')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('number').setDescription('Order number, e.g. 13346 or ORD-13346').setRequired(true)),
  allowedTiers: ['AGENT', 'TEAMLEAD', 'SUPERADMIN'],
  ephemeral: true,
  async execute(interaction, ctx) {
    const input = interaction.options.getString('number', true);
    const ref = resolveOrderRef(input);
    if (!ref) {
      await interaction.editReply({ embeds: [errorEmbed('Give me an order number, e.g. `13346` or `ORD-13346`.')] });
      return;
    }

    const order = await getOrderByRef(ref);
    if (!order) {
      await interaction.editReply({ embeds: [errorEmbed(`No order found for **${ref.pretty}**.`)] });
      return;
    }

    // ---- access control (fail-closed) ----
    let masked = ctx.masked;
    if (!ctx.isSuper && !ctx.isLead) {
      // agent: own orders only
      const me = ctx.link?.userId;
      if (!me) {
        await interaction.editReply({
          embeds: [errorEmbed('Your Discord account isn’t linked to a CRM agent yet. Ask an admin to run `/linkagent` for you.')],
        });
        return;
      }
      const ownerId = order.confirmed_by_agent_id ?? order.assigned_agent_id;
      if (ownerId !== me) {
        await interaction.editReply({ embeds: [errorEmbed(`Order **${ref.pretty}** isn’t assigned to you.`)] });
        return;
      }
      masked = false; // own customer -> full detail
    }

    const [items, history] = await Promise.all([getOrderItems(order.id), getOrderHistory(order.id)]);
    const shippedAt = firstReached(history, 'shipped');
    const deliveredAt = firstReached(history, 'delivered');
    const paidAt = firstReached(history, 'paid');

    const paymentLine =
      order.status === 'paid'
        ? '💰 COD — collected'
        : order.status === 'shipped'
          ? '🚚 COD — outstanding (cash in the field)'
          : '💵 COD';

    const name = masked ? maskName(order.customer_name) : order.customer_name || '—';
    const phone = masked ? maskPhone(order.customer_phone) : order.customer_phone || '—';
    const addr = masked
      ? maskAddress()
      : [order.customer_address, order.customer_city, order.postal_code].filter(Boolean).join(', ') || '—';

    const itemLines = items.length
      ? items.map((i) => `• ${i.quantity}× ${i.product_name} — ${fmtDual(i.total_price)}`).join('\n')
      : `• ${order.quantity}× ${order.product_name} — ${fmtDual(order.price)}`;

    const owner = order.confirmed_by_name ?? order.assigned_agent_name ?? '—';

    const embed = new EmbedBuilder()
      .setTitle(`📦 ${order.display_id} — ${statusBadge(order.status)}`)
      .setColor(statusColor(order.status))
      .addFields(
        { name: 'Lifecycle', value: statusFlags(order.status) },
        { name: 'Payment', value: paymentLine, inline: true },
        { name: 'Total', value: fmtDual(order.price), inline: true },
        { name: 'Agent (owner)', value: clip(owner, 256), inline: true },
        { name: 'Customer', value: clip(`${name}\n${phone}\n${addr}`) },
        { name: 'Courier', value: clip(courierLine(order), 512) },
        { name: 'Items', value: clip(itemLines) },
        { name: 'Key dates', value: clip(datesBlock(order, shippedAt, deliveredAt, paidAt)) },
      )
      .setTimestamp(new Date());

    if (order.status === 'cancelled' && (order.cancellation_reason || order.cancellation_reason_notes)) {
      embed.addFields({
        name: 'Cancellation',
        value: clip(`${order.cancellation_reason || ''}${order.cancellation_reason_notes ? ` — ${order.cancellation_reason_notes}` : ''}`.trim() || '—'),
      });
    }
    if (order.status === 'returned' && (order.return_reason || order.return_reason_notes)) {
      embed.addFields({
        name: 'Return',
        value: clip(`${order.return_reason || ''}${order.return_reason_notes ? ` — ${order.return_reason_notes}` : ''}`.trim() || '—'),
      });
    }
    if (masked) embed.setFooter({ text: 'Customer details masked for your role.' });

    await interaction.editReply({ embeds: [embed] });
  },
};
