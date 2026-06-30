#!/usr/bin/env node
// Bulk-imports the CPA + INBOUND sheet from "IN,CPA and OUT.xlsx" as orders.
//
// Usage (requires Node 20.6+; you have v22, so --env-file works natively):
//   node --env-file=.env scripts/import-cpa-xlsx.mjs                 (dry-run; no DB writes)
//   node --env-file=.env scripts/import-cpa-xlsx.mjs --commit        (actually insert)
//   node --env-file=.env scripts/import-cpa-xlsx.mjs --commit --limit 50  (try a slice first)
//
// Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL in .env at project root.
//
// Imports:
//   - 10 canonical products with Latin names (Prostatol, Diabetol, Curcumactiv,
//     Brain, Snail, Collagen, Enduro, Aloe, Broncho, Palmetto)
//   - Orders with status mapped from Bulgarian, prices converted LEV → EUR using
//     the official BNB peg 1 EUR = 1.95583 BGN
//   - One order_items row per order so the OrderModal opens cleanly
//
// Idempotency: this script does NOT check for existing rows. Re-running it will
// create duplicates. Run with --dry-run first; if anything goes wrong on
// --commit, look at the inserted display_ids printed at the end to delete them.

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('--commit requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env scripts/import-cpa-xlsx.mjs --commit');
  process.exit(1);
}
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx >= 0 ? Number(args[idx + 1]) : null;
})();
const FILE_PATH = process.env.CPA_XLSX_PATH || 'IN,CPA and OUT.xlsx';

console.log('═'.repeat(80));
console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will insert into DB)'}`);
console.log(`File: ${FILE_PATH}`);
if (LIMIT) console.log(`Limit: first ${LIMIT} orders only`);
console.log('═'.repeat(80));

// ── Bulgarian Lev → Euro fixed peg (Bulgarian National Bank) ──
const BGN_PER_EUR = 1.95583;
const levToEur = (lev) => Math.round((lev / BGN_PER_EUR) * 100) / 100;

// ── Status mapping (Bulgarian → order_status enum) ──
const STATUS_MAP = {
  'платено': 'paid',
  'плътено': 'paid',
  'платена': 'paid',
  'платуно': 'paid',
  'платево': 'paid',
  'пратено': 'shipped',
  'не пратено': 'pending',
  'непратено': 'pending',
  'вратено': 'returned',
  'въртнато': 'returned',
  'върнато': 'returned',
  'върната': 'returned',
  'вратена': 'returned',
  'откажано': 'cancelled',
  'отказано': 'cancelled',
  'отказана': 'cancelled',
  'отказа': 'cancelled',
  'отказана поръчка': 'cancelled',
  'анулирана': 'cancelled',
  'отказва се': 'cancelled',
  'отказана пратка': 'cancelled',
  'prepared': 'pending',
  '-': 'pending',
};

function normalizeStatus(s) {
  if (!s) return 'pending';
  const lower = String(s).trim().toLowerCase();
  if (STATUS_MAP[lower]) return STATUS_MAP[lower];
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    if (lower.includes(k)) return v;
  }
  return 'pending'; // unmapped → pending so it can be triaged in the CRM
}

// ── Bulgarian → Latin: brand-aware ──
const BRAND_OVERRIDES = [
  ['простатол',     'Prostatol'],
  ['диабетол',      'Diabetol'],
  ['куркумактив',   'Curcumactiv'],
  ['брейн',         'Brain'],
  ['снейл',         'Snail'],
  ['снеил',         'Snail'],
  ['колаген',       'Collagen'],
  ['ендуро',        'Enduro'],
  ['алое',          'Aloe'],
  ['бронхо',        'Broncho'],
  ['палмето',       'Palmetto'],
];

const CYR_TO_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s',
  'т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht',
  'ъ':'a','ь':'y','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ж':'Zh','З':'Z','И':'I',
  'Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S',
  'Т':'T','У':'U','Ф':'F','Х':'H','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sht',
  'Ъ':'A','Ь':'Y','Ю':'Yu','Я':'Ya',
};

function transliterate(s) {
  if (!s) return '';
  let out = String(s);
  // SP suffix override
  out = out.replace(/СП/g, 'SP').replace(/сп/g, 'sp');
  return out.split('').map(c => CYR_TO_LAT[c] ?? c).join('');
}

