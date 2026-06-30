import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: lists } = await supabase
  .from('prediction_segment_lists')
  .select('id, name, category, display_order')
  .order('display_order');

console.log(`Lists seeded: ${lists.length}\n`);

console.log('Membership counts per list:');
console.log('─'.repeat(60));
let totalMembers = 0;
for (const l of lists) {
  const { count } = await supabase
    .from('prediction_segment_members')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', l.id);
  totalMembers += count || 0;
  console.log(`  [${l.category.padEnd(8)}] ${l.name.padEnd(20)} ${String(count ?? 0).padStart(6)}`);
}
console.log(`\nTotal memberships across all lists: ${totalMembers}`);

const { count: distinctCustomers } = await supabase
  .from('prediction_segment_members')
  .select('customer_phone', { count: 'exact', head: true });

console.log(`\nPost-redesign invariants (2026-05 priority + 21-day model):`);
console.log(`  Distinct phones with rule-driven members: ${distinctCustomers}`);

// New check: zero duplicates on non-static lists (the whole point of the redesign)
const { data: allNonStatic } = await supabase
  .from('prediction_segment_members')
  .select('customer_phone, prediction_segment_lists!inner(is_static)')
  .eq('prediction_segment_lists.is_static', false);

const dupCount = {};
for (const row of allNonStatic || []) {
  dupCount[row.customer_phone] = (dupCount[row.customer_phone] || 0) + 1;
}
const multi = Object.values(dupCount).filter(c => c > 1).length;
console.log(`  Phones with 2+ non-static lists (MUST BE 0): ${multi}`);

if (multi === 0) {
  console.log('  ✅ Zero duplicates on rule-driven lists — redesign working perfectly.');
} else {
  console.log('  ⚠️  Duplicates still present — run the cleanup script.');
}

async function sample(listName, orderBy, limit = 5) {
  const list = lists.find(l => l.name === listName);
  if (!list) return;
  const { data: members } = await supabase
    .from('prediction_segment_members')
    .select('customer_name, customer_phone, paid_count, lifetime_value, trigger_price, trigger_event_at')
    .eq('list_id', list.id)
    .order(orderBy, { ascending: false })
    .limit(limit);
  console.log(`\nSample of "${listName}" (top ${limit} by ${orderBy}):`);
  for (const m of (members || [])) {
    const days = Math.floor((Date.now() - new Date(m.trigger_event_at).getTime()) / 86400000);
    const months = (days / 30).toFixed(1);
    console.log(`  ${(m.customer_name || '(no name)').padEnd(28)} ${m.customer_phone.padEnd(16)} paid=${String(m.paid_count).padStart(2)}  trigger=€${(Number(m.trigger_price) || 0).toFixed(2).padStart(7)}  total=€${(Number(m.lifetime_value) || 0).toFixed(2).padStart(8)}  ${months}m ago`);
  }
}

await sample('1y+ Premium', 'lifetime_value');
await sample('3-6m Premium', 'lifetime_value');
await sample('6+m Premium', 'lifetime_value');
await sample('3-6m Return', 'trigger_event_at');
await sample('1y+ Cancel', 'trigger_event_at');
