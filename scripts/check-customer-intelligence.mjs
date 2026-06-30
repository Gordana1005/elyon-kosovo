// Verify whether the "63 orders" Customer Intelligence number for a given
// phone is real, an aggregation bug, or a collision from loose phone matching.
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const phones = [
  process.argv[2] || '+359035989511',
  '+359879460511',
  '+359885821580',
  '+359899113879',
];

const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

console.log('Comparing two matching strategies for each phone:\n');
console.log('Strategy A: EXACT match on full normalized phone (the right answer)');
console.log('Strategy B: ILIKE %last8%  (what the current endpoint does)\n');

for (const phone of phones) {
  const digits = phone.replace(/\D/g, '');
  const last8 = digits.slice(-8);

  // Strategy A: exact phone
  const exactRows = await paginate(() =>
    supabase.from('orders').select('id, customer_name, customer_phone, status, price').eq('customer_phone', phone)
  );

  // Strategy B: ilike last 8 (the bug)
  const ilikeRows = await paginate(() =>
    supabase.from('orders').select('id, customer_name, customer_phone, status, price').ilike('customer_phone', `%${last8}%`)
  );

  // Distinct customers behind the ilike result — collisions, if any
  const distinctNames = new Set(ilikeRows.map(r => r.customer_name));
  const distinctPhones = new Set(ilikeRows.map(r => r.customer_phone));

  const exactPaid = exactRows.filter(r => r.status === 'paid');
  const exactRev = exactPaid.reduce((s, r) => s + Number(r.price || 0), 0);
  const ilikePaid = ilikeRows.filter(r => r.status === 'paid');
  const ilikeRev = ilikePaid.reduce((s, r) => s + Number(r.price || 0), 0);

  console.log('═'.repeat(75));
  console.log(`Phone: ${phone}   (last 8: "${last8}")`);
  console.log('─'.repeat(75));
  console.log(`  Exact match:   ${exactRows.length.toString().padStart(4)} orders | ${exactPaid.length.toString().padStart(4)} paid | €${fmt(exactRev)}`);
  console.log(`  ILIKE %last8%: ${ilikeRows.length.toString().padStart(4)} orders | ${ilikePaid.length.toString().padStart(4)} paid | €${fmt(ilikeRev)}`);
  console.log(`  Distinct phones the ILIKE query collapsed together: ${distinctPhones.size}`);
  console.log(`  Distinct customer names: ${distinctNames.size}`);
  if (distinctPhones.size > 1) {
    console.log(`  Sample colliding phones:`);
    [...distinctPhones].slice(0, 5).forEach(p => console.log(`    ${p}`));
  }
}
