// ⛔ SUPERSEDED 2026-08-04 — use scripts/import-costs-from-bg.mjs instead.
//
// This script carries costs hand-transcribed from a spreadsheet, and several of
// them now disagree with the live Bulgarian catalogue that MK costs are sourced
// from (Curcumactiv 4.23 here vs 6.30 there; Saw Palmetto 1.27 vs 1.60; Matcha
// Collagen 5.23 vs no recorded cost at all). Eight of its pairings are also only
// marked 'likely'. Running it would silently overwrite the imported figures with
// older, less reliable ones.
//
// Kept for provenance — it records where the 2026 spreadsheet numbers came from.
// It also predates the Macedonian fork's safety rules: it has no tripwire, so it
// writes to whatever project VITE_SUPABASE_URL happens to point at.
//
// Load Natura Therapy "original" (cost) prices into products.cost_price.
// Matching is by an explicit map (CRM names are partly Cyrillic / renamed).
// Dry-run by default — prints the plan. Pass --commit to write.
//
//   node --env-file=.env scripts/import-natura-costs.mjs
//   node --env-file=.env scripts/import-natura-costs.mjs --commit

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
if (COMMIT) {
  console.error('\x1b[31mSuperseded — this would overwrite live costs with stale spreadsheet values.\x1b[0m');
  console.error('Use: node scripts/import-costs-from-bg.mjs --commit');
  process.exit(1);
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// sheet product → { crm: <exact CRM product name>, cost, confidence }
// cost = the "New Price" column (reduced for the listed 21, original otherwise,
// as-given for the 3 extras). confidence: 'sure' | 'likely'.
const MAP = [
  // ✅ confident
  ['Neuro Active', 'НЕВРО АКТИВ - 60капсули', 2.71, 'sure'],
  ['Uro Protect', 'Uro Protect', 2.48, 'sure'],
  ['Diabetol Forte', 'Диабетол Форте', 2.34, 'sure'],
  ['Brain Active', 'Brain active (30cps)', 2.85, 'sure'],
  ['Prostatol Complex', 'Простатол Комплекс', 1.98, 'sure'],
  ['Curcumactive', 'Curcumactiv (500ml)', 4.23, 'sure'],
  ['Elixy Face Cream Night', 'ELIXY-Ноќен крем снаил 50ml', 3.47, 'sure'],
  ['Elixy Face Cream Day', 'ELIXY-Дневенкрем снаил 50ml', 3.81, 'sure'],
  ['Saw Palmeto', 'SAW Palmetto', 1.27, 'sure'],
  ['Calm', 'CALM', 3.73, 'sure'],
  ['Hyaluron 5', 'Hyaluron 5', 4.36, 'sure'],
  ['Immuno Boost (Blackberry/Lemon/Lime)', 'IMMUNO BOOST - с вкус на къпина, лимон и лайм', 0.85, 'sure'],
  ['Immuno Boost (Orange/Pineapple)', 'IMMUNO BOOST - с вкус на портокал и ананас', 0.85, 'sure'],
  ['Chia Therapy (Apple)', 'CHIA THERAPY - с вкус на ябълка', 0.85, 'sure'],
  ['Chia Therapy (Melon)', 'CHIA THERAPY - с вкус на диня', 0.85, 'sure'],
  ['Diet Shake (Vanilla)', 'Diet shake vanilla  500g', 7.50, 'sure'],
  ['Diet Shake (Chocolate)', 'Diet shake chocolate 500g', 7.50, 'sure'],
  ['Diet Shake (Strawberry)', 'Diet shake strawberry  500g', 7.50, 'sure'],
  ['BCAA Powder', 'BCAA powder 200 gr.', 6.26, 'sure'],
  ['Elixy Shampoo (Aloe Vera)', 'ELIXY-Шампон Алое вера 500 мл.', 6.40, 'sure'],
  ['Elixy Face Serum Vitamin C', 'ELIXY Серум со витамин Ц', 2.00, 'sure'],
  ['Aloe Vera (500 ml)', 'Aloe Vera 500ml', 1.99, 'sure'],
  ['Slim Rush', 'Slimrush 30 капсули', 1.60, 'sure'],
  ['Prostaflow', 'Prosta Flow 30 капсули', 1.55, 'sure'],
  // ⚠️ likely — please confirm these name pairings
  ['Hepatol Forte', 'Hepatol', 1.34, 'likely'],
  ['Broncho Protect', 'Broncho Complex', 1.97, 'likely'],
  ['Femme', 'Femme 7', 6.50, 'likely'],
  ['DR. SLIM (90 capsules)', 'SLIM Complex', 3.40, 'likely'],
  ['DR. SLIM Powder (210 g)', 'SLIM Fiber', 5.36, 'likely'],
  ['Matcha Collagen', 'Колаген Пептид со ВАНИЛА 200 гр', 5.23, 'likely'],
  ['Elixy Face Serum Hyaluronic & Aloe', 'ELIXY-hyaluronic acid-collagen&aloe vera', 1.00, 'likely'],
  ['Enduro', 'Enduro Max 30 капсули', 1.80, 'likely'],
];

// Sheet products with a price that have NO CRM equivalent (won't be set).
const NO_CRM_MATCH = [
  'Extract Ashwagandha (2.57)', 'Turmeric 425ml (3.65)', 'Liver Detox (5.93)',
  'Vitamin D3 (1.72)', 'Zink (3.56)', 'Magnesium Citrat (2.89)', 'Melatonin (1.86)',
  'Vitamin B6 (2.04)', 'Nutri Shake Chocolate (4.86)', 'Nutri Shake Strawberry (3.41)',
];

const { data: products } = await sb.from('products').select('id,name,cost_price,is_active');
const byName = new Map(products.map(p => [p.name, p]));

const ok = [], missing = [];
for (const [sheet, crm, cost, conf] of MAP) {
  const p = byName.get(crm);
  if (p) ok.push({ sheet, crm, cost, conf, id: p.id });
  else missing.push({ sheet, crm, cost });
}

console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}  ·  ${products.length} CRM products\n`);
console.log('=== WILL SET cost_price (' + ok.length + ') ===');
for (const r of ok) console.log(`  ${r.conf === 'sure' ? '✅' : '⚠️ '} €${r.cost.toFixed(2).padStart(5)}  ${r.crm}   (sheet: ${r.sheet})`);

if (missing.length) {
  console.log('\n=== MAP names not found in CRM (fix the map) ===');
  for (const r of missing) console.log(`  ❓ ${r.crm}  (sheet: ${r.sheet})`);
}

console.log('\n=== Sheet products with a price but NO CRM product ===');
for (const n of NO_CRM_MATCH) console.log('  ✗ ' + n);

const matchedNames = new Set(ok.map(r => r.crm));
const crmNoCost = products.filter(p => !matchedNames.has(p.name));
console.log('\n=== CRM products left WITHOUT a cost (' + crmNoCost.length + ') ===');
for (const p of crmNoCost) console.log('  · ' + p.name);

if (!COMMIT) {
  console.log('\nDry-run only. Re-run with --commit to write the ✅/⚠️ costs above.');
  process.exit(0);
}

let n = 0;
for (const r of ok) {
  const { error } = await sb.from('products').update({ cost_price: r.cost }).eq('id', r.id);
  if (error) { console.error('Failed', r.crm, error.message); continue; }
  n++;
}
console.log(`\nDone — cost_price set on ${n} products.`);
