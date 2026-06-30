import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const wb = XLSX.read(readFileSync('IN,CPA and OUT.xlsx'), { type: 'buffer', cellDates: true });
const ws = wb.Sheets['OUTBOUND'];
const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
const fmt = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

// Show distinct date STRINGS (especially the 688 string entries)
const stringDates = new Map();
for (let i = 0; i < raw.length; i++) {
  const v = raw[i][' '];
  if (typeof v === 'string') {
    stringDates.set(v, (stringDates.get(v) || 0) + 1);
  }
}
console.log(`Distinct STRING date entries: ${stringDates.size}`);
console.log('Top 30 string dates:');
const top = [...stringDates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [s, c] of top) console.log(`  ${String(c).padStart(4)}  "${s}"`);

// Look at last 10 rows (likely chronologically last)
console.log('\nLast 10 rows in OUTBOUND:');
for (let i = raw.length - 10; i < raw.length; i++) {
  if (i < 0) continue;
  const r = raw[i], f = fmt[i];
  console.log(`  row ${i}: date raw=${JSON.stringify(r[' '])} fmt="${f[' ']}"  name="${r['Име']}"  product="${r['Поръчка']}"`);
}

// Look at first/last 5 rows AROUND the transition between number-dates and string-dates
console.log('\nFirst rows where date is a STRING (year markers?):');
let shown = 0;
for (let i = 0; i < raw.length && shown < 10; i++) {
  if (typeof raw[i][' '] === 'string') {
    console.log(`  row ${i}: date="${raw[i][' ']}"  name="${raw[i]['Име']}"`);
    shown++;
  }
}

// Show all unique numeric dates (these are likely DAY.MONTH pairs)
const numDates = new Set();
for (const r of raw) {
  if (typeof r[' '] === 'number') numDates.add(r[' ']);
}
console.log(`\nUnique numeric dates: ${numDates.size}`);
const numArr = [...numDates].sort((a, b) => a - b);
console.log(`Min numeric: ${numArr[0]}  Max numeric: ${numArr[numArr.length - 1]}`);
console.log(`Sample of numeric values: ${numArr.slice(0, 10).join(', ')} ... ${numArr.slice(-5).join(', ')}`);
