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

const orders = await paginate(() => supabase.from('orders').select('customer_phone, status'));
console.log(`Total orders: ${orders.length}`);

const phoneMap = new Map();
for (const o of orders) {
  if (!o.customer_phone) continue;
  if (!phoneMap.has(o.customer_phone)) phoneMap.set(o.customer_phone, { count: 0, paid: 0, returned: 0 });
  const p = phoneMap.get(o.customer_phone);
  p.count++;
  if (o.status === 'paid') p.paid++;
  if (o.status === 'returned') p.returned++;
}

const sorted = [...phoneMap.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`Unique phones: ${phoneMap.size}\n`);

console.log('TOP 10 customers by order count (likely repeat buyers):');
console.log('─'.repeat(60));
for (const [phone, stats] of sorted.slice(0, 10)) {
  console.log(`  ${phone.padEnd(20)} ${stats.count} orders  (${stats.paid} paid, ${stats.returned} returned)`);
}

const distribution = {};
for (const [, s] of sorted) {
  const bucket = s.count >= 10 ? '10+' : s.count >= 5 ? '5-9' : s.count >= 2 ? '2-4' : '1';
  distribution[bucket] = (distribution[bucket] || 0) + 1;
}
console.log('\nOrder-count distribution:');
console.log(`  1 order:    ${distribution['1'] || 0} customers`);
console.log(`  2-4 orders: ${distribution['2-4'] || 0} customers`);
console.log(`  5-9 orders: ${distribution['5-9'] || 0} customers`);
console.log(`  10+ orders: ${distribution['10+'] || 0} customers`);
