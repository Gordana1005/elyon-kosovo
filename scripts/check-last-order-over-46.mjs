// Read-only audit for the "Last 6m · last order €46+" segment list.
//
// Independently computes the target set (each customer's most recent paid
// order, kept when that order was placed in the last 6 months AND its price
// is >= €46), prints it per-order (NOT lifetime), then cross-checks the
// count against the actual segment-list membership so you can trust the
// list equals reality.
//
// Run: node --env-file=.env scripts/check-last-order-over-46.mjs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const BGN_PER_EUR = 1.95583;
const THRESHOLD_EUR = 46;
const RECENCY_MONTHS = 6;
const LIST_NAME = 'Last 6m · last order €46+';

const eur = (n) => `€${Number(n).toFixed(2)}`;
const lev = (n) => `${(Number(n) * BGN_PER_EUR).toFixed(2)} лв`;

// Recency cutoff: the engine uses months * 30 days. Match it exactly.
const cutoff = new Date(Date.now() - RECENCY_MONTHS * 30 * 24 * 60 * 60 * 1000);

// 1. Page through every paid order, keep each customer's most-recent one.
const lastPaid = new Map(); // phone -> { id, price, created_at, customer_name }
let from = 0;
const PAGE = 1000;
let scanned = 0;
for (;;) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_phone, customer_name, price, created_at')
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .range(from, from + PAGE - 1);
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  scanned += data.length;
  for (const o of data) {
    if (!o.customer_phone) continue;
    const prev = lastPaid.get(o.customer_phone);
    if (!prev || new Date(o.created_at) > new Date(prev.created_at)) lastPaid.set(o.customer_phone, o);
  }
  if (data.length < PAGE) break;
  from += PAGE;
}

// 2. Filter to the target set.
const matches = [];
for (const [phone, o] of lastPaid) {
  if (new Date(o.created_at) >= cutoff && Number(o.price) >= THRESHOLD_EUR) {
    matches.push({ phone, name: o.customer_name || '—', price: Number(o.price), date: o.created_at.slice(0, 10) });
  }
}
matches.sort((a, b) => b.price - a.price);

// 3. Print.
console.log(`\nPaid orders scanned: ${scanned}`);
console.log(`Customers with ≥1 paid order: ${lastPaid.size}`);
console.log(`\n=== Customers whose LAST paid order was ≥ ${eur(THRESHOLD_EUR)} within ${RECENCY_MONTHS} months ===`);
console.log(`Independent count: ${matches.length}\n`);
console.log('  phone'.padEnd(20), 'last-order price'.padEnd(26), 'date'.padEnd(12), 'name');
console.log('  ' + '─'.repeat(78));
for (const m of matches) {
  const priceCol = `${eur(m.price)} (${lev(m.price)})`;
  console.log('  ' + m.phone.padEnd(18), priceCol.padEnd(26), m.date.padEnd(12), m.name);
}

// 4. Cross-check against the actual segment-list membership.
const { data: list } = await supabase
  .from('prediction_segment_lists')
  .select('id, name')
  .eq('name', LIST_NAME)
  .maybeSingle();

if (!list) {
  console.log(`\n⚠️  Segment list "${LIST_NAME}" not found — has the migration been applied?`);
  process.exit(0);
}

const { count: memberCount } = await supabase
  .from('prediction_segment_members')
  .select('*', { count: 'exact', head: true })
  .eq('list_id', list.id);

console.log(`\n=== Cross-check ===`);
console.log(`Segment-list members: ${memberCount ?? 0}`);
console.log(`Independent count:    ${matches.length}`);
const drift = (memberCount ?? 0) - matches.length;
console.log(drift === 0
  ? `✅ Match — the list equals reality (drift 0).`
  : `⚠️  Drift of ${drift}. Small drift can be boundary rows near the 6-month / €46 edge (the engine uses months×30 days and an inclusive ≥ price).`);
