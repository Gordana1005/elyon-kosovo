#!/usr/bin/env node
// Restore non-wrong-number trashed members back to "Not yet called" in their
// ORIGINAL calling lists. The 5-no-answer auto-trash (and a few other paths) set
// is_completed=true + last_call_outcome='trash' on a member, which hides it from
// every list's default view. This un-hides everything EXCEPT wrong_number /
// wrong_person, which the engine (migration 20260725000000) parks in the static
// "Trashed" list and is excluded here.
//
// Safe by construction: only flips is_completed true->false (un-hide) and clears
// last_call_outcome on NON-static lists, for rows currently is_completed=true AND
// last_call_outcome='trash'. Phones already in the Trashed list are skipped.
// Writes a rollback JSON. Dry-run unless --commit.
//
// ORDER: apply the migration FIRST (so wrong-number people are already moved into
// Trashed and out of their bands), THEN run this with --commit.
//
// Usage:
//   node --env-file=.env scripts/restore-trashed-to-lists.mjs            (dry-run)
//   node --env-file=.env scripts/restore-trashed-to-lists.mjs --commit   (write)

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}\n`);

// Calling lists = non-static. Restore only ever happens here.
const { data: lists, error: lErr } = await sb.from('prediction_segment_lists').select('id, name, is_static');
if (lErr) { console.error(lErr.message); process.exit(1); }
const trashedListId = lists.find(l => l.name === 'Trashed')?.id || null;
if (!trashedListId) {
  console.warn('⚠ No "Trashed" list found — apply migration 20260725000000 FIRST, otherwise wrong-number');
  console.warn('  customers cannot be excluded from the restore. Continuing (dry-run still safe to inspect).\n');
}

// Phones already parked in the Trashed list (wrong_number/wrong_person) — never restore these.
const trashedPhones = new Set();
if (trashedListId) {
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('prediction_segment_members')
      .select('customer_phone').eq('list_id', trashedListId).range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || !data.length) break;
    for (const r of data) trashedPhones.add(r.customer_phone);
    if (data.length < 1000) break; from += 1000;
  }
}

// Target rows: hidden trash members on calling (non-static) lists.
let from = 0; const targets = [];
for (;;) {
  const { data, error } = await sb.from('prediction_segment_members')
    .select('list_id, customer_phone, prediction_segment_lists!inner(name, is_static)')
    .eq('is_completed', true).eq('last_call_outcome', 'trash')
    .eq('prediction_segment_lists.is_static', false)
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || !data.length) break;
  targets.push(...data);
  if (data.length < 1000) break; from += 1000;
}

const restore = targets.filter(t => !trashedPhones.has(t.customer_phone));
const skipped = targets.length - restore.length;

// Group by list for a readable summary + chunked, race-guarded updates.
const byList = new Map();
for (const t of restore) {
  if (!byList.has(t.list_id)) byList.set(t.list_id, { name: t.prediction_segment_lists.name, phones: [] });
  byList.get(t.list_id).phones.push(t.customer_phone);
}

console.log(`Hidden trash members on calling lists: ${targets.length}`);
console.log(`  excluded (already in Trashed list):   ${skipped}`);
console.log(`  TO RESTORE (is_completed -> false):    ${restore.length}\n`);
for (const [, v] of [...byList.entries()].sort((a, b) => b[1].phones.length - a[1].phones.length)) {
  console.log(`  ${String(v.phones.length).padStart(4)}  ${v.name}`);
}

if (restore.length === 0) { console.log('\nNothing to restore.'); process.exit(0); }
if (!COMMIT) { console.log(`\nDRY-RUN: re-run with --commit to restore ${restore.length} members.`); process.exit(0); }

// Rollback snapshot (flip back: is_completed=true, last_call_outcome='trash').
const rollback = restore.map(t => ({ list_id: t.list_id, customer_phone: t.customer_phone, prev_is_completed: true, prev_last_call_outcome: 'trash' }));

let done = 0, failed = 0;
const CHUNK = 200;
for (const [listId, v] of byList) {
  for (let i = 0; i < v.phones.length; i += CHUNK) {
    const slice = v.phones.slice(i, i + CHUNK);
    const { data: upd, error } = await sb.from('prediction_segment_members')
      .update({ is_completed: false, last_call_outcome: null })
      .eq('list_id', listId)
      .in('customer_phone', slice)
      .eq('is_completed', true)            // guard: still hidden
      .eq('last_call_outcome', 'trash')    // guard: still a trash
      .select('customer_phone');
    if (error) { failed += slice.length; console.warn(`  ${v.name}: ${error.message}`); continue; }
    done += upd?.length ?? 0;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = `scripts/restore-trashed-rollback-${stamp}.json`;
writeFileSync(path, JSON.stringify(rollback, null, 2));
console.log(`\nDone — restored: ${done}, failed/skipped: ${failed}`);
console.log(`Rollback snapshot: ${path}`);
