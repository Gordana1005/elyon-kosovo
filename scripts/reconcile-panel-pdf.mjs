#!/usr/bin/env node
// Reconcile our products against the FRESH BigArena panel PDF
// ("Panel (1)_c3ad82a8...") provided 2026-05-22. Verifies every barcode and
// re-syncs stock to the panel (the live warehouse truth). The earlier xlsx
// ("Panel_8be5f210...") was a stale snapshot — notably Prostatol showed 2
// there but is actually 280.
//
// Usage:  node --env-file=.env scripts/reconcile-panel-pdf.mjs            # dry run
//         node --env-file=.env scripts/reconcile-panel-pdf.mjs --commit   # write stock
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.slice(2).includes('--commit');

// barcode -> { name, stock } straight from the PDF panel. Колаген (…743)
// appears twice in the panel (1084 + 1029) → pre-summed to 2113, matching our
// single merged product.
const PANEL = {
  '5310416001610': ['Enduro Max 30 капсули', 2967],
  '5310416000064': ['Uro Protect', 2786],
  '5319991983151': ['Snail Complex (Комплекс от охлюви)', 2719],
  '5310416001603': ['Slimrush 30 капсули', 1999],
  '5310416001597': ['Prosta Flow 30 капсули', 1953],
  '5310416000767': ['CREATINE powder 200 gr.', 1924],
  '5319991983328': ['SLIM Complex', 1622],
  '5319991983373': ['SLIM Fiber', 1598],
  '5319991983298': ['Диабетол Форте', 1488],
  '5310416001085': ['A4 - antioxidant matrix', 1104],
  '5310416000743': ['Колаген Пептид со ВАНИЛА 200 гр', 2113], // 1084 + 1029
  '5310416000828': ['Hemoro Forte', 1018],
  '5319991983908': ['Hepatol', 985],
  '5319991983137': ['Broncho Complex', 970],
  '5310416001160': ['НЕВРО АКТИВ - 60капсули', 846],
  '5310416000378': ['IMMUNO BOOST - къпина', 771],
  '5310416000521': ['Diet shake vanilla 500g', 758],
  '5310416000361': ['IMMUNO BOOST - портокал', 751],
  '5319991983700': ['CHIA THERAPY - ябълка', 746],
  '5319991983205': ['CHIA THERAPY - диня', 734],
  '5319991983618': ['Brain active (30cps)', 727],
  '5310416000576': ['Diet shake strawberry 500g', 617],
  '5310416000583': ['Diet shake chocolate 500g', 482],
  '5310416000781': ['BCAA powder 200 gr.', 361],
  '5319991983717': ['Простатол Комплекс', 280],
  'BF-2MZJMMXBDZ': ['ELIXY-Шампон Алое вера 500 мл.', 248],
  '5319991983601': ['Curcumactiv (500ml)', 231],
  '5310416000187': ['ELIXY DNEVNA & HYALURONIC +35', 213],
  '5310416000194': ['ELIXY DNEVNA & HYALURONIC +45', 213],
  '5310416000347': ['ХОЛЕСТОЛ КОМПЛЕКС 30 cps', 178],
  '5319991983403': ['Aloe Vera 500ml', 158],
  '5310416000774': ['L-GLUTAMINE powder 200 gr.', 156],
  '5310416001030': ['Hyaluron 5', 113],
  '5319991983748': ['SAW Palmetto', 85],
  '5310416000538': ['CALM', 70],
  '5319991983663': ['ELIXY-hyaluronic acid-collagen&aloe vera', 69],
  '5310416000118': ['ELIXY Серум со витамин Ц', 47],
  '5319991983922': ['Tribulus', 35],
  '5319991983649': ['ELIXY-Ноќен крем снаил 50ml', 33],
  '5319991983632': ['ELIXY-Дневенкрем снаил 50ml', 33],
  '5319991983670': ['ELIXY Серум со 20%снаил екстракт', 33],
  '5319991983267': ['Reishi', 26],
  '5310416001016': ['C 1000', 23],
  '5310416000200': ['ELIXY DNEVNA & HYALURONIC +55', 21],
  '5319991983854': ['Femme 7', 14],
  '5310416000682': ['Osteo Fix (30cps)', 10],
};

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const products = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products').select('id, sku, name, barcode, stock_quantity').order('name').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  products.push(...data);
  if (data.length < 1000) break;
}

const changes = [], same = [], barcodeProblems = [], skuProblems = [];
const matchedBarcodes = new Set();
for (const p of products) {
  if (p.sku !== p.barcode) skuProblems.push(`${p.name}: sku=${p.sku} barcode=${p.barcode}`);
  const panel = PANEL[p.barcode];
  if (!panel) { barcodeProblems.push(`${p.name}: barcode ${p.barcode} NOT found in panel PDF`); continue; }
  matchedBarcodes.add(p.barcode);
  const [, panelStock] = panel;
  if (panelStock !== p.stock_quantity) changes.push({ p, panelStock });
  else same.push(p);
}

console.log(`${COMMIT ? '✍️  COMMIT' : '🌵 DRY RUN'} — reconcile vs fresh panel PDF\n`);
console.log(`✅ Barcodes: ${matchedBarcodes.size}/${products.length} confirmed in panel; ${barcodeProblems.length} problem(s); ${skuProblems.length} sku≠barcode`);
console.log(`📦 Stock: ${changes.length} to update, ${same.length} already correct\n`);

console.log('STOCK CHANGES (DB → panel):');
for (const { p, panelStock } of changes.sort((a, b) => Math.abs(b.panelStock - b.p.stock_quantity) - Math.abs(a.panelStock - a.p.stock_quantity))) {
  const d = panelStock - p.stock_quantity;
  console.log(`   ${p.name.slice(0, 42).padEnd(43)} ${String(p.stock_quantity).padStart(5)} → ${String(panelStock).padStart(5)}  (${d > 0 ? '+' : ''}${d})`);
}
if (barcodeProblems.length) { console.log('\n⚠ BARCODE PROBLEMS:'); barcodeProblems.forEach(x => console.log('   ' + x)); }
if (skuProblems.length) { console.log('\n⚠ SKU≠BARCODE:'); skuProblems.forEach(x => console.log('   ' + x)); }

if (!COMMIT) { console.log('\nRe-run with --commit to write stock.'); process.exit(0); }

let ok = 0;
for (const { p, panelStock } of changes) {
  const { error } = await supabase.from('products').update({ stock_quantity: panelStock }).eq('id', p.id);
  if (error) { console.error(`✗ ${p.name}: ${error.message}`); continue; }
  ok++;
}
console.log(`\n✅ Updated stock on ${ok}/${changes.length} products.`);
