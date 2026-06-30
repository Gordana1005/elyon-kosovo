#!/usr/bin/env node
// Seed the Kosovo products table from the Natura Therapy catalogue export.
//
// Source: products-export-2026-06-11.xlsx (two sheets: "Has Price" + "Missing
// Price"), columns: "Product Name", "Price (EUR)". Same brand as Bulgaria, so the
// catalogue carries over; prices are EUR (Kosovo is euro-native). Missing prices
// are imported as 0 for the operator to fill in-app.
//
// Idempotent: matches existing rows by case-insensitive name and inserts only the
// missing ones. The DB trigger auto-generates a SKU on insert.
//
// Usage (Node 20.6+):
//   node --env-file=.env scripts/import-kosovo-catalog.mjs            # dry-run
//   node --env-file=.env scripts/import-kosovo-catalog.mjs --commit   # write
//   node --env-file=.env scripts/import-kosovo-catalog.mjs --file=PATH

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const fileArg = args.find(a => a.startsWith('--file='));
const xlsxPath = fileArg
  ? fileArg.slice('--file='.length)
  : (readdirSync('.').find(f => /^products-export-.*\.xlsx$/i.test(f)));

if (!xlsxPath) {
  console.error('No products-export-*.xlsx found at cwd. Pass --file=PATH.');
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Need VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env).');
  process.exit(1);
}

// ── Parse every sheet: [Product Name, Price (EUR)] ──
const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
const items = [];
for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 });
  for (const r of rows.slice(1)) {
    const name = (r[0] ?? '').toString().trim();
    if (!name || /^product name$/i.test(name)) continue;
    const priceRaw = (r[1] ?? '').toString().trim().replace(',', '.');
    const price = priceRaw === '' ? 0 : (Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : 0);
    items.push({ name, price });
  }
}
// De-dupe by normalized name within the file (first wins).
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const seen = new Set();
const catalogue = items.filter(i => (seen.has(norm(i.name)) ? false : seen.add(norm(i.name))));

console.log(`📋 Parsed ${catalogue.length} catalogue products from ${xlsxPath}`);
console.log(`   • ${catalogue.filter(i => i.price > 0).length} with price, ${catalogue.filter(i => !i.price).length} missing price`);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const { data: existing, error: exErr } = await supabase.from('products').select('id,name');
if (exErr) { console.error('Could not read products:', exErr.message); process.exit(1); }
const existingNorm = new Set((existing ?? []).map(p => norm(p.name)));

const toInsert = catalogue.filter(i => !existingNorm.has(norm(i.name)));
console.log(`   • ${existing?.length ?? 0} already in DB, ${toInsert.length} to insert`);

if (!COMMIT) {
  console.log('\n🌵 Dry run — re-run with --commit to write. Would insert:');
  toInsert.forEach(i => console.log(`   + ${i.name}  —  €${i.price.toFixed(2)}`));
  process.exit(0);
}

let ok = 0, fail = 0;
for (const i of toInsert) {
  const { error } = await supabase.from('products').insert({ name: i.name, price: i.price, is_active: true });
  if (error) { console.error(`   ✗ ${i.name}: ${error.message}`); fail++; } else { ok++; }
}
console.log(`\n✅ Inserted ${ok} products${fail ? `, ${fail} failed` : ''}.`);
