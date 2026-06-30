// Read-only audit: confirm the analytics rebuild is correct against live data.
//   node --env-file=.env scripts/check-insights-accuracy.mjs            (today)
//   node --env-file=.env scripts/check-insights-accuracy.mjs 2026-05-01 2026-05-22
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const REAL = ['confirmed', 'shipped', 'delivered', 'paid', 'returned'];
const today = new Date().toISOString().slice(0, 10);
const from = process.argv[2] || today;
const to = process.argv[3] || today;
const toEnd = to + 'T23:59:59';

const normAgent = (raw) => {
  let n = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!n) return 'Unknown operator';
  n = n.replace(/\s+\p{L}\.?$/u, '').trim();
  return n || 'Unknown operator';
};

// Paginate past PostgREST's 1000-row cap.
const SOLD = ['confirmed', 'shipped', 'delivered', 'paid'];
const rows = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await supabase
    .from('orders')
    .select('status,price,assigned_agent_name,confirmed_by_name,cancelled_by_agent_id,created_at')
    .gte('created_at', from).lte('created_at', toEnd)
    .range(f, f + 999);
  if (error) { console.error(error); process.exit(1); }
  if (!data?.length) break;
  rows.push(...data);
  if (data.length < 1000) break;
}

console.log(`\nRange ${from} → ${to}  ·  ${rows.length} order rows created\n`);

const byStatus = {};
for (const o of rows) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
console.log('By status:');
for (const [s, c] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  const tag = REAL.includes(s) ? 'ORDER' : '   — ';
  console.log(`  [${tag}] ${s.padEnd(12)} ${String(c).padStart(5)}`);
}

const realOrders = rows.filter((o) => REAL.includes(o.status));
console.log(`\nReal orders (what "Orders" should show): ${realOrders.length}`);
console.log(`Pending leads excluded: ${byStatus.pending || 0}  ·  cancelled: ${byStatus.cancelled || 0}  ·  trashed: ${byStatus.trashed || 0}  ·  call_again: ${byStatus.call_again || 0}`);

// Backfill check: every real order should carry a confirmer.
const missing = realOrders.filter((o) => !o.confirmed_by_name && !o.assigned_agent_name).length;
console.log(`\nReal orders with NO confirmer/assignee (would show "Unknown"): ${missing}`);

// Revenue is sold-based (confirmed/shipped/delivered/paid), not paid-only.
const sold = rows.filter((o) => SOLD.includes(o.status));
const soldRevenue = sold.reduce((s, o) => s + Number(o.price || 0), 0);
console.log(`\nSold orders (revenue base): ${sold.length}  ·  revenue €${soldRevenue.toFixed(2)}  ·  AOV €${sold.length ? (soldRevenue / sold.length).toFixed(2) : '0.00'}`);

// Per-confirmer breakdown (Agents tab: Orders count + Revenue).
const perAgent = {};
for (const o of realOrders) {
  const who = normAgent(o.confirmed_by_name ?? o.assigned_agent_name);
  perAgent[who] ??= { orders: 0, revenue: 0 };
  perAgent[who].orders++;
  if (SOLD.includes(o.status)) perAgent[who].revenue += Number(o.price || 0);
}
console.log('\nAgents tab (orders · revenue):');
for (const [who, a] of Object.entries(perAgent).sort((x, y) => y[1].orders - x[1].orders)) {
  console.log(`  ${who.padEnd(28)} ${String(a.orders).padStart(4)} orders   €${a.revenue.toFixed(2)}`);
}
console.log('');
