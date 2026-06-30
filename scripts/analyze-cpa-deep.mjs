// Deep analysis: products, statuses, prices (LEV→EUR), operators, dates,
// phone formats, and import readiness for IN,CPA and OUT.xlsx.
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2] || 'IN,CPA and OUT.xlsx';
const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });

// ── Bulgarian Lev → Euro fixed peg (Bulgaria is in ERM II / 1999 fixed rate)
const BGN_PER_EUR = 1.95583;
const levToEur = (lev) => Math.round((lev / BGN_PER_EUR) * 100) / 100;

const STATUS_MAP = {
  // Bulgarian → DB enum
  'платено': 'paid',
  'плътено': 'paid',           // typo variant
  'пратено': 'shipped',
  'не пратено': 'pending',
  'непратено': 'pending',
  'вратено': 'returned',
  'върнато': 'returned',
  'въртнато': 'returned',
  'откажано': 'cancelled',
  'отказано': 'cancelled',
  'отказ': 'cancelled',
};

function normalizeStatus(s) {
  if (!s) return null;
  const lower = String(s).trim().toLowerCase();
  if (STATUS_MAP[lower]) return STATUS_MAP[lower];
  // partial match
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

function parsePrice(raw) {
  if (raw == null) return null;
  // Strip "лв", "лева", whitespace; normalize comma to dot.
  let s = String(raw).replace(/лева?|лв\.?/gi, '').replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "3x Брейн 1+1" → { qty: 3, name: "Брейн 1+1" }
// "Брейн 1+1"   → { qty: 1, name: "Брейн 1+1" }
// "2x 2+1 Диабетол" → { qty: 2, name: "2+1 Диабетол" }
function parseProduct(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d+)\s*[xх]\s*(.+)$/i);  // x = latin, х = cyrillic
  if (m) return { qty: Number(m[1]), name: m[2].trim() };
  return { qty: 1, name: s };
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  // 9 digits starting with 8 or 9 → BG mobile, prepend 359
  if (digits.length === 9 && /^[89]/.test(digits)) return '+359' + digits;
  // 10 digits starting with 0 → BG, replace leading 0
  if (digits.length === 10 && digits.startsWith('0')) return '+359' + digits.slice(1);
  // 12 digits starting with 359 → already BG
  if (digits.length === 12 && digits.startsWith('359')) return '+' + digits;
  // Fallback: leave as digits
  return digits;
}

