#!/usr/bin/env node
// Imports the OUTBOUND sheet from "IN,CPA and OUT.xlsx" as orders.
//
// Differences vs CPA importer:
// - Dates are bare DD.MM strings; the sheet has Bulgarian section-header
//   rows ("Май 2026", "Юли 2025", etc.) between data sections. We walk
//   rows in order and inherit year/month context from the most recent
//   header. Sections without an explicit year inherit from the previous.
// - Operator column ОПЕРАТОР is preserved on assigned_agent_name (no
//   FK lookup since the xlsx names don't match any current system users).
// - Status comes from КОМЕНТАР column (платено / вратено / etc.).
//
// Usage:
//   node scripts/import-outbound-xlsx.mjs                  (dry-run)
//   node --env-file=.env scripts/import-outbound-xlsx.mjs --commit
//   node --env-file=.env scripts/import-outbound-xlsx.mjs --commit --limit 50

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT;
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Number(args[i + 1]) : null;
})();
const FILE_PATH = process.env.OUTBOUND_XLSX_PATH || 'IN,CPA and OUT.xlsx';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('--commit requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env scripts/import-outbound-xlsx.mjs --commit');
  process.exit(1);
}

console.log('═'.repeat(80));
console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will insert into DB)'}`);
console.log(`File: ${FILE_PATH}`);
if (LIMIT) console.log(`Limit: first ${LIMIT} orders`);
console.log('═'.repeat(80));

const BGN_PER_EUR = 1.95583;
const levToEur = (l) => Math.round((l / BGN_PER_EUR) * 100) / 100;

const STATUS_MAP = {
  'платено': 'paid',
  'плътено': 'paid',
  'плащено': 'paid',
  'платуно': 'paid',
  'платево': 'paid',
  'платена': 'paid',
  'вратено': 'returned',
  'върнато': 'returned',
  'вратена': 'returned',
  'върната': 'returned',
  'во достава': 'shipped',
  'в достава': 'shipped',
  'отказана': 'cancelled',
  'отказа': 'cancelled',
  'анулирана': 'cancelled',
  'не е во систем': 'pending',
  'во офис': 'pending',
};

function normalizeStatus(s) {
  if (!s) return 'pending';
  let lower = String(s).toLowerCase().replace(/[!?]+/g, '').trim();
  if (STATUS_MAP[lower]) return STATUS_MAP[lower];
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    if (lower.includes(k)) return v;
  }
  return 'pending';
}

const BRAND_OVERRIDES = [
  ['простатол', 'Prostatol'], ['диабетол', 'Diabetol'],
  ['куркумактив', 'Curcumactiv'], ['брейн', 'Brain'],
  ['снейл', 'Snail'], ['снеил', 'Snail'],
  ['колаген', 'Collagen'], ['ендуро', 'Enduro'],
  ['алое', 'Aloe'], ['бронхо', 'Broncho'],
  ['палмето', 'Palmetto'],
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
  let out = String(s).replace(/СП/g, 'SP').replace(/сп/g, 'sp');
  return out.split('').map(c => CYR_TO_LAT[c] ?? c).join('');
}

function detectCanonical(rawCyrillic) {
  if (!rawCyrillic) return null;
  const lower = String(rawCyrillic).toLowerCase();
  for (const [cyr, lat] of BRAND_OVERRIDES) {
    if (lower.includes(cyr)) return lat;
  }
  return null;
}

function parseProduct(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s || s === '-') return null;
  let qty = 1;
  const m = s.match(/^(\d+)\s*[xх]\s*(.+)$/i);
  if (m) { qty = Number(m[1]); s = m[2].trim(); }
  const canonical = detectCanonical(s);
  if (!canonical) return null;
  let latin = s;
  for (const [cyr, lat] of BRAND_OVERRIDES) {
    latin = latin.replace(new RegExp(cyr, 'gi'), lat);
  }
  latin = transliterate(latin).replace(/\s+/g, ' ').trim();
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
  let str;
  if (typeof raw === 'number') {
    str = Number.isFinite(raw) ? raw.toFixed(0) : '';
  } else {
    str = String(raw);
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
  return '+' + digits;
}

