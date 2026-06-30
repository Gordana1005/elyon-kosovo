// One-off: take the factory price sheet (NaturaTherapy), reduce every price by
// 33%, and emit (a) a console table and (b) a branded PDF mirroring the
// original so the operator can compare. Not part of the app.
//
//   node scripts/gen-natura-prices.mjs
//
// Output: NaturaTherapy_prices_minus33.pdf + .html at repo root.

import { writeFileSync } from 'node:fs';

const DISCOUNT = 0.33; // 33% off
const minus33 = (p) => p == null ? null : Math.round((p * (1 - DISCOUNT) + Number.EPSILON) * 100) / 100;

// Factory prices straight from the PDF (the "Stock" column = price). null = blank in sheet.
const FROM_SHEET = [
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

// Extras the operator supplied (not in the sheet). These are ALREADY −33%
// (final original price) — used as-is, no further discount.
const EXTRAS = [
  ['Enduro', 1.80],
  ['Slim Rush', 1.60],
  ['Prostaflow', 1.55],
];

const rows = [
  ...FROM_SHEET.map(([name, factory]) => ({ name, factory, discounted: minus33(factory), net: false })),
  ...EXTRAS.map(([name, price]) => ({ name, factory: null, discounted: price, net: true })),
];

// ── Console table ──
const fmt = (n) => n == null ? '—' : n.toFixed(2);
console.log('\nProduct'.padEnd(56) + 'Factory'.padStart(10) + '   -33%');
console.log('─'.repeat(80));
for (const r of rows) {
  console.log(r.name.padEnd(56) + fmt(r.factory).padStart(10) + '   ' + fmt(r.discounted));
}
const priced = rows.filter(r => r.factory != null);
console.log('─'.repeat(80));
console.log(`${rows.length} products · ${priced.length} priced · ${rows.length - priced.length} without a factory price in the sheet`);

// ── Branded HTML (mirrors the Natura Therapy sheet) ──
const GREEN = '#3f8e7d';
const body = rows.map(r => `
  <tr>
    <td class="prod">${r.name}${r.net ? ' <span class="tag">already &minus;33%</span>' : ''}</td>
    <td class="orig">${r.factory == null ? (r.net ? '—' : '<span class="blank">no factory price</span>') : '€' + r.factory.toFixed(2)}</td>
    <td class="new">${r.discounted == null ? '—' : '€' + r.discounted.toFixed(2)}</td>
  </tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #2b3a3a; margin: 0; }
  .head { display:flex; align-items:center; justify-content:space-between; background:${GREEN}; color:#fff; padding:18px 22px; border-radius:8px 8px 0 0; }
  .head h1 { margin:0; font-size:26px; letter-spacing:.5px; }
  .head .sub { font-size:12px; opacity:.9; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  thead th { background:#eef5f3; color:${GREEN}; text-align:left; padding:9px 12px; border-bottom:2px solid ${GREEN}; font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
  thead th.num { text-align:right; }
  tbody td { padding:8px 12px; border-bottom:1px solid #e7efed; }
  td.orig, td.new { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.orig { color:#8a9a98; }
  td.new { color:${GREEN}; font-weight:700; }
  td.prod { font-weight:600; }
  .blank { color:#c0cbc9; font-style:italic; font-weight:400; font-size:11px; }
  .tag { display:inline-block; background:#eef5f3; color:${GREEN}; font-size:9px; padding:1px 5px; border-radius:4px; vertical-align:middle; }
  tr:nth-child(even) td { background:#fafcfb; }
  .foot { text-align:center; color:#9fb0ae; font-size:11px; margin-top:14px; }
</style></head><body>
  <div class="head"><h1>Natura Therapy — Original Prices</h1><div class="sub">Factory price &minus;33% · generated ${new Date().toISOString().slice(0,10)}</div></div>
  <table>
    <thead><tr><th>Product</th><th class="num">Factory price</th><th class="num">Original price (&minus;33%)</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">${rows.length} products · ${priced.length} priced · the &minus;33% column is the cost price to load into the CRM</div>
</body></html>`;

writeFileSync('NaturaTherapy_prices_minus33.html', html);
console.log('\nWrote NaturaTherapy_prices_minus33.html');

// ── Render to PDF via Playwright's chromium (best-effort) ──
try {
  const mod = await import('playwright').catch(() => import('@playwright/test'));
  const chromium = mod.chromium;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: 'NaturaTherapy_prices_minus33.pdf', format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await browser.close();
  console.log('Wrote NaturaTherapy_prices_minus33.pdf');
} catch (e) {
  console.log('PDF render skipped (' + (e?.message?.split('\n')[0] || e) + ') — open the .html and Print → Save as PDF.');
}
