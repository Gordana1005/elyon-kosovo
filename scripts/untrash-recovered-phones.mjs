#!/usr/bin/env node
// Un-trash orders whose phone we already recovered but that stayed trashed
// because their trash_reason was blank (so apply-phone-recovery.mjs — which only
// un-trashes explicit wrong_number/not_reachable — left them alone).
//
// Safe by construction: only touches orders that (a) are currently trashed,
// (b) carry a "Phone auto-recovered" audit note (so we know WE fixed the number),
// and (c) now hold a valid BG number. The broken (concatenated) number is strong
// evidence the trash was number-related. Restores the pre-trash status from
// order_history (fallback 'pending'), clears the trash reason, logs the
// transition, and writes a rollback file.
//
// Usage:
//   node --env-file=.env scripts/untrash-recovered-phones.mjs            (dry-run)
//   node --env-file=.env scripts/untrash-recovered-phones.mjs --commit   (write)

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const VALID_BG = /^\+359[2-9]\d{7,8}$/;

async function statusBeforeTrash(orderId) {
  const { data } = await sb.from('order_history')
    .select('from_status, changed_at').eq('order_id', orderId).eq('to_status', 'trashed')
    .order('changed_at', { ascending: false }).limit(1);
  const fs = data?.[0]?.from_status;
  return (fs && fs !== 'trashed') ? fs : 'pending';
}

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}\n`);

// Orders that carry our recovery note.
const { data: notes, error: nErr } = await sb.from('order_notes')
  .select('order_id, text').like('text', 'Phone auto-recovered%');
if (nErr) { console.error(nErr.message); process.exit(1); }
const recoveredIds = [...new Set((notes || []).map(n => n.order_id))];

const { data: targets, error: oErr } = await sb.from('orders')
  .select('id, display_id, status, trash_reason, customer_phone, customer_name')
  .in('id', recoveredIds).eq('status', 'trashed');
if (oErr) { console.error(oErr.message); process.exit(1); }

const eligible = (targets || []).filter(o => VALID_BG.test(o.customer_phone || ''));
console.log(`Recovered orders still trashed with a now-valid number: ${eligible.length}`);
for (const o of eligible) console.log(`  ${o.display_id}  ${o.customer_phone}  [${o.customer_name}]  (trash_reason: ${o.trash_reason ?? 'null'})`);

if (eligible.length === 0) { console.log('\nNothing to do.'); process.exit(0); }
if (!COMMIT) { console.log(`\nDRY-RUN: re-run with --commit to un-trash ${eligible.length} orders.`); process.exit(0); }

const rollback = [];
let done = 0, failed = 0;
for (const o of eligible) {
  const restore = await statusBeforeTrash(o.id);
  const { data: upd, error } = await sb.from('orders')
    .update({ status: restore, trash_reason: null, trash_reason_notes: null })
    .eq('id', o.id).eq('status', 'trashed').select('id'); // guard: still trashed
  if (error) { failed++; console.warn(`  ${o.display_id}: ${error.message}`); continue; }
  if (!upd || upd.length === 0) { console.warn(`  ${o.display_id}: skipped (changed since scan)`); continue; }
  await sb.from('order_history').insert({
    order_id: o.id, from_status: 'trashed', to_status: restore, changed_by_name: 'System (phone recovery un-trash)',
  });
  rollback.push({ order_id: o.id, display_id: o.display_id, old_status: 'trashed', new_status: restore, old_trash_reason: o.trash_reason });
  done++;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rollbackPath = `scripts/untrash-rollback-${stamp}.json`;
writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2));
console.log(`\nDone — un-trashed: ${done}, failed/skipped: ${failed}`);
console.log(`Rollback snapshot: ${rollbackPath}`);