// Bulgarian month names (with stems for inflected forms)
const BG_MONTH = [
  ['януар', 1], ['февруар', 2], ['март', 3], ['април', 4],
  ['май', 5], ['юни', 6], ['юли', 7], ['август', 8],
  ['септември', 9], ['октомври', 10], ['ноември', 11], ['декември', 12],
];

function parseSectionLabel(label) {
  if (!label) return null;
  const lower = String(label).toLowerCase();
  let month = null;
  for (const [stem, num] of BG_MONTH) {
    if (lower.includes(stem)) { month = num; break; }
  }
  if (month == null) return null;
  const yMatch = lower.match(/(20)\d{2}/);
  const year = yMatch ? parseInt(yMatch[0]) : null;
  return { month, year };
}

// Date column may come as a NUMBER like 12.07 (Excel parsed "12.07" as decimal)
// or as a STRING like "12.07" or "12.07.". Returns { day, month } if parsable.
function parseDateField(raw) {
  if (raw == null || raw === '') return null;
  let s;
  if (typeof raw === 'number') {
    // 12.07 → day=12, month=07.  But beware: 12.10 would be 12.1 (loses trailing 0).
    // Re-interpret as "DD.MM" by formatting with 2 decimal places.
    s = raw.toFixed(2);  // 12.07 → "12.07", 12.1 → "12.10"
  } else {
    s = String(raw).trim().replace(/\.+$/, ''); // trim trailing dots like "12.07."
  }
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})$/);
  if (!m) return null;
  let d = Number(m[1]), mo = Number(m[2]);
  if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { day: d, month: mo };
}

// ── Read sheet ──
console.log('Reading xlsx...');
const wb = XLSX.read(readFileSync(FILE_PATH), { type: 'buffer', cellDates: true });
const ws = wb.Sheets['OUTBOUND'];
if (!ws) { console.error('Sheet "OUTBOUND" not found.'); process.exit(1); }

// Read header-as-row form (array of arrays). Use raw values so phone keeps precision.
const allRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, header: 1 });
const formattedRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false, header: 1 });
console.log(`Total rows (incl. header & section markers): ${allRows.length}`);

// Column indexes (matches header row 0)
const COL_DATE = 0, COL_NAME = 1, COL_PHONE = 2, COL_CITY = 3, COL_ADDR = 4,
      COL_PRODUCT = 5, COL_SUM = 6, COL_OPERATOR = 7, COL_COMMENT = 8;

// Walk rows with section context. Default starting context: assume the
// rows before the first labelled section are September-October 2022
// (the first labelled section is "Октомври" with no year, and the next
// labelled one is "Януари 2023" — so backwards inference puts the prefix
// in late summer/early fall 2022).
let curMonth = null;
let curYear = 2022;  // initial guess; will be overridden by first labelled section

const orders = [];
const skip = { sectionMarker: 0, noProduct: 0, noPhone: 0, noPrice: 0, noName: 0, noDate: 0, total: 0 };

