import { CONFIRMED_SET, SHIPPED_SET } from './status';
import { orderPackageBonus, round2 } from './commission';

// Pure agent-performance aggregation — mirrors supabase/functions/api/index.ts (4929-5040).
export interface PerfInput {
  id: string;
  status: string;
  price: number;
  quantity: number;
  owner_id: string | null;
}

export interface Perf {
  leads: number;
  confirmed: number;
  shipped: number;
  paid: number;
  returned: number;
  cancelled: number;
  trashed: number;
  conversionRate: number; // confirmed / leads %
  collectionRate: number; // paid / shipped % (COD success)
  returnRate: number; // returned / shipped %
  paidRevenue: number;
  outstanding: number; // status='shipped' (COD in the field)
  grossRevenue: number; // shipped + paid
  returnedValue: number;
  packagesSold: number;
  avgOrderValue: number;
  commission: number;
}

type ItemsMap = Record<string, { price_per_unit: number; quantity: number }[]>;

export function computePerf(all: PerfInput[], itemsMap: ItemsMap = {}, includeCancelled = false): Perf {
  const cancelled = all.filter((o) => o.status === 'cancelled').length;
  const trashed = all.filter((o) => o.status === 'trashed').length;

  // "agentOrders" excludes trashed and (by default) cancelled — same as the CRM.
  const agentOrders = all.filter((o) => o.status !== 'trashed' && (includeCancelled || o.status !== 'cancelled'));

  const leads = agentOrders.length;
  const confirmed = agentOrders.filter((o) => CONFIRMED_SET.includes(o.status)).length;
  const shipped = agentOrders.filter((o) => SHIPPED_SET.includes(o.status)).length;
  const paidOrders = agentOrders.filter((o) => o.status === 'paid');
  const paid = paidOrders.length;
  const returned = agentOrders.filter((o) => o.status === 'returned').length;

  const sum = (arr: PerfInput[]) => arr.reduce((s, o) => s + Number(o.price || 0), 0);
  const paidRevenue = sum(paidOrders);
  const outstanding = sum(agentOrders.filter((o) => o.status === 'shipped'));
  const grossRevenue = sum(agentOrders.filter((o) => o.status === 'shipped' || o.status === 'paid'));
  const returnedValue = sum(agentOrders.filter((o) => o.status === 'returned'));
  // packagesSold = PAID units only (mirrors CRM agent-performance / elyon-agent-commissions)
  let packagesSold = 0;
  for (const o of paidOrders) {
    const items = itemsMap[o.id];
    if (items?.length) {
      packagesSold += items.reduce((s, it) => s + Number(it.quantity || 0), 0);
    } else {
      packagesSold += Number(o.quantity || 0) || 1;
    }
  }

  let commission = 0;
  for (const o of paidOrders) {
    commission += orderPackageBonus({ status: o.status, price: o.price, quantity: o.quantity, items: itemsMap[o.id] });
  }

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);

  return {
    leads,
    confirmed,
    shipped,
    paid,
    returned,
    cancelled,
    trashed,
    conversionRate: pct(confirmed, leads),
    collectionRate: pct(paid, shipped),
    returnRate: pct(returned, shipped),
    paidRevenue: round2(paidRevenue),
    outstanding: round2(outstanding),
    grossRevenue: round2(grossRevenue),
    returnedValue: round2(returnedValue),
    packagesSold,
    avgOrderValue: paid > 0 ? round2(paidRevenue / paid) : 0,
    commission: round2(commission),
  };
}
