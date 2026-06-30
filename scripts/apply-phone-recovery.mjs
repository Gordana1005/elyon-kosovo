#!/usr/bin/env node
// Apply phone-number recovery — fixes Tier A + SELF + B and un-trashes recovered
// orders so they become callable again.
//
//   A    — sibling by name + postal/city (address-corroborated).
//   SELF — the order's OWN buried BG mobile, de-corrupted from a glued string.
//   B    — sibling by name only (single agreed number).
// CONFLICT / unrecoverable rows are left untouched.
//
// Re-derives everything from the LIVE database via the shared recovery logic, so
// it is idempotent (already-fixed orders no longer classify as bad) and never
// acts on a stale CSV. For each fix it:
//   1. Snapshots the original phone (+ status if trashed) into order_notes.
//   2. Updates orders.customer_phone by exact id, guarded on the old value.
//   3. If the order was trashed with a wrong-number reason, restores it to the
//      status it held BEFORE trashing (from order_history; falls back to
//      'pending'), clears the trash reason, and logs the transition.
//   4. Precisely cascades the number to the dialer queue
//      (prediction_segment_members) by trigger_order_id — no phone matching.
//   5. Writes a rollback JSON capturing every change.
//
// Usage:
//   node --env-file=.env scripts/apply-phone-recovery.mjs            (dry-run)
//   node --env-file=.env scripts/apply-phone-recovery.mjs --commit   (write)

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { ORDER_SELECT, computeRecovery } from './lib/phone-recovery.mjs';

const COMMIT = process.argv.includes('--commit');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PAGE = 1000;
const TRASHED_WRONG = ['wrong_number', 'not_reachable'];

// A recovered number must look like a real BG number: national part 8–9 digits
// starting 2–9 (mobiles 87/88/89/98/99; geographic codes 2–9). Blocks junk.
const VALID_BG = /^\+359[2-9]\d{7,8}$/;
const isTestRow = (f) => /^test\b/i.test((f.customer_name || '').trim()) || /^test$/i.test(f.customer_name || '');
const wasTrashedWrong = (f) => f._wasTrashed && TRASHED_WRONG.includes(f._bad.trash_reason || '');

// Policy:
//   A    — address-corroborated sibling: always safe to apply.
//   SELF — the order's own buried BG mobile: always safe (foreign/landline skipped upstream).
//   B    — name-only sibling: ONLY for orders an agent explicitly trashed as
//          wrong-number / not-reachable (number confirmed bad, nothing to lose).
//          Never overwrite a possibly-valid number on a non-trashed order by name alone.
function eligible(f) {
  if (isTestRow(f)) return false;
  if (!VALID_BG.test(f._proposed || '')) return false;
  if (f.tier === 'A' || f.tier === 'SELF') return true;
  if (f.tier === 'B') return wasTrashedWrong(f);
  return false;
}

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

