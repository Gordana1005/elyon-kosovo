#!/usr/bin/env node
// Phone-number RECOVERY report (READ-ONLY — performs zero DB writes).
//
// Problem: many customers carry a wrong / invalid phone on their order, so we
// can't call them. In this CRM a customer IS their phone (no customer id), so we
// can't find their other orders by phone when the phone itself is broken. The
// bridge back to the same human is NAME + ADDRESS/CITY.
//
// Classifies every order's phone as GOOD (clean +359… E.164) or BAD (too short /
// too long / scientific-notation pollution / empty, OR trashed wrong_number /
// not_reachable), then for each BAD order proposes a sibling GOOD order's number:
//   - Tier A: name matches AND postal/city corroborates (high confidence).
//   - Tier B: name matches but address can't corroborate (review).
//   - CONFLICT: sibling good orders disagree (needs a human).
//
// All matching logic lives in scripts/lib/phone-recovery.mjs (shared with the
// apply pass). This file only reads + writes a CSV.
//
// Usage:
//   node --env-file=.env scripts/recover-wrong-phones.mjs
// Output: phone-recovery-report-<timestamp>.csv in the project root.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { ORDER_SELECT, computeRecovery } from './lib/phone-recovery.mjs';

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

console.log('Mode: DRY-RUN / REPORT ONLY — no database writes.\n');

const orders = await pageAll((a, b) => sb.from('orders')
  .select(ORDER_SELECT)
  .order('created_at', { ascending: false })
  .range(a, b));
console.log(`Orders scanned: ${orders.length}`);

const { rows, tierA, tierSelf, tierB, conflicts, unrecoverable, reasonCounts, goodCount } = computeRecovery(orders);
const badTotal = tierA + tierSelf + tierB + conflicts + unrecoverable;
console.log(`GOOD (clean +359…, usable): ${goodCount}`);
console.log(`BAD (target for recovery):  ${badTotal}`);

// ── Write CSV ────────────────────────────────────────────────────────────────
const COLS = ['bad_display_id', 'status', 'bad_reason', 'customer_name', 'bad_phone', 'proposed_phone', 'source_display_id', 'source_status', 'tier', 'match_basis', 'n_candidates'];
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const order = { A: 0, SELF: 1, B: 2, CONFLICT: 3, UNRECOVERABLE: 4 };
rows.sort((a, b) => order[a.tier] - order[b.tier]);
const csv = [COLS.join(','), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(','))].join('\n');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = `phone-recovery-report-${stamp}.csv`;
writeFileSync(outPath, '﻿' + csv); // BOM so Excel reads Cyrillic correctly

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n──────── RECOVERY SUMMARY ────────');
console.log(`Bad numbers total:        ${badTotal}`);
console.log(`  ↳ Tier A    (name+address sibling):       ${tierA}`);
console.log(`  ↳ Tier SELF (own buried mobile):          ${tierSelf}`);
console.log(`  ↳ Tier B    (name only, review):          ${tierB}`);
console.log(`  ↳ CONFLICT  (siblings disagree):          ${conflicts}`);
console.log(`  ↳ Unrecoverable (nothing to go on):       ${unrecoverable}`);
console.log('\nWhy numbers were bad:');
for (const [r, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${r.padEnd(22)} ${n}`);
}
console.log(`\nRecoverable (A+SELF+B): ${tierA + tierSelf + tierB} of ${badTotal} bad numbers.`);
console.log(`\nReport written: ${outPath}`);
console.log('Apply with scripts/apply-phone-recovery.mjs --commit (fixes A+SELF+B, un-trashes recovered orders)');
