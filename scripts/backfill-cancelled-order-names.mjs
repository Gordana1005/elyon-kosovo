// Backfill customer_name on nameless cancelled / trashed orders.
//
// These rows are call-outcome records written during outbound re-marketing calls:
// when an agent marks a customer "not interested / no money / will call back" and
// that customer has no live pending, the CRM writes a cancelled order. The agent
// only sees their OWN orders (RLS), so the original named purchase is invisible to
// them and the name lands blank — leaving nameless rows on /orders.
//
// The name is recoverable: every such phone has a sibling order and/or a
// prediction_segment_members row that carries the real name. This script resolves
// the name by last-8 phone (CRM canon) and fills it in.
//
// Dry-run by default. Pass --commit to write. A rollback file (the affected IDs)
// is saved so the change can be reverted.
//   node --env-file=.env scripts/backfill-cancelled-order-names.mjs
//   node --env-file=.env scripts/backfill-cancelled-order-names.mjs --commit

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PAGE = 1000;
const last8 = (p) => String(p || '').replace(/\D/g, '').slice(-8);
const hasName = (n) => !!(n && String(n).trim());

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

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}`);

// 1. Every order — build a last-8 → best-known name map (most recent named wins),
//    and collect the nameless cancelled/trashed targets.
const orders = await pageAll((a, b) => sb.from('orders')
  .select('id, display_id, status, customer_phone, customer_name, created_at')
  .order('created_at', { ascending: false })
  .range(a, b));
console.log(`Orders scanned: ${orders.length}`);

const nameByLast8 = new Map(); // first seen = most recent (orders are created_at desc)
for (const o of orders) {
  const k = last8(o.customer_phone);
  if (k.length === 8 && hasName(o.customer_name) && !nameByLast8.has(k)) nameByLast8.set(k, o.customer_name.trim());
}

// 2. Fallback: prediction_segment_members names.
const members = await pageAll((a, b) => sb.from('prediction_segment_members')
  .select('customer_phone, customer_name').range(a, b));
const nameByLast8Seg = new Map();
for (const m of members) {
  const k = last8(m.customer_phone);
  if (k.length === 8 && hasName(m.customer_name) && !nameByLast8Seg.has(k)) nameByLast8Seg.set(k, m.customer_name.trim());
}
console.log(`Name sources — from orders: ${nameByLast8.size} phones · from segments: ${nameByLast8Seg.size} phones`);

// 3. Targets: cancelled/trashed with an empty name that we CAN resolve.
const targets = [];
let unresolvable = 0;
for (const o of orders) {
  if (!['cancelled', 'trashed'].includes(o.status)) continue;
  if (hasName(o.customer_name)) continue;
  const k = last8(o.customer_phone);
  const name = nameByLast8.get(k) || nameByLast8Seg.get(k) || null;
  if (name) targets.push({ id: o.id, display_id: o.display_id, status: o.status, name, source: nameByLast8.get(k) ? 'order' : 'segment' });
  else unresolvable++;
}

console.log(`\nNameless cancelled/trashed resolvable: ${targets.length}`);
console.log(`Nameless cancelled/trashed with NO name source (left as-is): ${unresolvable}`);

if (targets.length === 0) { console.log('\nNothing to backfill.'); process.exit(0); }

console.log('\nSample (first 12):');
for (const t of targets.slice(0, 12)) console.log(`  ${t.display_id} (${t.status}) → ${t.name}  [${t.source}]`);

if (!COMMIT) { console.log('\nRe-run with --commit to apply.'); process.exit(0); }

// 4. Rollback snapshot, then update (guarded so we only touch still-empty rows).
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rollbackPath = `scripts/backfill-names-rollback-${stamp}.json`;
writeFileSync(rollbackPath, JSON.stringify(targets, null, 2));
console.log(`\nRollback snapshot: ${rollbackPath}`);

let updated = 0, failed = 0;
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const { error } = await sb.from('orders')
    .update({ customer_name: t.name })
    .eq('id', t.id)
    .or('customer_name.is.null,customer_name.eq.'); // guard: only fill still-empty
  if (error) { failed++; if (failed <= 10) console.warn(`  ${t.display_id}: ${error.message}`); }
  else updated++;
  if ((i + 1) % 50 === 0 || i === targets.length - 1) process.stdout.write(`\r  updated ${updated}/${targets.length}`);
}
console.log(`\n\nDone — names filled: ${updated}, failed: ${failed}`);
console.log(`To roll back: set customer_name back to '' for the IDs in ${rollbackPath}`);