for (let i = 1; i < allRows.length; i++) {  // i=0 is the header
  const row = allRows[i];
  const fmt = formattedRows[i];
  if (!row) continue;

  const rawName = (row[COL_NAME] || '').toString().trim();
  const rawPhone = row[COL_PHONE];
  const rawProduct = (row[COL_PRODUCT] || '').toString().trim();
  const rawSum = row[COL_SUM];
  const rawCity = (row[COL_CITY] || '').toString().trim();
  const rawAddr = (row[COL_ADDR] || '').toString().trim();
  const rawOperator = (row[COL_OPERATOR] || '').toString().trim();
  const rawComment = (row[COL_COMMENT] || '').toString().trim();
  const rawExtra = (row[9] || '').toString().trim();
  const rawDate = row[COL_DATE];
  const fmtDate = fmt[COL_DATE];

  // Skip blank rows
  if (!rawName && !rawPhone && !rawProduct) continue;

  // Section marker: name present but no phone/product/sum
  if (rawName && !rawPhone && !rawProduct && !rawSum) {
    const parsed = parseSectionLabel(rawName);
    if (parsed) {
      // Inherit year from previous section if not specified.
      // If month went backward (e.g. Dec→Jan), bump year.
      if (parsed.year != null) {
        curYear = parsed.year;
      } else if (curMonth != null && parsed.month < curMonth) {
        curYear += 1;
      }
      curMonth = parsed.month;
      skip.sectionMarker++;
      continue;
    }
    // Not a recognizable section header — skip silently
    continue;
  }

  // Data row — parse it
  const product = parseProduct(rawProduct);
  if (!product) { skip.noProduct++; continue; }
  const phone = normalizePhone(rawPhone);
  if (!phone) { skip.noPhone++; continue; }
  const priceLev = parsePrice(rawSum) ?? parsePrice(fmt[COL_SUM]);
  if (priceLev == null) { skip.noPrice++; continue; }
  if (!rawName) { skip.noName++; continue; }

  // Date: combine the row's day.month with the current section month/year.
  // The date column's MONTH should equal curMonth — if it doesn't, prefer
  // the data row's month (could be a multi-month section, rare).
  let day = null, month = curMonth, year = curYear;
  const parsedDate = parseDateField(rawDate);
  if (parsedDate) {
    day = parsedDate.day;
    if (curMonth == null) {
      month = parsedDate.month;
    } else if (parsedDate.month !== curMonth) {
      // Out-of-section date — trust the data row's month.
      month = parsedDate.month;
      // If the data-row month is far from section month, possibly year boundary
    }
  }

  if (!day || !month || !year) { skip.noDate++; continue; }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const createdAt = `${dateStr}T12:00:00Z`;

  // Sanity-check the date isn't in the future (would indicate bad section
  // inference). If it is, drop a year.
  const today = new Date();
  if (new Date(createdAt).getTime() > today.getTime() + 86400000) {
    // Future-dated; back up one year. (Defensive — section headers usually
    // prevent this, but if they fail we fall back.)
    const fixedYear = year - 1;
    const fallback = `${fixedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`;
    if (new Date(fallback).getTime() <= today.getTime() + 86400000) {
      year = fixedYear;
    }
  }
  const finalCreated = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`;

  const status = normalizeStatus(rawComment);
  const priceEur = levToEur(priceLev);

  orders.push({
    customer_name: rawName,
    customer_phone: phone,
    customer_city: rawCity,
    customer_address: rawAddr,
    postal_code: '',
    product_name: product.latin,
    canonical_brand: product.canonical,
    quantity: product.qty,
    price_eur: priceEur,
    price_lev: priceLev,
    status,
    operator_name: rawOperator,
    notes_combined: [
      rawComment ? `Status note: ${rawComment}` : null,
      rawOperator ? `Operator: ${rawOperator}` : null,
      rawExtra ? `Extra: ${rawExtra}` : null,
      `Imported from "IN,CPA and OUT.xlsx" (OUTBOUND sheet, original ${priceLev.toFixed(2)} LEV)`,
    ].filter(Boolean).join(' | '),
    created_at: finalCreated,
  });
  skip.total++;
}

console.log(`\nNormalized orders: ${orders.length}`);
console.log('Skipped:', skip);

const limited = LIMIT ? orders.slice(0, LIMIT) : orders;

// Stats
const byBrand = {};
const byYear = {};
for (const o of limited) {
  const b = byBrand[o.canonical_brand] || { count: 0, totalEur: 0 };
  b.count++; b.totalEur += o.price_eur;
  byBrand[o.canonical_brand] = b;
  const y = o.created_at.slice(0, 4);
  byYear[y] = (byYear[y] || 0) + 1;
}
console.log('\nBy canonical product:');
for (const [b, info] of Object.entries(byBrand).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${b.padEnd(15)} ${String(info.count).padStart(5)} orders  €${info.totalEur.toFixed(2)}`);
}
console.log('\nBy year:');
for (const [y, c] of Object.entries(byYear).sort()) console.log(`  ${y}: ${c}`);

