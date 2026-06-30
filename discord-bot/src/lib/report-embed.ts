import { EmbedBuilder } from 'discord.js';
import { Perf } from './perf';
import { fmtDual } from './currency';

/** Render an agent/team KPI breakdown as an embed. Commission shown only when allowed. */
export function perfEmbed(title: string, subtitle: string, p: Perf, opts: { commission?: boolean } = {}): EmbedBuilder {
  const e = new EmbedBuilder().setTitle(title).setColor(0x059669).setTimestamp(new Date());
  if (subtitle) e.setDescription(subtitle);
  e.addFields(
    { name: 'Leads', value: String(p.leads), inline: true },
    { name: 'Confirmed', value: `${p.confirmed} (${p.conversionRate}%)`, inline: true },
    { name: 'Shipped', value: String(p.shipped), inline: true },
    { name: 'Paid (COD)', value: `${p.paid} (${p.collectionRate}%)`, inline: true },
    { name: 'Returned', value: `${p.returned} (${p.returnRate}%)`, inline: true },
    { name: 'Cancelled', value: String(p.cancelled), inline: true },
    { name: 'Paid revenue', value: fmtDual(p.paidRevenue), inline: true },
    { name: 'Outstanding COD', value: fmtDual(p.outstanding), inline: true },
    { name: 'Returned value', value: fmtDual(p.returnedValue), inline: true },
    { name: 'Packages sold', value: String(p.packagesSold), inline: true },
    { name: 'Avg order', value: fmtDual(p.avgOrderValue), inline: true },
  );
  if (opts.commission) e.addFields({ name: '💶 Commission', value: fmtDual(p.commission), inline: true });
  return e;
}
