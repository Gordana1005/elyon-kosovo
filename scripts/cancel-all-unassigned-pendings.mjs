// Cancel ALL unassigned pending orders to clear stale pendings from the queue.
//
// Targets every order with status='pending' AND assigned_agent_id IS NULL.
// (Already-assigned pendings are left for their agent to work.) Each is set to
// status='cancelled' with reason 'stale_pending_cleanup' so the whole batch is
// findable / reversible as one set, independent of the new-customer
// 'pending_cleanup' batch.
//
// These are overwhelmingly returning buyers (already tracked in value-tier
// lists) with old pendings; the recompute trigger also files them into the
// cancel tiers by price/recency, so they remain reachable for win-back.
//
// Dry-run by default. Pass --commit to write.
//   node --env-file=.env scripts/cancel-all-unassigned-pendings.mjs
//   node --env-file=.env scripts/cancel-all-unassigned-pendings.mjs --commit

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const REASON = 'stale_pending_cleanup';
const NOTE = 'Stale unassigned pending — bulk-cancelled to clear the queue';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PAGE = 1000;

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

const targets = await pageAll((a, b) => sb.from('orders')
  .select('id, customer_phone, customer_name, product_name, price, created_at')
  .eq('status', 'pending').is('assigned_agent_id', null).range(a, b));

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}`);
console.log(`Unassigned pendings to cancel: ${targets.length}`);

if (!COMMIT) {
  console.log('\nSample:');
  for (const t of targets.slice(0, 10)) {
    console.log(`  ${t.customer_phone} | ${t.customer_name || '—'} | ${t.product_name || '(no product)'} | €${t.price ?? 0} | ${(t.created_at || '').slice(0, 10)}`);
  }
  console.log('\nRe-run with --commit to apply.');
  process.exit(0);
}

let cancelled = 0;
const ids = targets.map(t => t.id);
for (let i = 0; i < ids.length; i += 200) {
  const slice = ids.slice(i, i + 200);
  const { error, count } = await sb.from('orders')
    .update({
      status: 'cancelled',
      cancellation_reason: REASON,
      cancellation_reason_notes: NOTE,
      cancelled_at: new Date().toISOString(),
    }, { count: 'exact' })
    .in('id', slice)
    .eq('status', 'pending')
    .is('assigned_agent_id', null);
  if (error) { console.error('Cancel failed:', error.message); process.exit(1); }
  cancelled += count || 0;
  process.stdout.write(`\r  cancelled ${cancelled}/${ids.length}`);
}
console.log(`\n  orders cancelled: ${cancelled}`);

const { count: stillPending } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending');
const { count: unassignedLeft } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending').is('assigned_agent_id', null);
console.log(`\n=== Done ===`);
console.log(`Pending remaining: ${stillPending} (unassigned: ${unassignedLeft})`);
