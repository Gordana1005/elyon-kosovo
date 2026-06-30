// Deep analysis of the OUTBOUND sheet with RAW values (so dates and phones
// don't get rounded by display formatting).
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const wb = XLSX.read(readFileSync('IN,CPA and OUT.xlsx'), { type: 'buffer', cellDates: true });
const ws = wb.Sheets['OUTBOUND'];
const fmt = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

console.log(`OUTBOUND rows: ${fmt.length}\n`);

// Compare raw vs formatted on first 10 rows
console.log('First 10 rows — raw vs formatted:');
console.log('─'.repeat(115));
for (let i = 0; i < Math.min(10, raw.length); i++) {
  const r = raw[i], f = fmt[i];
  console.log(`  date raw=${String(r[' ']).padEnd(15)} (${typeof r[' ']})  fmt="${f[' ']}"`);
  console.log(`  phone raw=${String(r['Телефон']).padEnd(15)} fmt="${f['Телефон']}"  name="${r['Име']}"`);
  console.log(`  sum raw=${String(r['Сума']).padEnd(15)} fmt="${f['Сума']}"  product="${r['Поръчка']}"  comment="${r['КОМЕНТАР']}"`);
  console.log();
}

// Look at the date column type — are they real Date objects?
const dateTypes = new Map();
for (const r of raw) {
  const t = r[' '] instanceof Date ? 'Date' : (r[' '] === null ? 'null' : typeof r[' ']);
  dateTypes.set(t, (dateTypes.get(t) || 0) + 1);
}
console.log('Date column types in raw read:');
for (const [t, c] of dateTypes) console.log(`  ${t}: ${c}`);

// If they ARE dates, what's the range?
const dates = raw.map(r => r[' ']).filter(d => d instanceof Date && !isNaN(d.getTime()));
if (dates.length > 0) {
  dates.sort((a, b) => a - b);
  console.log(`\nDate range (from raw Date objects): ${dates[0].toISOString().slice(0, 10)} → ${dates[dates.length - 1].toISOString().slice(0, 10)}`);
  // Distribution by year
  const yrs = new Map();
  for (const d of dates) yrs.set(d.getFullYear(), (yrs.get(d.getFullYear()) || 0) + 1);
  for (const [y, c] of [...yrs.entries()].sort()) console.log(`  ${y}: ${c} rows`);
}

// Phone column types
const phoneTypes = new Map();
for (const r of raw) {
  const t = r['Телефон'] === null ? 'null' : typeof r['Телефон'];
  phoneTypes.set(t, (phoneTypes.get(t) || 0) + 1);
}
console.log('\nPhone column types in raw read:');
for (const [t, c] of phoneTypes) console.log(`  ${t}: ${c}`);

// Status (КОМЕНТАР) distribution
const statusCount = new Map();
for (const r of raw) {
  const k = (r['КОМЕНТАР'] || '').toString().trim().toLowerCase();
  if (!k) continue;
  statusCount.set(k, (statusCount.get(k) || 0) + 1);
}
console.log('\nStatus (КОМЕНТАР) distribution — top 30:');
const top = [...statusCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, c] of top) console.log(`  ${String(c).padStart(5)}  "${k}"`);

// Operators
const ops = new Map();
for (const r of raw) {
  const o = (r['ОПЕРАТОР'] || '').toString().trim();
  if (!o) continue;
  ops.set(o, (ops.get(o) || 0) + 1);
}
console.log('\nOperators (ОПЕРАТОР) — full list:');
for (const [o, c] of [...ops.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(5)}  "${o}"`);

// Sample of __EMPTY columns (might contain extra notes)
console.log('\n__EMPTY columns sample (extra-notes overflow):');
let withExtraNotes = 0;
for (const r of raw) {
  if (r['__EMPTY']) withExtraNotes++;
}
console.log(`  Rows with __EMPTY filled: ${withExtraNotes}`);
const sample = raw.filter(r => r['__EMPTY']).slice(0, 5);
for (const r of sample) {
  console.log(`    "${r['Име']}": __EMPTY="${String(r['__EMPTY']).slice(0, 80)}"`);
}
