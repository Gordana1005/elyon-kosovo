#!/usr/bin/env node
// One-off (re-runnable) importer for the BigArena fulfilment-panel xlsx.
//
// Reads "Bigarena Fulfillment - Panel_*.xlsx" at the repo root, parses
// every row, and upserts into public.products keyed by SKU. Stock levels
// from the xlsx become the system-of-truth for the listed products.
//
// Usage (requires Node 20.6+; the project uses v22 so --env-file works):
//   node --env-file=.env scripts/import-products-bigarena.mjs                # dry-run
//   node --env-file=.env scripts/import-products-bigarena.mjs --commit       # actually upsert
//   node --env-file=.env scripts/import-products-bigarena.mjs --file=PATH    # custom xlsx
//
// Behavior:
//   - Stock > 10  → upsert (insert if missing, update otherwise) and force is_active=true.
//   - Stock <= 10 → only update existing rows' stock; do NOT insert new ones.
//                   is_active is left alone so warehouse can choose to deactivate.
//   - Rows are matched first by SKU; rows without a SKU fall back to a
//     normalized-name match (case + whitespace insensitive). On insert the
//     DB trigger auto-generates a SKU.
//   - Every stock change writes an inventory_logs row with reason='bigarena_import'.

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT;
const fileArg = args.find(a => a.startsWith('--file='));
const xlsxPath = fileArg
  ? fileArg.slice('--file='.length)
  : (() => {
      const here = readdirSync('.');
      const found = here.find(f => /^Bigarena.*\.xlsx$/i.test(f));
      if (!found) {
        console.error('No "Bigarena*.xlsx" file at repo root. Pass --file=path/to.xlsx.');
        process.exit(1);
      }
      return found;
    })();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('--commit requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env scripts/import-products-bigarena.mjs --commit');
  process.exit(1);
}

const supabase = COMMIT ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

// ────────────────────────────────────────────────────────────────────────────
// Parse
// ────────────────────────────────────────────────────────────────────────────

// "Резервирана наличност: 0Свободна наличност: 2934'>2934" → 2934
function parseFreeStock(cell) {
  if (cell == null) return null;
  const m = String(cell).match(/Свободна наличност:\s*(-?\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// "SKU: NT0143Баркод: 5310416001610" → { sku: "NT0143", barcode: "5310416001610" }
function parseSkuBarcode(cell) {
  if (cell == null) return { sku: null, barcode: null };
  const m = String(cell).match(/SKU:\s*(\S+?)\s*Баркод:\s*(\S+)/);
  return m ? { sku: m[1].trim(), barcode: m[2].trim() } : { sku: null, barcode: null };
}

const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

const normalizeName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const rawRows = [];
// Row 0 = title, Row 1 = headers, data starts at row 2
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  if (!r || !r[0]) continue;
  const name = String(r[0]).trim();
  const { sku, barcode } = parseSkuBarcode(r[1]);
  const stock = parseFreeStock(r[3]);
  rawRows.push({ name, name_norm: normalizeName(name), sku, barcode, stock: stock ?? 0 });
}

// Some products appear twice in the BigArena export under two SKUs (one with
// a Cyrillic name, one with a Latin one) but share an EAN — they're the same
// physical inventory. Merge them by barcode, summing stocks, and keep the
// first-seen SKU. Rows without a barcode pass through untouched.
const parsed = [];
const dedupedSet = new Set();
for (const r of rawRows) {
  if (!r.barcode) {
    parsed.push(r);
    continue;
  }
  const existing = parsed.find(p => p.barcode === r.barcode);
  if (existing) {
    existing.stock += r.stock;
    dedupedSet.add(r.barcode);
  } else {
    parsed.push(r);
  }
}
if (dedupedSet.size > 0) {
  console.log(`🔗 Merged ${dedupedSet.size} duplicate-barcode row(s):`);
  for (const bc of dedupedSet) {
    const dups = rawRows.filter(p => p.barcode === bc);
    console.log(`     ${bc}:`);
    for (const d of dups) console.log(`       ${d.sku} — ${d.name} — stock=${d.stock}`);
    const merged = parsed.find(p => p.barcode === bc);
    console.log(`     → kept SKU ${merged.sku}, summed stock=${merged.stock}`);
  }
  console.log();
}

const overTen = parsed.filter(p => p.stock > 10);
const tenOrLess = parsed.filter(p => p.stock <= 10);
const withoutSku = parsed.filter(p => !p.sku);

console.log(`📂 Source: ${xlsxPath}`);
console.log(`📋 Parsed ${parsed.length} rows`);
console.log(`   • ${parsed.length - withoutSku.length} with SKU (matched by SKU)`);
console.log(`   • ${withoutSku.length} without SKU (matched by normalized name)`);
console.log(`   • ${overTen.length} stock>10  (insert if missing, always update)`);
console.log(`   • ${tenOrLess.length} stock<=10 (only update if already in DB)`);
console.log();

if (DRY_RUN) {
  console.log('🌵 Dry run — re-run with --commit to actually write.');
  console.log();
  console.log('All stock>10 products to be upserted:');
  for (const p of overTen) {
    console.log(`     ${(p.sku || '(auto)').padEnd(8)}  ${p.name.padEnd(45)}  ${String(p.stock).padStart(5)}  ${p.barcode || '—'}`);
  }
  console.log();
  console.log('All stock<=10 products (only updated if already in DB):');
  for (const p of tenOrLess) {
    console.log(`     ${(p.sku || '(auto)').padEnd(8)}  ${p.name.padEnd(45)}  ${String(p.stock).padStart(5)}  ${p.barcode || '—'}`);
  }
  process.exit(0);
}

// ────────────────────────────────────────────────────────────────────────────
// Commit
// ────────────────────────────────────────────────────────────────────────────

let inserted = 0, updated = 0, skipped = 0, stockChanges = 0;
const failures = [];

// Pull all existing products in one shot — much faster than per-row lookups.
const existingBySku = new Map();
const existingByNameNorm = new Map();
{
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, stock_quantity, is_active, barcode')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const p of data) {
      if (p.sku) existingBySku.set(p.sku, p);
      const norm = normalizeName(p.name);
      if (norm) existingByNameNorm.set(norm, p);
    }
    if (data.length < PAGE) break;
  }
}
console.log(`🗂  Loaded ${existingBySku.size} products with SKU + ${existingByNameNorm.size} by name from DB.`);
console.log();

