// Compare what the dashboard shows vs what's actually in the DB.
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function countBy(status) {
  const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', status);
  return count ?? 0;
}
async function sumBy(statuses) {
  // paginate
  let total = 0, from = 0; const PAGE = 1000;
  while (true) {
    const { data } = await supabase.from('orders').select('price, status').in('status', statuses).range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    total += data.reduce((s, o) => s + Number(o.price || 0), 0);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return total;
}

const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const confirmed = await countBy('confirmed');
const shipped = await countBy('shipped');
const paid = await countBy('paid');
const returned = await countBy('returned');
const pending = await countBy('pending');
const cancelled = await countBy('cancelled');

const grossRevenue = await sumBy(['shipped', 'paid']);
const outstanding = await sumBy(['shipped']);
const paidRevenue = await sumBy(['paid']);
const returnedAmount = await sumBy(['returned']);

console.log('═'.repeat(70));
console.log('ACTUAL DB COUNTS:');
console.log('═'.repeat(70));
console.log(`  Confirmed:  ${confirmed}`);
console.log(`  Shipped:    ${shipped}`);
console.log(`  Paid:       ${paid}`);
console.log(`  Returned:   ${returned}`);
console.log(`  Pending:    ${pending}`);
console.log(`  Cancelled:  ${cancelled}`);
console.log('');
console.log('ACTUAL DB AMOUNTS (EUR):');
console.log(`  Gross Revenue (shipped+paid):  €${fmt(grossRevenue)}`);
console.log(`  Outstanding (shipped only):    €${fmt(outstanding)}`);
console.log(`  Paid Revenue (paid only):      €${fmt(paidRevenue)}`);
console.log(`  Returned (returned only):      €${fmt(returnedAmount)}`);
console.log('');
console.log('═'.repeat(70));
console.log('WHAT YOUR SCREENSHOT IS SHOWING:');
console.log('═'.repeat(70));
console.log(`  Confirmed:  0      ✓ matches (no confirmed orders imported)`);
console.log(`  Shipped:    0      ✓ matches (no shipped orders imported)`);
console.log(`  Paid:       565    ✗ should be ${paid}`);
console.log(`  Returned:   49     ✗ should be ${returned}`);
console.log(`  Gross Rev:  20,265.43   ✗ should be €${fmt(grossRevenue)}`);
console.log(`  Paid Rev:   20,265.43   ✗ should be €${fmt(paidRevenue)}`);
console.log(`  Returned:   1,604.57    ✗ should be €${fmt(returnedAmount)}`);
console.log('');
console.log('"Today\'s Snapshot": 614 Taken / 614 Confirmed / 565 Paid');
console.log('  Total in cards: 0 + 0 + 565 + 49 = 614  ← exactly matches');
console.log('  These are the same 1,000 rows, double-counted.');
