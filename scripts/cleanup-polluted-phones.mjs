#!/usr/bin/env node
// Quarantines polluted phones — those that came from Excel scientific
// notation ("3.59889E+11" lost trailing precision and collapsed many
// distinct customers into the same fake number).
//
// Strategy: any phone that has >1 distinct customer_name attached to it
// is unrecoverable. We clear customer_phone (set to '') so the orders
// stay searchable by name/display_id but stop polluting Customer
// Intelligence.
//
// Usage:
//   node --env-file=.env scripts/cleanup-polluted-phones.mjs           (dry-run)
//   node --env-file=.env scripts/cleanup-polluted-phones.mjs --commit  (actually clear)

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function paginate(makeQuery, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

console.log(`Mode: ${COMMIT ? 'COMMIT (will clear phones)' : 'DRY-RUN'}`);
console.log('─'.repeat(70));

const orders = await paginate(() =>
  supabase.from('orders').select('id, customer_phone, customer_name')
);
console.log(`Loaded ${orders.length} orders`);

// Group by phone, count distinct names
const phoneMap = new Map();
for (const o of orders) {
  if (!o.customer_phone) continue;
  if (!phoneMap.has(o.customer_phone)) phoneMap.set(o.customer_phone, new Set());
  phoneMap.get(o.customer_phone).add((o.customer_name || '').trim());
}

const pollutedPhones = new Set(
  [...phoneMap.entries()].filter(([, names]) => names.size > 1).map(([p]) => p)
);
console.log(`Polluted phones (>1 distinct name): ${pollutedPhones.size}`);

const ordersToFix = orders.filter(o => pollutedPhones.has(o.customer_phone));
console.log(`Orders to fix: ${ordersToFix.length}`);

console.log('\nSample of orders that would be quarantined:');
for (const o of ordersToFix.slice(0, 5)) {
  console.log(`  ${o.id}  phone="${o.customer_phone}"  name="${o.customer_name}"`);
}

if (!COMMIT) {
  console.log('\nDRY-RUN: no changes made. Re-run with --commit to clear these phones.');
  process.exit(0);
}

console.log('\nUpdating in batches...');
const ids = ordersToFix.map(o => o.id);
const BATCH = 500;
let done = 0;
for (let i = 0; i < ids.length; i += BATCH) {
  const slice = ids.slice(i, i + BATCH);
  const { error } = await supabase.from('orders').update({ customer_phone: '' }).in('id', slice);
  if (error) {
    console.error('Batch update failed:', error);
    process.exit(1);
  }
  done += slice.length;
  process.stdout.write(`Updated ${done}/${ids.length}\r`);
}
console.log(`\nDone. ${done} orders had their customer_phone cleared.`);
