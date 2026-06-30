import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { count: total } = await supabase.from('prediction_segment_members').select('*', { count: 'exact', head: true });
console.log(`Real total memberships: ${total}`);

const { data: lists } = await supabase.from('prediction_segment_lists').select('id, name, display_order').order('display_order');
console.log(`Lists seeded: ${lists.length}\n`);

console.log('Real per-list counts:');
console.log('─'.repeat(50));
for (const l of lists) {
  const { count } = await supabase.from('prediction_segment_members').select('*', { count: 'exact', head: true }).eq('list_id', l.id);
  console.log(`  ${l.name.padEnd(20)} ${count ?? 0}`);
}
