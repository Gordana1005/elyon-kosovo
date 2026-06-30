#!/usr/bin/env node
// Export products to Excel — two sheets:
//   Sheet 1: MISSING PRICE
//   Sheet 2: HAS PRICE
//
// Usage:  node --env-file=.env scripts/export-products-csv.mjs

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('name, cost_price')
    .order('name', { ascending: true })
    .range(from, from + 999);
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
}

const missing = all.filter(p => !p.cost_price || p.cost_price === 0);
const hasPrice = all.filter(p => p.cost_price && p.cost_price > 0);

const toRows = (products) =>
  products.map(p => ({ 'Product Name': p.name, 'Cost Price (EUR)': p.cost_price || '' }));

const wb = XLSX.utils.book_new();

const ws1 = XLSX.utils.json_to_sheet(toRows(missing));
ws1['!cols'] = [{ wch: 50 }, { wch: 20 }];
XLSX.utils.book_append_sheet(wb, ws1, `Missing Cost Price (${missing.length})`);

const ws2 = XLSX.utils.json_to_sheet(toRows(hasPrice));
ws2['!cols'] = [{ wch: 50 }, { wch: 20 }];
XLSX.utils.book_append_sheet(wb, ws2, `Has Cost Price (${hasPrice.length})`);

const date = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', 'h');
const outFile = `products-export-${date}.xlsx`;
XLSX.writeFile(wb, outFile);

console.log(`✅ Wrote ${outFile}`);
console.log(`   Missing cost price: ${missing.length} | Has cost price: ${hasPrice.length}`);
