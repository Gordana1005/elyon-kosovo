#!/usr/bin/env node
// FINAL SKU fix (2026-05-22): product.sku must be the internal panel SKU
// (NT0095, 000982, 005031 …), NOT the EAN barcode. The barcode column is left
// untouched. Stock is re-synced to the same panel to guarantee accuracy.
//
// Source of truth: "Bigarena Fulfillment.pdf" panel. Each entry below is keyed
// by the product's barcode (stable in our DB) → { sku, stock }.
//   - sku = the panel's "SKU:" value. `null` = the panel has NO sku for that
//     product (4 cases) → we keep the existing barcode as the sku.
//   - Колаген (…743) appears twice in the panel (000982 + NT0108, 1084 + 1029);
//     our single merged product keeps 000982 and stock 2113.
//
// Usage:  node --env-file=.env scripts/fix-skus-to-nt.mjs            # dry run
//         node --env-file=.env scripts/fix-skus-to-nt.mjs --commit   # write
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.slice(2).includes('--commit');

// barcode -> { sku, stock } from the panel PDF.
const PANEL = {
  '5310416001085': { sku: 'NT0135', stock: 1104 },  // A4 - antioxidant matrix
  '5319991983403': { sku: 'NT0069', stock: 158 },   // Aloe Vera 500ml
  '5310416000781': { sku: 'NT0109', stock: 361 },   // BCAA powder 200 gr.
  '5319991983618': { sku: 'NT0063', stock: 727 },   // Brain active (30cps)
  '5319991983137': { sku: 'NT0066', stock: 970 },   // Broncho Complex
  '5310416001016': { sku: 'NT0139', stock: 23 },    // C 1000
  '5310416000538': { sku: 'NT0136', stock: 70 },    // CALM
  '5319991983205': { sku: 'NT0128', stock: 734 },   // CHIA THERAPY - диня
  '5319991983700': { sku: 'NT0127', stock: 746 },   // CHIA THERAPY - ябълка
  '5310416000767': { sku: 'NT0103', stock: 1924 },  // CREATINE powder 200 gr.
  '5319991983601': { sku: 'NT0057', stock: 231 },   // Curcumactiv (500ml)
  '5310416000583': { sku: 'NT0100', stock: 482 },   // Diet shake chocolate 500g
  '5310416000576': { sku: 'NT0099', stock: 617 },   // Diet shake strawberry 500g
  '5310416000521': { sku: 'NT0101', stock: 758 },   // Diet shake vanilla 500g
  '5310416000187': { sku: '005031', stock: 213 },   // ELIXY DNEVNA & HYALURONIC +35
  '5310416000194': { sku: '005032', stock: 213 },   // ELIXY DNEVNA & HYALURONIC +45
  '5310416000200': { sku: '005033', stock: 21 },    // ELIXY DNEVNA & HYALURONIC +55
  '5319991983670': { sku: null,     stock: 33 },    // ELIXY Серум со 20%снаил  (no panel SKU)
  '5310416000118': { sku: null,     stock: 47 },    // ELIXY Серум со витамин Ц (no panel SKU)
  '5319991983663': { sku: '005037', stock: 69 },    // ELIXY-hyaluronic acid…
  '5319991983632': { sku: '005007', stock: 33 },    // ELIXY-Дневенкрем снаил 50ml
  '5319991983649': { sku: '005006', stock: 33 },    // ELIXY-Ноќен крем снаил 50ml
  'BF-2MZJMMXBDZ': { sku: null,     stock: 248 },   // ELIXY-Шампон Алое вера   (no panel SKU)
  '5310416001610': { sku: 'NT0143', stock: 2967 },  // Enduro Max 30 капсули
  '5319991983854': { sku: 'NT0134', stock: 14 },    // Femme 7
  '5310416000828': { sku: 'NT0137', stock: 1018 },  // Hemoro Forte
  '5319991983908': { sku: 'NT0094', stock: 985 },   // Hepatol
  '5310416001030': { sku: 'NT0141', stock: 113 },   // Hyaluron 5
  '5310416000378': { sku: 'NT0126', stock: 771 },   // IMMUNO BOOST - къпина
  '5310416000361': { sku: 'NT0125', stock: 751 },   // IMMUNO BOOST - портокал
  '5310416000774': { sku: 'NT0102', stock: 156 },   // L-GLUTAMINE powder 200 gr.
  '5310416000682': { sku: 'NT0140', stock: 10 },    // Osteo Fix (30cps)
  '5310416001597': { sku: 'NT0142', stock: 1953 },  // Prosta Flow 30 капсули
  '5319991983267': { sku: 'NT0098', stock: 26 },    // Reishi
  '5319991983748': { sku: 'NT0055', stock: 85 },    // SAW Palmetto
  '5319991983328': { sku: 'NT0053', stock: 1622 },  // SLIM Complex
  '5319991983373': { sku: 'NT0054', stock: 1598 },  // SLIM Fiber
  '5310416001603': { sku: 'NT0144', stock: 1999 },  // Slimrush 30 капсули
  '5319991983922': { sku: 'NT0097', stock: 35 },    // Tribulus
  '5310416000064': { sku: 'NT0095', stock: 2786 },  // Uro Protect
  '5319991983298': { sku: 'NT0002', stock: 1488 },  // Диабетол Форте
  '5310416000743': { sku: '000982', stock: 2113 },  // Колаген Пептид (1084 + 1029)
  '5319991983151': { sku: 'NT0025', stock: 2719 },  // Snail Complex (Комплекс от охлюви)
  '5310416001160': { sku: null,     stock: 846 },   // НЕВРО АКТИВ - 60капсули  (no panel SKU)
  '5319991983717': { sku: 'NT0004', stock: 280 },   // Простатол Комплекс
  '5310416000347': { sku: '000757', stock: 178 },   // ХОЛЕСТОЛ КОМПЛЕКС 30 cps
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

const skuChanges = [], stockChanges = [], keptBarcode = [], notInPanel = [];
for (const p of products) {
  const panel = PANEL[p.barcode];
  if (!panel) { notInPanel.push(p); continue; }
  const targetSku = panel.sku ?? p.barcode;          // keep barcode when panel has no sku
  if (panel.sku === null) keptBarcode.push(p);
  if (p.sku !== targetSku) skuChanges.push({ p, targetSku });
  if (p.stock_quantity !== panel.stock) stockChanges.push({ p, stock: panel.stock });
}

// Guard: target SKUs must stay unique.
const targets = products.map(p => { const pa = PANEL[p.barcode]; return pa ? (pa.sku ?? p.barcode) : p.sku; });
const dupTargets = targets.filter((x, i) => targets.indexOf(x) !== i);

console.log(`${COMMIT ? '✍️  COMMIT' : '🌵 DRY RUN'} — final SKU fix (sku = panel SKU, not barcode)\n`);
console.log('SKU CHANGES (barcode → panel SKU):');
for (const { p, targetSku } of skuChanges)
  console.log(`   ${p.name.slice(0, 42).padEnd(43)} ${String(p.sku).padEnd(16)} → ${targetSku}`);
console.log(`\nKEPT AS BARCODE (no SKU in panel) — ${keptBarcode.length}:`);
for (const p of keptBarcode) console.log(`   ${p.name.slice(0, 42).padEnd(43)} sku stays ${p.barcode}`);
console.log(`\nSTOCK CHANGES — ${stockChanges.length}:`);
for (const { p, stock } of stockChanges) console.log(`   ${p.name.slice(0, 42).padEnd(43)} ${p.stock_quantity} → ${stock}`);
if (notInPanel.length) { console.log('\n⚠ NOT IN PANEL:'); notInPanel.forEach(p => console.log(`   ${p.name} (barcode ${p.barcode})`)); }
if (dupTargets.length) { console.log('\n❌ DUPLICATE TARGET SKUs:', dupTargets); }

console.log(`\nSummary: ${skuChanges.length} sku changes, ${stockChanges.length} stock changes, ${keptBarcode.length} kept-as-barcode, ${notInPanel.length} not-in-panel, ${products.length} total products.`);

if (!COMMIT) { console.log('\nRe-run with --commit to write.'); process.exit(0); }
if (dupTargets.length) { console.error('\nAborting: duplicate target SKUs.'); process.exit(1); }

let ok = 0;
for (const p of products) {
  const panel = PANEL[p.barcode];
  if (!panel) continue;
  const patch = {};
  const targetSku = panel.sku ?? p.barcode;
  if (p.sku !== targetSku) patch.sku = targetSku;
  if (p.stock_quantity !== panel.stock) patch.stock_quantity = panel.stock;
  if (Object.keys(patch).length === 0) continue;
  const { error } = await supabase.from('products').update(patch).eq('id', p.id);
  if (error) { console.error(`✗ ${p.name}: ${error.message}`); continue; }
  ok++;
}
console.log(`\n✅ Updated ${ok} products.`);
