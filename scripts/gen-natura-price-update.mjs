// Full catalogue price sheet: every product, with Old Price and New Price.
// Only the listed products get a reduced new price; all others keep their
// original price (Old = New). No percentage / discount wording anywhere.
//
//   node scripts/gen-natura-price-update.mjs
//
// Output: NaturaTherapy_PriceUpdate.pdf + .html at repo root.

import { writeFileSync } from 'node:fs';

const cut = (p) => Math.round((p * 0.67 + Number.EPSILON) * 100) / 100;

// Full catalogue from the factory sheet. null = no price in the sheet.
const CATALOGUE = [
  ['Creatine Powder 200 gr.', null],
  ['100% Whey Protein Chocolate Flavor (2000 g)', null],
  ['Extract Ashwagandha (60 capsules)', 3.84],
  ['Femme (60 capsules)', 6.50],
  ['Neuro Active (60 capsules)', 4.04],
  ['DR. SLIM (90 capsules)', 3.40],
  ['DR. SLIM Powder (210 g)', 5.36],
  ['Matcha Collagen (175 g)', 7.80],
  ['Sambucus Nigra (250 ml)', null],
  ['Turmeric (425 ml)', 5.45],
  ['Liver Detox (90 capsules)', 8.85],
  ['Vitamin D3 (365 tablets)', 2.56],
  ['Zink (365 tablets)', 5.31],
  ['Magnesium Citrat (150 tablets)', 4.32],
  ['Melatonin (365 tablets)', 2.78],
  ['Vitamin B6 (365 tablets)', 3.04],
  ['Uro Protect (30 capsules)', 3.70],
  ['Diabetol Forte (30 capsules)', 3.50],
  ['Hepatol Forte (30 capsules)', 2.00],
  ['Broncho Protect (500 ml)', 2.94],
  ['Immuno Boost (Blackberry, Lemon & Lime 500 ml)', 0.85],
  ['Immuno Boost (Orange & Pineapple 500 ml)', 0.85],
  ['Chia Therapy (Apple 500 ml)', 0.85],
  ['Chia Therapy (Melon 500 ml)', 0.85],
  ['Brain Active (30 capsules)', 4.25],
  ['Turmeric Boost (500 ml)', null],
  ['Diet Shake (Vanilla 500g)', 7.50],
  ['Diet Shake (Chocolate 500g)', 7.50],
  ['Diet Shake (Strawberry 500g)', 7.50],
  ['BCAA Powder (200g)', 6.26],
  ['Prostatol Complex (30 capsules)', 2.95],
  ['Amino Energy (Blueberry Lemonade 500 ml)', null],
  ['Elixy Shampoo (Aloe Vera 500 ml)', 6.40],
  ['Curcumactive (500 ml)', 6.31],
  ['Elixy Face Cream 45+ Hyaluronic Acid & Aloe Vera (50ml)', null],
  ['Elixy Face Cream 35+ Hyaluronic Acid & Aloe Vera (50ml)', null],
  ['Elixy Face Cream 55+ Hyaluronic Acid & Aloe Vera (50ml)', null],
  ['Elixy Face Cream (Night 50ml)', 5.18],
  ['Elixy Face Cream (Day 50ml)', 5.68],
  ['Nutri Shake (Chocolate 500g)', 7.26],
  ['Nutri Shake (Strawberry 500g)', 5.09],
  ['Cholestol Complex (30 capsules)', null],
  ['L-Glutamine Powder (200g)', null],
  ['Saw Palmeto (30 capsules)', 1.90],
  ['Calm (30 capsules)', 5.57],
  ['Elixy Face Serum Hyaluronic Acid & Aloe Vera', 1.00],
  ['Elixy Face Serum Vitamin C', 2.00],
  ['C 1000 (60 capsules)', null],
  ['Reishi Extract', null],
  ['Hyaluron 5', 6.50],
  ['Tribulus Terrestris (60 capsules)', null],
  ['Aloe Vera (500 ml)', 1.99],
];

// Already at their final price (supplied separately) — Old = none, New = value.
const ALREADY_FINAL = [
  ['Enduro', 1.80],
  ['Slim Rush', 1.60],
  ['Prostaflow', 1.55],
];