// Detect canonical brand for a raw product string. Returns brand (Latin) or null.
function detectCanonical(rawCyrillic) {
  if (!rawCyrillic) return null;
  const lower = String(rawCyrillic).toLowerCase();
  for (const [cyr, lat] of BRAND_OVERRIDES) {
    if (lower.includes(cyr)) return lat;
  }
  return null;
}

// "3x Брейн 1+1" → { qty: 3, latin: "Brain 1+1", canonical: "Brain" }
// "Простатол 2+1+1СП" → { qty: 1, latin: "Prostatol 2+1+1SP", canonical: "Prostatol" }
function parseProduct(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s || s === '-') return null;

  // qty multiplier (latin x or cyrillic х)
  let qty = 1;
  const m = s.match(/^(\d+)\s*[xх]\s*(.+)$/i);
  if (m) {
    qty = Number(m[1]);
    s = m[2].trim();
  }

  const canonical = detectCanonical(s);
  if (!canonical) return null;

  // Replace the brand with its Latin override, then transliterate the rest
  let latin = s;
  for (const [cyr, lat] of BRAND_OVERRIDES) {
    const re = new RegExp(cyr, 'gi');
    latin = latin.replace(re, lat);
  }
  latin = transliterate(latin);
  // Collapse extra whitespace
  latin = latin.replace(/\s+/g, ' ').trim();

  return { qty, latin, canonical };
}

function parsePrice(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/лева?|лв\.?/gi, '').replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizePhone(raw) {
  if (raw == null || raw === '') return null;
  // The xlsx stores some phones as JS numbers (Excel's scientific-notation
  // display is JUST a display format — the underlying number is intact).
  // Convert to a fixed-decimal string so we don't lose precision.
  let str;
  if (typeof raw === 'number') {
    str = Number.isFinite(raw) ? raw.toFixed(0) : '';
  } else {
    str = String(raw);
    // Defensive: if a string ever comes in with scientific notation, parse it
    // and reformat as integer.
    if (/^[\d.]+e[+-]?\d+$/i.test(str.replace(/\s/g, ''))) {
      const n = Number(str);
      if (Number.isFinite(n)) str = n.toFixed(0);
    }
  }
  const digits = str.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.length === 12 && digits.startsWith('359')) return '+' + digits;
  if (digits.length === 11 && digits.startsWith('359')) return '+' + digits;
  if (digits.length === 10 && digits.startsWith('0')) return '+359' + digits.slice(1);
  if (digits.length === 9) return '+359' + digits;
  return '+' + digits; // accept other international as-is
}

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
  if (!m) return null;
  let [, dStr, moStr, y] = m;
  if (y.length === 2) y = '20' + y;
  if (Number(y) < 2020 || Number(y) > 2027) return null;
  let d = Number(dStr);
  let mo = Number(moStr);
  // Bulgarian default is DD.MM.YYYY but a few rows are MM.DD.YYYY. If the
  // first number is > 12, it can only be the day. If the second is > 12,
  // it must be the day so the values were swapped.
  if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// If we couldn't parse a date, fall back to the median of the dataset (2024-06-01)
// so the order still imports and lands in a sensible place on the timeline.
const FALLBACK_CREATED_AT = '2024-06-01T12:00:00Z';

function splitAddress(raw) {
  if (!raw) return { city: '', address: '' };
  const s = String(raw).trim();
  // Try first comma split
  const idx = s.indexOf(',');
  if (idx > 0 && idx < 30) {
    return { city: s.slice(0, idx).trim(), address: s.slice(idx + 1).trim() };
  }
  return { city: '', address: s };
}

// ── Read xlsx ──
console.log('Reading xlsx...');
const wb = XLSX.read(readFileSync(FILE_PATH), { type: 'buffer', cellDates: true });
const ws = wb.Sheets['CPA + INBOUND'];
if (!ws) {
  console.error('Sheet "CPA + INBOUND" not found.');
  process.exit(1);
}
// Read TWICE: formatted text for display-friendly fields (date as "29.10.2022"),
// and raw values for fields where Excel might have stored numbers with display
// formatting (notably: phone numbers in scientific notation). We then merge.
const formattedRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
const rawValueRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
const rawRows = formattedRows.map((row, i) => ({
  ...row,
  // The phone column: prefer the raw numeric value (preserves precision)
  // and fall back to the formatted text only if raw is missing.
  'телефон': rawValueRows[i]?.['телефон'] ?? row['телефон'],
}));
console.log(`Raw rows: ${rawRows.length}`);