console.log('\nFirst 3 sample orders:');
for (const o of limited.slice(0, 3)) console.log('  ' + JSON.stringify(o));

if (DRY_RUN) {
  console.log('\nDRY-RUN complete. Re-run with --commit to insert.');
  process.exit(0);
}

// ── COMMIT ──
console.log('\n═'.repeat(80));
console.log('COMMIT MODE: writing to DB...');
console.log('═'.repeat(80));

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('\n[1/2] Loading existing products...');
const { data: existingProducts, error: prodErr } = await supabase.from('products').select('id, name');
if (prodErr) { console.error(prodErr); process.exit(1); }
const productByName = new Map((existingProducts || []).map(p => [p.name.toLowerCase(), p.id]));
console.log(`Found ${existingProducts.length} existing products (canonical brands already created by CPA import)`);

const canonicalNeeded = [...new Set(limited.map(o => o.canonical_brand))];
const productsToCreate = canonicalNeeded.filter(name => !productByName.has(name.toLowerCase()));
if (productsToCreate.length > 0) {
  console.log(`Creating ${productsToCreate.length} additional products: ${productsToCreate.join(', ')}`);
  const { data: created, error } = await supabase.from('products').insert(productsToCreate.map(name => ({
    name, description: 'Imported from OUTBOUND', price: 0, is_active: true,
  }))).select('id, name');
  if (error) { console.error(error); process.exit(1); }
  for (const p of created) productByName.set(p.name.toLowerCase(), p.id);
}

console.log(`\n[2/2] Inserting ${limited.length} orders in batches of 200...`);
const BATCH = 200;
const inserted = [];
let succeeded = 0, failed = 0;
const errors = [];

for (let i = 0; i < limited.length; i += BATCH) {
  const batch = limited.slice(i, i + BATCH);
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
    assigned_agent_name: o.operator_name || null,
    created_at: o.created_at,
  }));

  let { data, error } = await supabase.from('orders').insert(orderRows).select('id, display_id');
  if (error) {
    console.warn(`Batch ${Math.floor(i / BATCH) + 1} failed (${error.message}) — falling back to per-row`);
    const retry = [];
    let retryFail = 0;
    for (let j = 0; j < orderRows.length; j++) {
      const { data: one, error: e } = await supabase.from('orders').insert([orderRows[j]]).select('id, display_id');
      if (e) { retryFail++; errors.push({ row: i + j, name: batch[j].customer_name, error: e.message }); }
      else if (one?.[0]) retry.push({ ...one[0], _origIdx: j });
    }
    data = retry;
    failed += retryFail;
  }

  if (data && data.length > 0) {
    const items = data.map(o => {
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
    const { error: itemErr } = await supabase.from('order_items').insert(items);
    if (itemErr) console.warn(`  order_items batch warning:`, itemErr.message);

    const notes = data.map(o => {
      const idx = o._origIdx ?? data.indexOf(o);
      return { order_id: o.id, text: batch[idx].notes_combined, author_name: 'System (OUTBOUND Import)' };
    });
    const { error: noteErr } = await supabase.from('order_notes').insert(notes);
    if (noteErr) console.warn(`  order_notes batch warning:`, noteErr.message);

    succeeded += data.length;
    for (const o of data) inserted.push(o.display_id);
    process.stdout.write(`Batch ${Math.floor(i / BATCH) + 1}: +${data.length} (total: ${succeeded})\r`);
  }
}

console.log('\n' + '═'.repeat(80));
console.log(`OUTBOUND IMPORT COMPLETE`);
console.log(`  Inserted: ${succeeded}`);
console.log(`  Failed:   ${failed}`);
console.log('═'.repeat(80));

const rollbackPath = `scripts/outbound-import-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
writeFileSync(rollbackPath, inserted.join('\n'));
console.log(`Rollback list saved: ${rollbackPath}`);
console.log(`To roll back: node --env-file=.env scripts/rollback-cpa-import.mjs ${rollbackPath}`);