// Only these get a reduced New Price; everything else keeps its price.
const DISCOUNT = new Set([
  'Extract Ashwagandha (60 capsules)',
  'Neuro Active (60 capsules)',
  'Matcha Collagen (175 g)',
  'Turmeric (425 ml)',
  'Vitamin D3 (365 tablets)',
  'Zink (365 tablets)',
  'Magnesium Citrat (150 tablets)',
  'Melatonin (365 tablets)',
  'Vitamin B6 (365 tablets)',
  'Uro Protect (30 capsules)',
  'Diabetol Forte (30 capsules)',
  'Hepatol Forte (30 capsules)',
  'Broncho Protect (500 ml)',
  'Brain Active (30 capsules)',
  'Prostatol Complex (30 capsules)',
  'Curcumactive (500 ml)',
  'Elixy Face Cream (Night 50ml)',
  'Elixy Face Cream (Day 50ml)',
  'Saw Palmeto (30 capsules)',
  'Calm (30 capsules)',
  'Hyaluron 5',
]);

const rows = [
  ...CATALOGUE.map(([name, price]) => {
    if (price == null) return { name, oldP: null, newP: null, changed: false };
    if (DISCOUNT.has(name)) return { name, oldP: price, newP: cut(price), changed: true };
    return { name, oldP: price, newP: price, changed: false }; // unchanged
  }),
  ...ALREADY_FINAL.map(([name, p]) => ({ name, oldP: null, newP: p, changed: false })),
];

// ── Console ──
const m = (v) => v == null ? '—' : v.toFixed(2);
console.log('\nProduct'.padEnd(58) + 'Old'.padStart(8) + '   New');
console.log('─'.repeat(76));
for (const r of rows) console.log(r.name.padEnd(58) + m(r.oldP).padStart(8) + '   ' + m(r.newP) + (r.changed ? '  *' : ''));
console.log('─'.repeat(76));
console.log(`${rows.length} products · ${rows.filter(r => r.changed).length} repriced (*)`);

// ── Branded HTML (no percentage / discount wording) ──
const GREEN = '#3f8e7d';
const body = rows.map(r => `
  <tr>
    <td class="prod">${r.name}</td>
    <td class="old ${r.changed ? 'cut' : ''}">${r.oldP == null ? '<span class="dash">—</span>' : '€' + r.oldP.toFixed(2)}</td>
    <td class="new ${r.changed ? 'hl' : ''}">${r.newP == null ? '<span class="dash">—</span>' : '€' + r.newP.toFixed(2)}</td>
  </tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#2b3a3a; margin:0; }
  .head { display:flex; align-items:center; justify-content:space-between; background:${GREEN}; color:#fff; padding:16px 22px; border-radius:8px 8px 0 0; }
  .head h1 { margin:0; font-size:24px; letter-spacing:.5px; }
  .head .sub { font-size:12px; opacity:.9; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  thead th { background:#eef5f3; color:${GREEN}; text-align:left; padding:9px 12px; border-bottom:2px solid ${GREEN}; font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
  thead th.num { text-align:right; }
  tbody td { padding:7px 12px; border-bottom:1px solid #e7efed; }
  td.old, td.new { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.old { color:#5b6b69; }
  td.old.cut { color:#a2afad; text-decoration:line-through; }
  td.new { color:#2b3a3a; }
  td.new.hl { color:${GREEN}; font-weight:700; }
  td.prod { font-weight:600; }
  .dash { color:#c0cbc9; text-decoration:none; }
  tr:nth-child(even) td { background:#fafcfb; }
  .foot { text-align:center; color:#9fb0ae; font-size:11px; margin-top:12px; }
</style></head><body>
  <div class="head"><h1>Natura Therapy — Prices</h1><div class="sub">${new Date().toISOString().slice(0,10)}</div></div>
  <table>
    <thead><tr><th>Product</th><th class="num">Old Price</th><th class="num">New Price</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">${rows.length} products</div>
</body></html>`;

writeFileSync('NaturaTherapy_PriceUpdate.html', html);
console.log('\nWrote NaturaTherapy_PriceUpdate.html');

try {
  const mod = await import('playwright').catch(() => import('@playwright/test'));
  const browser = await mod.chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: 'NaturaTherapy_PriceUpdate.pdf', format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  await browser.close();
  console.log('Wrote NaturaTherapy_PriceUpdate.pdf');
} catch (e) {
  console.log('PDF render skipped (' + (e?.message?.split('\n')[0] || e) + ') — open the .html and Print → Save as PDF.');
}
