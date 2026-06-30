#!/usr/bin/env node
// Read-only: dump BigArena xlsx (name / SKU / barcode / stock) + current DB products.
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';

const file = readdirSync('.').find(f => /^Bigarena.*\.xlsx$/i.test(f));
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

function parseSkuBarcode(cell) {
  if (cell == null) return { sku: null, barcode: null };
  const m = String(cell).match(/SKU:\s*(\S+?)\s*Баркод:\s*(\S+)/);
  return m ? { sku: m[1].trim(), barcode: m[2].trim() } : { sku: null, barcode: null };
}
function parseFreeStock(cell) {
  if (cell == null) return null;
  const m = String(cell).match(/Свободна наличност:\s*(-?\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

console.log(`SOURCE FILE: ${file}\n`);
console.log('=== BIGARENA XLSX ROWS ===');
console.log('NAME | RAW-SKU-CELL | parsedSKU | parsedBarcode | stock');
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  if (!r || !r[0]) continue;
  const name = String(r[0]).trim();
  const { sku, barcode } = parseSkuBarcode(r[1]);
  const stock = parseFreeStock(r[3]);
  console.log(`${name} || rawcell=[${r[1]}] || sku=${sku} || barcode=${barcode} || stock=${stock}`);
}

console.log('\n\n=== CURRENT DB PRODUCTS ===');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, barcode, stock_quantity, price, is_active')
    .order('name')
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
}
console.log('ID | SKU | NAME | BARCODE | STOCK | PRICE | ACTIVE');
for (const p of all) {
  console.log(`${p.id} | ${p.sku} | ${p.name} | ${p.barcode ?? '—'} | ${p.stock_quantity} | ${p.price} | ${p.is_active}`);
}
console.log(`\nTotal DB products: ${all.length}`);