// Status an order held immediately before it was trashed (newest such transition).
async function statusBeforeTrash(orderId) {
  const { data } = await sb.from('order_history')
    .select('from_status, changed_at')
    .eq('order_id', orderId).eq('to_status', 'trashed')
    .order('changed_at', { ascending: false }).limit(1);
  const fs = data?.[0]?.from_status;
  return (fs && fs !== 'trashed') ? fs : 'pending';
}

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}`);
console.log('Scope: Tier A + SELF + B; un-trashes recovered wrong-number orders.\n');

const orders = await pageAll((a, b) => sb.from('orders')
  .select(ORDER_SELECT).order('created_at', { ascending: false }).range(a, b));
console.log(`Orders scanned: ${orders.length}`);

const { rows } = computeRecovery(orders);
const fixes = rows.filter(eligible);
const byTier = (t) => fixes.filter(f => f.tier === t).length;
const untrashCount = fixes.filter(f => f._wasTrashed).length;
console.log(`Fixes to apply: ${fixes.length}  (A:${byTier('A')} SELF:${byTier('SELF')} B:${byTier('B')})`);
console.log(`  of which trashed → will be un-trashed: ${untrashCount}\n`);

if (fixes.length === 0) { console.log('Nothing to do.'); process.exit(0); }

console.log('Planned fixes (first 80):');
for (const f of fixes.slice(0, 80)) {
  const tag = f._wasTrashed ? ' [UN-TRASH]' : '';
  const src = f.tier === 'SELF' ? 'buried-mobile' : `src ${f.source_display_id}/${f.source_status}, ${f.match_basis}`;
  console.log(`  [${f.tier}] ${f.bad_display_id}  ${f.bad_phone}  →  ${f.proposed_phone}   [${f.customer_name}] (${src})${tag}`);
}

if (!COMMIT) {
  console.log(`\nDRY-RUN: no changes made. Re-run with --commit to apply ${fixes.length} fixes.`);
  process.exit(0);
}

// ── Commit ───────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rollback = [];
let updated = 0, failed = 0, untrashed = 0, queueUpdated = 0;

for (const f of fixes) {
  const id = f._bad.id;
  const oldPhone = f.bad_phone;
  const newPhone = f._proposed;
  const wasTrashed = f._wasTrashed && TRASHED_WRONG.includes(f._bad.trash_reason || '');
  const entry = { order_id: id, display_id: f.bad_display_id, tier: f.tier, old_phone: oldPhone, new_phone: newPhone, old_status: null, new_status: null, segment_members: [] };

  // 1. Snapshot original phone (+ status if we're going to un-trash).
  const snap = { customer_phone: oldPhone };
  if (wasTrashed) { snap.status = f._bad.status; snap.trash_reason = f._bad.trash_reason; }
  const { error: noteErr } = await sb.from('order_notes').insert({
    order_id: id,
    text: `Phone auto-recovered (tier ${f.tier}${f.tier === 'SELF' ? '' : ', src ' + f.source_display_id}). __ORIG__${JSON.stringify(snap)}`,
    author_name: 'System',
  });
  if (noteErr) { failed++; if (failed <= 10) console.warn(`  ${f.bad_display_id}: note failed — ${noteErr.message}`); continue; }

  // 2. Update phone, guarded on the old value (idempotent).
  const patch = { customer_phone: newPhone };
  if (wasTrashed) {
    const restore = await statusBeforeTrash(id);
    patch.status = restore;
    patch.trash_reason = null;
    patch.trash_reason_notes = null;
    entry.old_status = f._bad.status;
    entry.new_status = restore;
  }
  const { data: upd, error: updErr } = await sb.from('orders')
    .update(patch).eq('id', id).eq('customer_phone', oldPhone).select('id');
  if (updErr) { failed++; if (failed <= 10) console.warn(`  ${f.bad_display_id}: ${updErr.message}`); continue; }
  if (!upd || upd.length === 0) { console.warn(`  ${f.bad_display_id}: skipped (changed since scan)`); continue; }
  updated++;

  // 3. Log the un-trash transition so history stays truthful.
  if (wasTrashed) {
    untrashed++;
    await sb.from('order_history').insert({
      order_id: id, from_status: 'trashed', to_status: entry.new_status, changed_by_name: 'System (phone recovery)',
    });
  }

  // 4. Precise cascade to the dialer queue by trigger_order_id.
  const { data: members } = await sb.from('prediction_segment_members')
    .select('id, customer_phone').eq('trigger_order_id', id);
  for (const m of (members || [])) {
    entry.segment_members.push({ id: m.id, old_phone: m.customer_phone });
    const { error: mErr } = await sb.from('prediction_segment_members').update({ customer_phone: newPhone }).eq('id', m.id);
    if (!mErr) queueUpdated++;
  }

  rollback.push(entry);
  if (updated % 20 === 0) process.stdout.write(`\r  applied ${updated}/${fixes.length}`);
}

const rollbackPath = `scripts/phone-recovery-rollback-${stamp}.json`;
writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2));

console.log(`\n\nDone — orders fixed: ${updated}, un-trashed: ${untrashed}, queue rows updated: ${queueUpdated}, failed/skipped: ${failed}`);
console.log(`Rollback snapshot: ${rollbackPath}`);
console.log('Each fixed order also carries an __ORIG__ note for audit/revert.');