// ── Normalize ──
const skipReasons = { noProduct: 0, noPhone: 0, noPrice: 0, noName: 0, badDate: 0 };
const orders = [];
for (const row of rawRows) {
  const rawName = (row['име'] || '').toString().trim();
  const rawPhone = (row['телефон'] || '').toString().trim();
  const rawAddress = (row['адрес'] || '').toString().trim();
  const rawProduct = (row['поръчка/продукт'] || '').toString().trim();
  const rawPrice = (row['цена'] || '').toString().trim();
  const rawStatus = (row['Статус(пратено,не пратено,платено,вратено,откажано)'] || '').toString().trim();
  const rawDate = (row['дата'] || '').toString().trim();
  const rawComment = (row['коментар'] || '').toString().trim();
  const rawSource = (row['ТВ / Сайт'] || '').toString().trim();

  const product = parseProduct(rawProduct);
  if (!product) { skipReasons.noProduct++; continue; }

  const phone = normalizePhone(rawPhone);
  if (!phone) { skipReasons.noPhone++; continue; }

  const priceLev = parsePrice(rawPrice);
  if (priceLev == null) { skipReasons.noPrice++; continue; }

  if (!rawName) { skipReasons.noName++; continue; }

  const date = parseDate(rawDate);
  if (rawDate && !date) skipReasons.badDate++;

  const status = normalizeStatus(rawStatus);
  const { city, address } = splitAddress(rawAddress);
  // The raw price is already the total for the row (e.g. "3x Brain 1+1" → 179.7 LEV is for all 3).
  const priceEur = levToEur(priceLev);

  orders.push({
    customer_name: rawName,
    customer_phone: phone,
    customer_city: city,
    customer_address: address,
    postal_code: '',
    product_name: product.latin,
    canonical_brand: product.canonical,
    quantity: product.qty,
    price_eur: priceEur,
    price_lev_original: priceLev,
    status,
    notes_combined: [
      rawComment ? `Note: ${rawComment}` : null,
      rawSource ? `Source: ${rawSource}` : null,
      `Imported from "IN,CPA and OUT.xlsx" (CPA+INBOUND sheet, original ${priceLev.toFixed(2)} LEV)`,
      !date ? `Original date "${rawDate}" could not be parsed; placed at ${FALLBACK_CREATED_AT.slice(0, 10)} fallback` : null,
    ].filter(Boolean).join(' | '),
    created_at: date ? `${date}T12:00:00Z` : FALLBACK_CREATED_AT,
  });
}

console.log(`\nNormalized orders: ${orders.length}`);
console.log('Skipped:', skipReasons);

const limited = LIMIT ? orders.slice(0, LIMIT) : orders;
console.log(`Will process: ${limited.length} order rows`);

