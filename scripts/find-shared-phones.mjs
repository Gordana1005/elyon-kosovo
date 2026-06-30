// Find phones that have many distinct customer names attached — these are
// the "polluted" phones causing Customer Intelligence to look the same
// for unrelated customers.
import { createClient } from '@supabase/supabase-js';
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

console.log('Loading all orders...');
const orders = await paginate(() =>
  supabase.from('orders').select('customer_phone, customer_name')
);
console.log(`${orders.length} orders\n`);

// Group by phone, count distinct names
const phoneMap = new Map(); // phone → Set of names
for (const o of orders) {
  if (!o.customer_phone) continue;
  if (!phoneMap.has(o.customer_phone)) phoneMap.set(o.customer_phone, new Set());
  phoneMap.get(o.customer_phone).add((o.customer_name || '').trim());
}

const sorted = [...phoneMap.entries()]
  .map(([phone, names]) => ({ phone, distinctNames: names.size, namesList: [...names] }))
  .sort((a, b) => b.distinctNames - a.distinctNames);

console.log('TOP 20 PHONES BY DISTINCT CUSTOMER NAMES (likely placeholder/garbage):');
console.log('─'.repeat(75));
console.log('Phone'.padEnd(20), 'DistinctNames'.padStart(15), '  First few names');
console.log('─'.repeat(75));
for (const r of sorted.slice(0, 20)) {
  const sample = r.namesList.slice(0, 3).join(', ');
  console.log(r.phone.padEnd(20), String(r.distinctNames).padStart(15), '  ' + sample);
}

const polluted = sorted.filter(r => r.distinctNames > 1);
const ordersOnPolluted = orders.filter(o => phoneMap.get(o.customer_phone)?.size > 1).length;

console.log('\n─'.repeat(75));
console.log(`Phones with >1 distinct name: ${polluted.length} of ${phoneMap.size} (${(polluted.length / phoneMap.size * 100).toFixed(1)}%)`);
console.log(`Orders sitting on a polluted phone: ${ordersOnPolluted} of ${orders.length} (${(ordersOnPolluted / orders.length * 100).toFixed(1)}%)`);
console.log(`Phones unique to one customer (clean): ${sorted.filter(r => r.distinctNames === 1).length}`);

// Also check some specific shapes
const looksFake = sorted.filter(r => /^\+359[01]/.test(r.phone) || r.phone.length < 12);
console.log(`\nPhones starting with +3590 or +3591 (suspicious format): ${looksFake.length}`);
