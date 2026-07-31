#!/usr/bin/env node
// ============================================================================
// Imports the "MOnadon - Sheet1.csv" legacy client list (another company's
// historical cash-on-delivery orders) into the CRM as a SEPARATE, NON-COUNTED
// dataset used only for re-marketing.
//
// Design (see plan: Monadon legacy client list):
//   • Each kept row → one `orders` row with status='paid', source_type='monadon_legacy',
//     the ORIGINAL Monadon product name, the original COD amount (LEV→EUR), and a
//     created_at fixed to 2026-05-01 (the file has NO dates).
//   • An order_note starting with "MONADLIST" records the original product/price and
//     OUR equivalent product (mapping table below).
//   • source_type='monadon_legacy' is excluded everywhere financial/predictive
//     (recompute_customer_segments migration + api/index.ts), so these never count in
//     insights/commissions and never join the rule-driven prediction lists.
//   • All kept phones are placed in ONE static segment "FULL MONAD LIST" (shown in
//     /segments), one member row per distinct phone with aggregated paid_count / lifetime.
//
// Rules:
//   • ONE POWER ZOOM GLASSES rows are dropped entirely (not wanted).
//   • Phones that already exist in the CRM (any non-legacy order) are SKIPPED entirely
//     (orders + segment) — keeps the list to genuinely new/legacy-only people.
//   • Scientific-notation / junk (<8 digit) phones are skipped.
//
// Usage:
//   node scripts/import-monadon-csv.mjs                          (dry-run)
//   node --env-file=.env scripts/import-monadon-csv.mjs --commit
//   node --env-file=.env scripts/import-monadon-csv.mjs --commit --limit 50
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT;
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : null; })();
const FILE_PATH = process.env.MONADON_CSV_PATH || 'MOnadon - Sheet1.csv';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('--commit requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env scripts/import-monadon-csv.mjs --commit');
  process.exit(1);
}

const BGN_PER_EUR = 1.95583;
const levToEur = (l) => Math.round((l / BGN_PER_EUR) * 100) / 100;
const LEGACY_CREATED_AT = '2026-05-01T12:00:00Z'; // agreed as-if date (file has no dates)
const SOURCE_TYPE = 'monadon_legacy';
const LIST_NAME = 'FULL MONAD LIST';

// Monadon product brand → our substitute. SINGLE SOURCE OF TRUTH:
// src/lib/monadonSubstitutes.json — shared with the frontend display helper
// (src/lib/monadonSubstitutes.ts) and scripts/refresh-monad-substitutes.mjs, so the
// mapping never drifts across import / display / refresh. Keys are UPPERCASE base brands.
const PRODUCT_MAP = Object.fromEntries(
  JSON.parse(readFileSync(new URL('../src/lib/monadonSubstitutes.json', import.meta.url), 'utf8'))
    .map((e) => [e.brand, e.substitute]),
);
const DROP_BRAND = 'ONE POWER ZOOM GLASSES';

// ── Minimal RFC-4180-ish CSV parser (handles quotes, commas, CRLF) ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const g = (r, i) => (r[i] ?? '').toString().trim();