// Stats by canonical
const byBrand = {};
for (const o of limited) {
  const b = byBrand[o.canonical_brand] || { count: 0, totalEur: 0 };
  b.count++;
  b.totalEur += o.price_eur;
  byBrand[o.canonical_brand] = b;
}
console.log('\nBy canonical product:');
for (const [b, info] of Object.entries(byBrand).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${b.padEnd(15)} | ${String(info.count).padStart(5)} orders | €${info.totalEur.toFixed(2)}`);
}

console.log('\nFirst 3 sample orders:');
for (const o of limited.slice(0, 3)) console.log('  ' + JSON.stringify(o));

if (DRY_RUN) {
  console.log('\n' + '═'.repeat(80));
  console.log('DRY-RUN complete. No database writes performed.');
  console.log('Re-run with --commit to actually insert.');
  console.log('═'.repeat(80));
  process.exit(0);
}

// ── Commit phase ──
console.log('\n' + '═'.repeat(80));
console.log('COMMIT MODE: writing to database...');
console.log('═'.repeat(80));

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 1. Fetch existing products
console.log('\n[1/3] Loading existing products...');
const { data: existingProducts, error: prodErr } = await supabase
  .from('products')
  .select('id, name');
if (prodErr) { console.error('Failed to load products:', prodErr); process.exit(1); }
const productByName = new Map((existingProducts || []).map(p => [p.name.toLowerCase(), p.id]));
console.log(`Found ${existingProducts.length} existing products`);

// 2. Insert any missing canonical products
const canonicalNeeded = [...new Set(limited.map(o => o.canonical_brand))];
const productsToCreate = canonicalNeeded.filter(name => !productByName.has(name.toLowerCase()));
if (productsToCreate.length > 0) {
  console.log(`\n[2/3] Creating ${productsToCreate.length} new products: ${productsToCreate.join(', ')}`);
  const { data: created, error: insErr } = await supabase
    .from('products')
    .insert(productsToCreate.map(name => ({
      name,
      description: 'Imported from CPA spreadsheet',
      price: 0, // placeholder — admin can edit later
      is_active: true,
    })))
    .select('id, name');
  if (insErr) { console.error('Product insert failed:', insErr); process.exit(1); }
  for (const p of created) productByName.set(p.name.toLowerCase(), p.id);
  console.log(`Created ${created.length} products`);
} else {
  console.log('\n[2/3] All canonical products already exist.');
}

// 3. Insert orders in batches
console.log(`\n[3/3] Inserting ${limited.length} orders in batches of 200...`);
const BATCH_SIZE = 200;
const insertedDisplayIds = [];
let succeeded = 0;
let failed = 0;
const errors = [];

for (let i = 0; i < limited.length; i += BATCH_SIZE) {
  const batch = limited.slice(i, i + BATCH_SIZE);
  const orderRows = batch.map(o => ({
    product_id: productByName.get(o.canonical_brand.toLowerCase()) || null,
    product_name: o.product_name,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_city: o.customer_city,
    customer_address: o.customer_address,
    postal_code: o.postal_code,
    price: o.price_eur,
    status: o.status,
    created_at: o.created_at,
  }));

  let { data, error } = await supabase
    .from('orders')
    .insert(orderRows)
    .select('id, display_id, customer_phone');

  // If a batch fails (one bad row poisons all 200), retry per-row so the rest survive.
  if (error) {
    console.warn(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} batch insert failed: ${error.message} — falling back to per-row inserts`);
    const retryData = [];
    let retryFailed = 0;
    for (let j = 0; j < orderRows.length; j++) {
      const { data: oneData, error: oneErr } = await supabase
        .from('orders')
        .insert([orderRows[j]])
        .select('id, display_id, customer_phone');
      if (oneErr) {
        retryFailed++;
        errors.push({ batch: Math.floor(i / BATCH_SIZE) + 1, row: j, error: oneErr.message, name: batch[j].customer_name });
      } else if (oneData && oneData[0]) {
        retryData.push({ ...oneData[0], _origIdx: j });
      }
    }
    data = retryData;
    failed += retryFailed;
  }

  // Insert order_items + order_notes. Use _origIdx if present (per-row retry path).
  const itemRows = data.map((o) => {
    const idx = o._origIdx ?? data.indexOf(o);
    const src = batch[idx];
    return {
      order_id: o.id,
      product_id: productByName.get(src.canonical_brand.toLowerCase()) || null,
      product_name: src.product_name,
      quantity: src.quantity,
      price_per_unit: Math.round((src.price_eur / src.quantity) * 100) / 100,
      total_price: src.price_eur,
    };
  });
  if (itemRows.length > 0) {
    const { error: itemErr } = await supabase.from('order_items').insert(itemRows);
    if (itemErr) console.warn(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: order_items insert warning:`, itemErr.message);
  }

  const noteRows = data.map((o) => {
    const idx = o._origIdx ?? data.indexOf(o);
    return {
      order_id: o.id,
      text: batch[idx].notes_combined,
      author_name: 'System (CPA Import)',
    };
  });
  if (noteRows.length > 0) {
    const { error: noteErr } = await supabase.from('order_notes').insert(noteRows);
    if (noteErr) console.warn(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: order_notes insert warning:`, noteErr.message);
  }

  succeeded += data.length;
  for (const o of data) insertedDisplayIds.push(o.display_id);
  process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: +${data.length} (running total: ${succeeded})\r`);
}

console.log('\n' + '═'.repeat(80));
console.log(`IMPORT COMPLETE`);
console.log(`  Inserted: ${succeeded} orders`);
console.log(`  Failed:   ${failed} orders`);
if (errors.length > 0) {
  console.log('\n  Error summary:');
  for (const e of errors.slice(0, 5)) console.log(`    Batch ${e.batch}: ${e.error}`);
}
console.log('═'.repeat(80));

// Save inserted display_ids for rollback
const rollbackPath = `scripts/cpa-import-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
const { writeFileSync } = await import('node:fs');
writeFileSync(rollbackPath, insertedDisplayIds.join('\n'));
console.log(`\nList of inserted display_ids saved to: ${rollbackPath}`);
console.log('To roll back, run in Supabase SQL editor:');
console.log(`  DELETE FROM orders WHERE display_id IN (...paste from ${rollbackPath}...);`);