const allRows = [...overTen, ...tenOrLess];

for (const p of allRows) {
  // Match by SKU first; fall back to normalized-name lookup for SKU-less rows.
  const existing = (p.sku ? existingBySku.get(p.sku) : null) || existingByNameNorm.get(p.name_norm);
  const isOverTen = p.stock > 10;

  if (!existing) {
    if (!isOverTen) {
      // Per spec: don't insert new products with stock <= 10.
      skipped++;
      continue;
    }
    // Insert. If SKU is missing the BEFORE-INSERT trigger generates one.
    const insertRow = {
      name: p.name,
      barcode: p.barcode,
      stock_quantity: p.stock,
      is_active: true,
      price: 0,
    };
    if (p.sku) insertRow.sku = p.sku;
    const { data: ins, error } = await supabase
      .from('products')
      .insert(insertRow)
      .select('id, stock_quantity')
      .single();
    if (error) {
      failures.push({ sku: p.sku, error: error.message });
      continue;
    }
    await supabase.from('inventory_logs').insert({
      product_id: ins.id,
      change_amount: p.stock,
      previous_stock: 0,
      new_stock: p.stock,
      reason: 'bigarena_import',
    });
    inserted++;
    stockChanges++;
    continue;
  }

  // Update
  const patch = {};
  if (existing.name !== p.name) patch.name = p.name;
  if ((existing.barcode || null) !== (p.barcode || null)) patch.barcode = p.barcode;
  // Stock-over-10 also forces is_active=true.
  if (isOverTen && !existing.is_active) patch.is_active = true;
  // Always update stock to xlsx value (system of truth for what BigArena has).
  if (existing.stock_quantity !== p.stock) patch.stock_quantity = p.stock;

  if (Object.keys(patch).length === 0) {
    skipped++;
    continue;
  }
  const { error } = await supabase.from('products').update(patch).eq('id', existing.id);
  if (error) {
    failures.push({ sku: p.sku, error: error.message });
    continue;
  }
  if ('stock_quantity' in patch) {
    await supabase.from('inventory_logs').insert({
      product_id: existing.id,
      change_amount: p.stock - existing.stock_quantity,
      previous_stock: existing.stock_quantity,
      new_stock: p.stock,
      reason: 'bigarena_import',
    });
    stockChanges++;
  }
  updated++;
}

console.log('──────────────────────────────────────────────');
console.log(`✅ Inserted:      ${inserted}`);
console.log(`✅ Updated:       ${updated}`);
console.log(`⏭  No changes:    ${skipped}`);
console.log(`📦 Stock writes:  ${stockChanges}  (logged to inventory_logs)`);
if (failures.length > 0) {
  console.log(`❌ Failures:      ${failures.length}`);
  for (const f of failures) console.log(`     ${f.sku}: ${f.error}`);
}
