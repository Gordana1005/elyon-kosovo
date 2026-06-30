#!/usr/bin/env node
// Make product SKUs accurate = the EAN barcode (the number after "Баркод:" in
// the BigArena panel). The warehouse / OpenCart keys on the barcode, and the
// Daily Fulfilment CSV emits products.sku per line item, so sku must == barcode.
//
// Scope (per operator instruction 2026-05-22):
//   - ONLY update products that already exist in our DB. Do NOT insert new ones.
//   - For each existing product: set sku = its barcode (EAN).
//   - Fill in the barcode for the 6 products that are missing one (matched from
//     the BigArena panel by name).
//   - Rename "Комплекс от охлюви (30cps)" → "Snail Complex".
//   - Prostatol + Prosta Flow: both kept, both get their barcode. Prostatol is
//     effectively out of stock in the warehouse (panel = 2, DB = 302) → correct it.
//   - Report (do NOT auto-change) any other stock drift; small DB<panel gaps are
//     just orders shipped since the panel was exported.
//
// Usage:  node --env-file=.env scripts/fix-product-skus.mjs            # dry run
//         node --env-file=.env scripts/fix-product-skus.mjs --commit   # write

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';

const COMMIT = process.argv.slice(2).includes('--commit');

// ── BigArena panel: barcode + stock per product ──────────────────────────────
const file = readdirSync('.').find(f => /^Bigarena.*\.xlsx$/i.test(f));
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const parseSkuBarcode = (c) => {
  const m = c == null ? null : String(c).match(/SKU:\s*(\S+?)\s*Баркод:\s*(\S+)/);
  return m ? { sku: m[1].trim(), barcode: m[2].trim() } : { sku: null, barcode: null };
};
const parseStock = (c) => {
  const m = c == null ? null : String(c).match(/Свободна наличност:\s*(-?\d+)/);
  return m ? parseInt(m[1], 10) : null;
};
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// barcode -> summed panel stock ; name_norm -> { barcode, stock }
const panelStockByBarcode = new Map();
const panelByName = new Map();
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  if (!r || !r[0]) continue;
  const { barcode } = parseSkuBarcode(r[1]);
  const stock = parseStock(r[3]) ?? 0;
  if (barcode) panelStockByBarcode.set(barcode, (panelStockByBarcode.get(barcode) || 0) + stock);
  panelByName.set(norm(r[0]), { barcode, stock });
}

// ── Barcodes for the 6 DB products that have none (matched from panel) ────────
// keyed by current DB sku. BF- codes are BigArena internal refs, not real EANs.
const FILL_BARCODE = {
  'SKU-000014': '5319991983670', // ELIXY Серум со 20%снаил екстракт
  'SKU-000013': '5310416000118', // ELIXY Серум со витамин Ц
  'SKU-000016': '5310416000682', // OSTEOfix  (panel: "Osteo Fix (30cps)" NT0140)
  'SKU-000011': '5310416001160', // НЕВРО АКТИВ - 60капсули
  'SKU-000003': '5319991983717', // Простатол Комплекс (panel NT0004)
  'SKU-000012': 'BF-2MZJMMXBDZ', // ELIXY-Шампон Алое вера 500 мл. (no real EAN in panel)
};
const RENAME = { 'Комплекс от охлюви (30cps)': 'Snail Complex' };
// Operator confirmed the BigArena panel is the live warehouse truth for these.
// (Uro Protect deliberately left out — operator's "we don't have" can't be
//  reconciled with DB 2783 / panel 2786; awaiting the real number.)
const STOCK_FIX = {
  'SKU-000003': 2,    // Prostatol  (DB 302 → 2, effectively out of stock)
  'NT0143': 2934,     // Enduro Max (DB 2922 → 2934)
  'NT0063': 732,      // Brain active (DB 722 → 732)
  'NT0057': 138,      // Curcumactiv (DB 121 → 138)
  'SKU-000016': 10,   // OSTEOfix (DB 9 → 10)
};

// ── DB ───────────────────────────────────────────────────────────────────────
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const products = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, barcode, stock_quantity, is_active')
    .order('name').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  products.push(...data);
  if (data.length < 1000) break;
}

// ── Plan ───────────────────────────────────────────────────────────────────--
const updates = [];
const stockReport = [];
const problems = [];
for (const p of products) {
  const barcode = p.barcode || FILL_BARCODE[p.sku] || null;
  if (!barcode) { problems.push(`NO BARCODE: ${p.sku} — ${p.name} (skipped)`); continue; }

  const patch = {};
  if (p.sku !== barcode) patch.sku = barcode;          // sku := barcode
  if (!p.barcode) patch.barcode = barcode;             // fill missing barcode
  if (RENAME[p.name]) patch.name = RENAME[p.name];     // rename
  if (STOCK_FIX[p.sku] != null) patch.stock_quantity = STOCK_FIX[p.sku];

  if (Object.keys(patch).length) updates.push({ p, patch, barcode });

  // stock drift report (against the panel)
  const panel = panelStockByBarcode.get(barcode) ?? panelByName.get(norm(p.name))?.stock ?? null;
  if (panel != null && panel !== p.stock_quantity) {
    stockReport.push({ name: patch.name || p.name, db: p.stock_quantity, panel, diff: p.stock_quantity - panel });
  }
}

// ── Output ───────────────────────────────────────────────────────────────────
console.log(`📂 Panel: ${file}`);
console.log(`🗂  ${products.length} products in DB\n`);
console.log(`${COMMIT ? '✍️  COMMIT' : '🌵 DRY RUN'} — ${updates.length} product(s) to update:\n`);
console.log('NAME'.padEnd(46), 'OLD SKU'.padEnd(12), '→ NEW SKU (=barcode)', '  notes');
for (const { p, patch, barcode } of updates) {
  const notes = [];
  if (patch.barcode) notes.push('barcode filled');
  if (patch.name) notes.push(`renamed→"${patch.name}"`);
  if (patch.stock_quantity != null) notes.push(`stock ${p.stock_quantity}→${patch.stock_quantity}`);
  if (/^BF-/.test(barcode)) notes.push('⚠ not a real EAN');
  console.log((patch.name || p.name).slice(0, 45).padEnd(46), String(p.sku).padEnd(12), '→', barcode.padEnd(16), notes.join(', '));
}

console.log(`\n📊 Stock drift vs panel (NOT changed unless noted above):`);
for (const s of stockReport.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))) {
  console.log(`   ${s.name.slice(0, 45).padEnd(46)} DB=${String(s.db).padStart(5)}  panel=${String(s.panel).padStart(5)}  (${s.diff > 0 ? '+' : ''}${s.diff})`);
}
if (problems.length) { console.log('\n⚠ Problems:'); problems.forEach(x => console.log('   ' + x)); }

if (!COMMIT) { console.log('\nRe-run with --commit to write.'); process.exit(0); }

// ── Commit ────────────────────────────────────────────────────────────────---
let ok = 0;
for (const { p, patch } of updates) {
  const { error } = await supabase.from('products').update(patch).eq('id', p.id);
  if (error) { console.error(`✗ ${p.name}: ${error.message}`); continue; }
  ok++;
}
console.log(`\n✅ Updated ${ok}/${updates.length} products.`);
