// Store the Natura Therapy WEBSITE retail price into products.price.
// This becomes the agent's default per-unit price (editable down for discounts;
// cost stays admin-only). Matching by explicit CRM-name map.
// Dry-run by default; --commit to write.
//
//   node --env-file=.env scripts/import-natura-retail.mjs
//   node --env-file=.env scripts/import-natura-retail.mjs --commit

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// CRM product name → website retail price (€). Regular price where a sale exists.
const RETAIL = [
  ['Простатол Комплекс', 39.90],
  ['Диабетол Форте', 39.90],
  ['Uro Protect', 39.90],
  ['Broncho Complex', 39.90],
  ['Brain active (30cps)', 39.90],
  ['Hemoro Forte', 39.90],
  ['Enduro Max 30 капсули', 39.90],
  ['ХОЛЕСТОЛ КОМПЛЕКС 30 cps', 39.90],
  ['Колаген Пептид со ВАНИЛА 200 гр', 39.90],
  ['Diet shake chocolate 500g', 39.90],
  ['Diet shake strawberry  500g', 39.90],
  ['Diet shake vanilla  500g', 39.90],
  ['Curcumactiv (500ml)', 29.90],
  ['Комплекс от охлюви (30cps)', 29.90],
  ['A4 - antioxidant matrix', 29.90],
  ['ELIXY-hyaluronic acid-collagen&aloe vera', 29.90],
  ['НЕВРО АКТИВ - 60капсули', 29.90], // online sale 20.90 / regular 29.90
  ['CALM', 24.90],
  ['Hyaluron 5', 24.90],
  ['Hepatol', 24.90],
  ['Femme 7', 20.90],
  ['OSTEOfix', 14.90],
  ['ELIXY-Дневенкрем снаил 50ml', 14.90],
  ['ELIXY-Ноќен крем снаил 50ml', 14.90],
  ['ELIXY Серум со витамин Ц', 14.90],
  ['ELIXY Серум со 20%снаил екстракт', 14.90],
  ['BCAA powder 200 gr.', 12.90],
  ['CREATINE powder 200 gr.', 12.90],
  ['L-GLUTAMINE powder 200 gr.', 12.90],
  ['Aloe Vera 500ml', 12.90], // website "Алое и Арония" — verify it's the same
  ['SAW Palmetto', 9.90],
  ['C 1000', 9.90],
  ['Reishi', 6.90],
  ['Tribulus', 6.90],
  ['CHIA THERAPY - с вкус на диня', 2.00],
  ['CHIA THERAPY - с вкус на ябълка', 2.00],
  ['IMMUNO BOOST - с вкус на къпина, лимон и лайм', 2.00],
  ['IMMUNO BOOST - с вкус на портокал и ананас', 2.00],
];

// No clear website single → left unset (price stays / falls back to €15 floor):
//   ELIXY DNEVNA & HYALURONIC +35/+45/+55, ELIXY-Шампон Алое вера,
//   Prosta Flow, SLIM Complex, SLIM Fiber, Slimrush.

const { data: products } = await sb.from('products').select('id,name,price');
const byName = new Map(products.map(p => [p.name, p]));

const ok = [], missing = [];
for (const [name, retail] of RETAIL) {
  const p = byName.get(name);
  if (p) ok.push({ name, retail, id: p.id });
  else missing.push(name);
}

console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);
console.log('=== WILL SET price = website retail (' + ok.length + ') ===');
for (const r of ok) console.log('  €' + r.retail.toFixed(2).padStart(6) + '  ' + r.name);
if (missing.length) {
  console.log('\n=== map names not found (fix map) ===');
  for (const n of missing) console.log('  ❓ ' + n);
}
const setNames = new Set(ok.map(r => r.name));
console.log('\n=== products left WITHOUT retail (default → €15 / cost×3) ===');
for (const p of products) if (!setNames.has(p.name)) console.log('  · ' + p.name);

if (!COMMIT) { console.log('\nDry-run. Re-run with --commit to write.'); process.exit(0); }

let n = 0;
for (const r of ok) {
  const { error } = await sb.from('products').update({ price: r.retail }).eq('id', r.id);
  if (error) { console.error('Failed', r.name, error.message); continue; }
  n++;
}
console.log(`\nDone — website retail set on ${n} products.`);
