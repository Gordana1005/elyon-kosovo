// Park brand-new-customer pendings into the static "Cancelled Pendings" list.
//
// Target set: pending orders whose customer phone has NEVER had any order of
// any other status (i.e. the customer only ever showed interest, never bought
// and was never otherwise processed). These clutter the live Pendings list.
//
// For each: set the order status='cancelled' (reason 'pending_cleanup', so the
// whole batch is findable/reversible), then upsert a row into the static
// "Cancelled Pendings" prediction list keeping phone + name + product so an
// agent can call them back later. The recompute trigger also files them into
// the normal cancel tiers by product price (as requested).
//
// Dry-run by default. Pass --commit to write.
//   node --env-file=.env scripts/cancel-new-customer-pendings.mjs
//   node --env-file=.env scripts/cancel-new-customer-pendings.mjs --commit

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const LIST_NAME = 'Cancelled Pendings';
const REASON = 'pending_cleanup';
const NOTE = 'Stale new-customer pending — auto-parked in Cancelled Pendings';

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

// 1. Per-phone status history (all orders).
const allOrders = await pageAll((a, b) => sb.from('orders').select('customer_phone, status').range(a, b));
const statusesByPhone = new Map();
for (const o of allOrders) {
  const p = o.customer_phone || '(none)';
  let s = statusesByPhone.get(p);
  if (!s) { s = new Set(); statusesByPhone.set(p, s); }
  s.add(o.status);
}

// 2. Pending orders with the detail we need.
const pendings = await pageAll((a, b) => sb.from('orders')
  .select('id, customer_phone, customer_name, product_name, price, created_at, cancellation_reason')
  .eq('status', 'pending').range(a, b));

// 3. Filter to brand-new customers (phone's entire history is only 'pending').
const targets = pendings.filter(o => {
  const s = statusesByPhone.get(o.customer_phone || '(none)');
  return s && [...s].every(x => x === 'pending');
});

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}`);
console.log(`Pending orders total: ${pendings.length}`);
console.log(`Brand-new-customer pendings to cancel + park: ${targets.length}`);
const distinctPhones = new Set(targets.map(t => t.customer_phone));
console.log(`Distinct customers: ${distinctPhones.size}`);

// Resolve the static list.
const { data: list, error: listErr } = await sb
  .from('prediction_segment_lists').select('id, name, is_static').eq('name', LIST_NAME).maybeSingle();
if (listErr || !list) {
  console.error(`\n"${LIST_NAME}" list not found — apply the migration first.`);
  process.exit(1);
}
if (!list.is_static) console.warn(`\n⚠️  "${LIST_NAME}" is not marked is_static — members may be recomputed away.`);

if (!COMMIT) {
  console.log('\nSample of what would be cancelled + parked:');
  for (const t of targets.slice(0, 10)) {
    console.log(`  ${t.customer_phone} | ${t.customer_name || '—'} | ${t.product_name || '(no product)'} | €${t.price ?? 0}`);
  }
  console.log('\nRe-run with --commit to apply.');
  process.exit(0);
}

// 4. Cancel the orders (chunked) — fires the recompute trigger per row.
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
    .eq('status', 'pending'); // guard: only flip ones still pending
  if (error) { console.error('Cancel failed:', error.message); process.exit(1); }
  cancelled += count || 0;
  process.stdout.write(`\r  cancelled ${cancelled}/${ids.length}`);
}
console.log(`\n  orders cancelled: ${cancelled}`);

// 5. Upsert static-list members (one per distinct phone; if a phone has
//    multiple pendings, keep the most recent as the trigger).
const byPhone = new Map();
for (const t of targets) {
  const prev = byPhone.get(t.customer_phone);
  if (!prev || new Date(t.created_at) > new Date(prev.created_at)) byPhone.set(t.customer_phone, t);
}
const rows = [...byPhone.values()].map(t => ({
  list_id: list.id,
  customer_phone: t.customer_phone,
  customer_name: t.customer_name || null,
  product_name: t.product_name || null,
  trigger_order_id: t.id,
  trigger_event_at: t.created_at,
  trigger_price: t.price ?? null,
  paid_count: 0,
  lifetime_value: 0,
  updated_at: new Date().toISOString(),
}));

let upserted = 0;
for (let i = 0; i < rows.length; i += 500) {
  const slice = rows.slice(i, i + 500);
  const { error, count } = await sb.from('prediction_segment_members')
    .upsert(slice, { onConflict: 'list_id,customer_phone', count: 'exact' });
  if (error) { console.error('Member upsert failed:', error.message); process.exit(1); }
  upserted += count || slice.length;
  process.stdout.write(`\r  parked ${Math.min(i + slice.length, rows.length)}/${rows.length}`);
}
console.log(`\n  members in "${LIST_NAME}": ${rows.length}`);

// 6. Verify.
const { count: listCount } = await sb.from('prediction_segment_members')
  .select('*', { count: 'exact', head: true }).eq('list_id', list.id);
const { count: stillPending } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending');
console.log(`\n=== Done ===`);
console.log(`"${LIST_NAME}" members: ${listCount}`);
console.log(`Pending orders remaining: ${stillPending}`);