// "29.10.2022" → "2022-10-29"
// "12.07" → null (no year)
function parseDate(raw, fallbackYear) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})$/);
  if (m && fallbackYear) {
    const [, d, mo] = m;
    return `${fallbackYear}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// ── Process sheets ──
const report = { sheets: {}, totals: {} };

function analyzeSheet(name, rows, mapping) {
  const summary = {
    rowCount: rows.length,
    parsedRows: 0,
    issues: { phoneInvalid: 0, priceInvalid: 0, statusInvalid: 0, dateInvalid: 0, missingProduct: 0, missingName: 0 },
    products: new Map(),     // name → { count, totalLev, totalEur, totalQty }
    statuses: new Map(),     // raw → { mapped, count }
    operators: new Map(),    // name → count
    sources: new Map(),      // tv/channel → count
    phones: new Set(),
    yearDistribution: new Map(),
    samples: { ok: [], failed: [] },
    totalLev: 0,
    totalEur: 0,
  };

  for (const row of rows) {
    const rawName = (row[mapping.name] || '').toString().trim();
    const rawPhone = (row[mapping.phone] || '').toString().trim();
    const rawAddress = (row[mapping.address] || '').toString().trim();
    const rawProduct = (row[mapping.product] || '').toString().trim();
    const rawPrice = (row[mapping.price] || '').toString().trim();
    const rawStatus = (row[mapping.status] || '').toString().trim();
    const rawDate = (row[mapping.date] || '').toString().trim();
    const rawComment = (row[mapping.comment] || '').toString().trim();
    const rawSource = mapping.source ? (row[mapping.source] || '').toString().trim() : '';
    const rawOperator = mapping.operator ? (row[mapping.operator] || '').toString().trim() : '';
    const rawCity = mapping.city ? (row[mapping.city] || '').toString().trim() : '';

    // Skip obviously empty rows
    if (!rawName && !rawPhone && !rawProduct) continue;

    const issues = [];
    const phone = normalizePhone(rawPhone);
    const price = parsePrice(rawPrice);
    const status = normalizeStatus(rawStatus);
    const product = parseProduct(rawProduct);
    const date = parseDate(rawDate, mapping.fallbackYear);

    if (!phone) { summary.issues.phoneInvalid++; issues.push('phone'); }
    if (price == null) { summary.issues.priceInvalid++; issues.push('price'); }
    if (rawStatus && !status) { summary.issues.statusInvalid++; issues.push('status'); }
    if (!product) { summary.issues.missingProduct++; issues.push('product'); }
    if (!rawName) { summary.issues.missingName++; }
    if (rawDate && !date) summary.issues.dateInvalid++;

    if (issues.length === 0) summary.parsedRows++;

    // Aggregate
    if (product) {
      const cur = summary.products.get(product.name) || { count: 0, totalLev: 0, totalEur: 0, totalQty: 0, exampleRaw: rawProduct };
      cur.count++;
      cur.totalQty += product.qty;
      if (price != null) {
        cur.totalLev += price;
        cur.totalEur += levToEur(price);
      }
      summary.products.set(product.name, cur);
    }

    if (rawStatus) {
      const sCur = summary.statuses.get(rawStatus) || { mapped: status || '(unmapped)', count: 0 };
      sCur.count++;
      summary.statuses.set(rawStatus, sCur);
    }

    if (rawSource) summary.sources.set(rawSource, (summary.sources.get(rawSource) || 0) + 1);
    if (rawOperator) summary.operators.set(rawOperator, (summary.operators.get(rawOperator) || 0) + 1);
    if (phone) summary.phones.add(phone);

    if (date) {
      const yr = date.slice(0, 4);
      summary.yearDistribution.set(yr, (summary.yearDistribution.get(yr) || 0) + 1);
    }

    if (price != null) {
      summary.totalLev += price;
      summary.totalEur += levToEur(price);
    }

    if (issues.length === 0 && summary.samples.ok.length < 3) {
      summary.samples.ok.push({ rawName, rawPhone, phone, rawProduct, qty: product.qty, name: product.name, lev: price, eur: price != null ? levToEur(price) : null, status, date, rawCity });
    } else if (issues.length > 0 && summary.samples.failed.length < 3) {
      summary.samples.failed.push({ rawName, rawPhone, rawProduct, rawPrice, rawStatus, rawDate, issues });
    }
  }

  return summary;
}

// CPA + INBOUND mapping
const cpaSheet = wb.Sheets['CPA + INBOUND'];
const cpaRows = XLSX.utils.sheet_to_json(cpaSheet, { defval: null, raw: false });
const cpaSummary = analyzeSheet('CPA + INBOUND', cpaRows, {
  name: 'име',
  phone: 'телефон',
  address: 'адрес',
  product: 'поръчка/продукт',
  price: 'цена',
  status: 'Статус(пратено,не пратено,платено,вратено,откажано)',
  date: 'дата',
  comment: 'коментар',
  source: 'ТВ / Сайт',
});
report.sheets['CPA + INBOUND'] = cpaSummary;

// OUTBOUND mapping (note: date column has blank header)
const outSheet = wb.Sheets['OUTBOUND'];
const outRows = XLSX.utils.sheet_to_json(outSheet, { defval: null, raw: false });
const outSummary = analyzeSheet('OUTBOUND', outRows, {
  name: 'Име',
  phone: 'Телефон',
  city: 'Град/Село',
  address: 'Адрес',
  product: 'Поръчка',
  price: 'Сума',
  status: 'КОМЕНТАР',
  date: ' ',  // blank-named first column
  comment: '__EMPTY',
  operator: 'ОПЕРАТОР',
  fallbackYear: '2024',  // OUTBOUND dates are MM.DD without year
});
report.sheets['OUTBOUND'] = outSummary;

// ── Print report ──
function fmt(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function printSheet(label, s) {
  console.log('\n' + '═'.repeat(80));
  console.log(`SHEET: ${label}`);
  console.log('═'.repeat(80));
  console.log(`Total rows: ${s.rowCount}`);
  console.log(`Cleanly parsed: ${s.parsedRows}  (${(s.parsedRows / s.rowCount * 100).toFixed(1)}%)`);
  console.log(`Unique phones: ${s.phones.size}`);
  console.log(`Unique products: ${s.products.size}`);
  console.log(`Total value: ${fmt(s.totalLev)} LEV  →  ${fmt(s.totalEur)} EUR`);
  console.log(`\nIssues:`);
  for (const [k, v] of Object.entries(s.issues)) {
    if (v > 0) console.log(`  ${k.padEnd(20)} ${v}`);
  }

  console.log('\nYears found:');
  const years = [...s.yearDistribution.entries()].sort();
  for (const [y, c] of years) console.log(`  ${y}: ${c}`);

  console.log('\nTop 25 products (by row count):');
  const topProducts = [...s.products.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 25);
  for (const [name, info] of topProducts) {
    console.log(`  ${name.padEnd(40)} | rows: ${String(info.count).padStart(4)} | qty: ${String(info.totalQty).padStart(5)} | ${fmt(info.totalLev).padStart(10)} LEV → ${fmt(info.totalEur).padStart(9)} EUR`);
  }

  console.log('\nStatus mapping:');
  const statuses = [...s.statuses.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [raw, info] of statuses) {
    console.log(`  "${raw.padEnd(20)}" → ${info.mapped.padEnd(14)} (${info.count} rows)`);
  }

  if (s.sources.size > 0) {
    console.log('\nSources (TV / Сайт) — top 15:');
    const top = [...s.sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [src, c] of top) console.log(`  ${src.padEnd(40)} ${c}`);
  }

  if (s.operators.size > 0) {
    console.log('\nOperators (ОПЕРАТОР) — all:');
    const all = [...s.operators.entries()].sort((a, b) => b[1] - a[1]);
    for (const [op, c] of all) console.log(`  ${op.padEnd(30)} ${c}`);
  }

  console.log('\nSample CLEAN rows:');
  for (const r of s.samples.ok) console.log('  ' + JSON.stringify(r));
  console.log('\nSample FAILED rows:');
  for (const r of s.samples.failed) console.log('  ' + JSON.stringify(r));
}

console.log(`Currency peg: 1 EUR = ${BGN_PER_EUR} BGN  (Bulgarian National Bank fixed rate)`);
printSheet('CPA + INBOUND', cpaSummary);
printSheet('OUTBOUND', outSummary);

// ── Combined totals + dedupe across sheets
const allPhones = new Set([...cpaSummary.phones, ...outSummary.phones]);
const sharedPhones = [...cpaSummary.phones].filter(p => outSummary.phones.has(p));
const totalLev = cpaSummary.totalLev + outSummary.totalLev;

console.log('\n' + '═'.repeat(80));
console.log('GRAND TOTALS');
console.log('═'.repeat(80));
console.log(`Total order rows across both sheets: ${cpaSummary.rowCount + outSummary.rowCount}`);
console.log(`Cleanly parsed: ${cpaSummary.parsedRows + outSummary.parsedRows}`);
console.log(`Unique phones overall: ${allPhones.size}`);
console.log(`Phones appearing in BOTH sheets: ${sharedPhones.length}`);
console.log(`Total LEV: ${fmt(totalLev)}`);
console.log(`Total EUR: ${fmt(levToEur(totalLev))}`);

// Write a JSON snapshot for downstream import script.
const out = {
  bgn_per_eur: BGN_PER_EUR,
  cpa: {
    rowCount: cpaSummary.rowCount,
    parsedRows: cpaSummary.parsedRows,
    products: [...cpaSummary.products.entries()].map(([name, info]) => ({ name, ...info })),
    statuses: [...cpaSummary.statuses.entries()].map(([raw, info]) => ({ raw, ...info })),
    sources: [...cpaSummary.sources.entries()],
    operators: [...cpaSummary.operators.entries()],
    issues: cpaSummary.issues,
    totalLev: cpaSummary.totalLev,
    totalEur: cpaSummary.totalEur,
  },
  outbound: {
    rowCount: outSummary.rowCount,
    parsedRows: outSummary.parsedRows,
    products: [...outSummary.products.entries()].map(([name, info]) => ({ name, ...info })),
    statuses: [...outSummary.statuses.entries()].map(([raw, info]) => ({ raw, ...info })),
    operators: [...outSummary.operators.entries()],
    issues: outSummary.issues,
    totalLev: outSummary.totalLev,
    totalEur: outSummary.totalEur,
  },
  combined: {
    uniquePhones: allPhones.size,
    sharedPhones: sharedPhones.length,
    totalLev,
    totalEur: levToEur(totalLev),
  },
};
writeFileSync('scripts/cpa-analysis.json', JSON.stringify(out, null, 2));
console.log('\nWrote scripts/cpa-analysis.json (machine-readable summary).');