// Strip packaging tier + qty to get the base brand, e.g. "TESTOY 6 PCS X 1" → "TESTOY".
function baseBrand(item) {
  let s = item.trim().toUpperCase();
  s = s.replace(/\bX\s*\d+\s*$/i, '').trim();
  s = s.replace(/\b(SINGLE|DUO|TRIO|QUATTRO)\b/gi, ' ');
  s = s.replace(/\b\d+\s*PCS\b/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function mapProducts(productCell) {
  const parts = productCell.split(',').map((x) => x.trim()).filter(Boolean);
  const brands = parts.map(baseBrand);
  const mapped = brands.map((b) => PRODUCT_MAP[b] ?? '').filter(Boolean);
  return { parts, brands, mapped: [...new Set(mapped)] };
}

function normalizePhone(raw) {
  if (raw == null) return null;
  const str = String(raw);
  if (/e[+-]?\d+/i.test(str.replace(/\s/g, ''))) return null; // scientific-notation pollution → drop
  const digits = str.replace(/\D/g, '');
  if (digits.length < 8) return null;                          // junk (5-digit etc.)
  if (digits.length >= 11 && digits.startsWith('359')) return '+' + digits;
  if (digits.length === 10 && digits.startsWith('0')) return '+359' + digits.slice(1);
  if (digits.length === 9) return '+359' + digits;
  if (digits.length === 8) return '+359' + digits;
  return '+' + digits;
}
const last8 = (p) => p.replace(/\D/g, '').slice(-8);

function parseCodLev(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().replace('lev', '').replace(/\s/g, '').replace(',', '.');
  const m = s.match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ── Read + normalize ──
console.log('═'.repeat(80));
console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will insert into DB)'}`);
console.log(`File: ${FILE_PATH}`);
if (LIMIT) console.log(`Limit: first ${LIMIT} kept rows`);
console.log('═'.repeat(80));

const rows = parseCsv(readFileSync(FILE_PATH, 'utf8'));
const data = rows.slice(1).filter((r) => r.some((c) => (c ?? '').toString().trim()));
console.log(`Data rows (non-empty): ${data.length}`);

// Existing CRM phones (any non-legacy order) → skip overlaps. Only needed for --commit,
// but we also fetch in dry-run if creds are present, to report the real overlap count.
let existing = new Set();
let supabase = null;
if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log('Loading existing CRM phones (non-legacy) to skip overlaps…');
  for (let offset = 0; ; offset += 1000) {
    const { data: ex, error } = await supabase.from('orders')
      .select('customer_phone, source_type')
      .neq('source_type', SOURCE_TYPE)
      .range(offset, offset + 999);
    if (error) { console.error('Failed loading existing phones:', error.message); process.exit(1); }
    if (!ex || ex.length === 0) break;
    for (const o of ex) { const p = (o.customer_phone || '').replace(/\D/g, '').slice(-8); if (p.length === 8) existing.add(p); }
    if (ex.length < 1000) break;
  }
  console.log(`Existing CRM phones loaded: ${existing.size}`);
} else {
  console.log('(no DB creds — overlap skipping will run only in --commit; dry-run counts exclude overlap detection)');
}

const skip = { onePower: 0, badPhone: 0, overlap: 0, dupeInFile: 0 };
const seenInFile = new Set();
const orders = [];

for (const r of data) {
  const productCell = g(r, 7);
  if (!productCell) continue;
  const { parts, brands, mapped } = mapProducts(productCell);
  if (brands.includes(DROP_BRAND)) { skip.onePower++; continue; }

  const phone = normalizePhone(g(r, 3));
  if (!phone) { skip.badPhone++; continue; }
  const key = last8(phone);
  if (existing.has(key)) { skip.overlap++; continue; }

  const lev = parseCodLev(g(r, 8));
  const eur = lev != null ? levToEur(lev) : 0;

  orders.push({
    customer_name: g(r, 1),
    customer_phone: phone,
    phone_key: key,
    customer_city: g(r, 4),
    customer_address: [g(r, 5), g(r, 6)].filter(Boolean).join(' — '),
    product_name: productCell,
    brands,
    mapped,
    price_eur: eur,
    price_lev: lev,
  });
  if (seenInFile.has(key)) skip.dupeInFile++; else seenInFile.add(key);
}

const limited = LIMIT ? orders.slice(0, LIMIT) : orders;

// ── Stats ──
const byBrand = {};
let totalEur = 0;
for (const o of limited) {
  totalEur += o.price_eur;
  for (const b of o.brands) byBrand[b] = (byBrand[b] || 0) + 1;
}
const distinctPhones = new Set(limited.map((o) => o.phone_key));

console.log('\n── Skipped ──');
console.log(`  ONE POWER ZOOM GLASSES rows : ${skip.onePower}`);
console.log(`  bad/sci-notation/junk phone : ${skip.badPhone}`);
console.log(`  overlap with existing client: ${skip.overlap}`);
console.log('\n── To import ──');
console.log(`  orders (rows)           : ${limited.length}`);
console.log(`  distinct phones (members): ${distinctPhones.size}  (repeat buyers kept as multiple orders, one member)`);
console.log(`  total value             : €${totalEur.toFixed(2)}  (${(totalEur * BGN_PER_EUR).toFixed(2)} лв)`);
console.log('\n── By base brand (order count) ──');
for (const [b, c] of Object.entries(byBrand).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padStart(5)}  ${b}${PRODUCT_MAP[b] ? '  → ' + PRODUCT_MAP[b] : '  (unmapped)'}`);
}
console.log('\nSample (first 3):');
for (const o of limited.slice(0, 3)) {
  console.log(`  ${o.customer_name} | ${o.customer_phone} | ${o.product_name} | €${o.price_eur} | → ${o.mapped.join(', ') || '—'}`);
}

if (DRY_RUN) {
  console.log('\nDRY-RUN complete. Re-run with --commit to insert.');
  process.exit(0);
}

// ── COMMIT ──
console.log('\n' + '═'.repeat(80) + '\nCOMMIT MODE: writing to DB…\n' + '═'.repeat(80));

function noteText(o) {
  const eq = o.mapped.length ? o.mapped.join(', ') : '—';
  const amt = o.price_lev != null ? `${o.price_lev.toFixed(2)} лв` : 'amount unknown';
  return `MONADLIST | Original: ${o.product_name} @ ${amt} | Our equivalent: ${eq} | legacy import (друга компания), original date unknown`;
}

const BATCH = 200;
const insertedDisplayIds = [];
// memberByPhone aggregates across all kept orders for a phone.
const memberByPhone = new Map();

let succeeded = 0, failed = 0;
const errors = [];

for (let i = 0; i < limited.length; i += BATCH) {
  const batch = limited.slice(i, i + BATCH);
  const orderRows = batch.map((o) => ({
    product_id: null,
    product_name: o.product_name,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_city: o.customer_city,
    customer_address: o.customer_address,
    postal_code: '',
    price: o.price_eur,
    status: 'paid',
    source_type: SOURCE_TYPE,
    assigned_agent_name: null,
    created_at: LEGACY_CREATED_AT,
  }));

  let { data: ins, error } = await supabase.from('orders').insert(orderRows).select('id, display_id');
  if (error) {
    console.warn(`Batch ${Math.floor(i / BATCH) + 1} failed (${error.message}) — per-row fallback`);
    ins = [];
    for (let j = 0; j < orderRows.length; j++) {
      const { data: one, error: e } = await supabase.from('orders').insert([orderRows[j]]).select('id, display_id');
      if (e) { failed++; errors.push({ name: batch[j].customer_name, error: e.message }); }
      else if (one?.[0]) ins.push({ ...one[0], _idx: j });
    }
  }
  if (!ins || ins.length === 0) continue;

  // order_items + order_notes, and accumulate member aggregates
  const items = [], notes = [];
  ins.forEach((row, k) => {
    const idx = row._idx ?? k;
    const o = batch[idx];
    items.push({ order_id: row.id, product_id: null, product_name: o.product_name, quantity: 1, price_per_unit: o.price_eur, total_price: o.price_eur });
    notes.push({ order_id: row.id, text: noteText(o), author_name: 'System (MONADLIST import)' });

    const m = memberByPhone.get(o.phone_key) || { phone: o.customer_phone, name: o.customer_name, paid: 0, lifetime: 0, order_id: row.id, product: o.product_name, mapped: o.mapped };
    m.paid += 1; m.lifetime += o.price_eur;
    if (!m.name && o.customer_name) m.name = o.customer_name;
    memberByPhone.set(o.phone_key, m);
    insertedDisplayIds.push(row.display_id);
    succeeded++;
  });
  if (items.length) { const { error: e } = await supabase.from('order_items').insert(items); if (e) console.warn('  order_items warning:', e.message); }
  if (notes.length) { const { error: e } = await supabase.from('order_notes').insert(notes); if (e) console.warn('  order_notes warning:', e.message); }
  process.stdout.write(`Batch ${Math.floor(i / BATCH) + 1}: +${ins.length} (total ${succeeded})\r`);
}

console.log(`\nOrders inserted: ${succeeded}, failed: ${failed}`);

// ── FULL MONAD LIST static segment ──
console.log(`\nEnsuring static segment "${LIST_NAME}"…`);
let { data: listRow } = await supabase.from('prediction_segment_lists').select('id').eq('name', LIST_NAME).maybeSingle();
if (!listRow) {
  const { data: created, error } = await supabase.from('prediction_segment_lists').insert({
    name: LIST_NAME,
    description: 'Imported legacy clients from another company (Monadon). Static re-marketing list — never counted in insights/commissions and never part of the rule-driven prediction rotation. Each member shows what they bought before + our equivalent product.',
    category: 'other',
    trigger_event: 'last_paid',
    is_static: true,
    is_active: true,
    priority: 999,
    display_order: 900,
  }).select('id').single();
  if (error) { console.error('Failed creating list:', error.message); process.exit(1); }
  listRow = created;
  console.log('  created.');
} else {
  console.log('  already exists, reusing.');
}

const memberRows = [...memberByPhone.values()].map((m) => ({
  list_id: listRow.id,
  customer_phone: m.phone,
  customer_name: m.name || null,
  product_name: m.mapped.length ? `${m.product} → ${m.mapped.join(', ')}` : m.product,
  trigger_order_id: m.order_id,
  trigger_event_at: LEGACY_CREATED_AT,
  trigger_price: Math.round((m.lifetime / m.paid) * 100) / 100,
  last_paid_at: LEGACY_CREATED_AT,
  paid_count: m.paid,
  lifetime_value: Math.round(m.lifetime * 100) / 100,
  avg_package_price: Math.round((m.lifetime / m.paid) * 100) / 100,
  updated_at: new Date().toISOString(),
}));

let memberUpserted = 0;
for (let i = 0; i < memberRows.length; i += 500) {
  const slice = memberRows.slice(i, i + 500);
  const { error, count } = await supabase.from('prediction_segment_members')
    .upsert(slice, { onConflict: 'list_id,customer_phone', count: 'exact' });
  if (error) { console.error('Member upsert failed:', error.message); process.exit(1); }
  memberUpserted += count || slice.length;
}
console.log(`FULL MONAD LIST members upserted: ${memberUpserted}`);

const rollbackPath = `scripts/monadon-import-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
writeFileSync(rollbackPath, insertedDisplayIds.join('\n'));
console.log('\n' + '═'.repeat(80));
console.log(`MONADON IMPORT COMPLETE — orders ${succeeded}, members ${memberUpserted}`);
console.log(`Rollback list: ${rollbackPath}`);
console.log(`To roll back the ORDERS: node --env-file=.env scripts/rollback-cpa-import.mjs ${rollbackPath}`);
console.log(`(then optionally remove the "${LIST_NAME}" list from /segments)`);
console.log('═'.repeat(80));
if (errors.length) { console.log('\nErrors:'); for (const e of errors.slice(0, 20)) console.log(' ', e.name, '→', e.error); }
