// The OUTBOUND sheet uses Bulgarian month-year header rows (e.g. "Май 2026")
// between sections of data. Find every such row so we can use them as
// year/month context when parsing the day.month dates.
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const wb = XLSX.read(readFileSync('IN,CPA and OUT.xlsx'), { type: 'buffer', cellDates: true });
const ws = wb.Sheets['OUTBOUND'];
const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, header: 1 });

// raw is now an array of arrays (rows). header[0] is the header row.
const headers = raw[0];
console.log('Sheet header columns:', JSON.stringify(headers));
console.log('');

// Find rows that look like section markers — they have a name in column B (Име)
// but no phone, no order, no sum.
const sections = [];
for (let i = 1; i < raw.length; i++) {
  const row = raw[i];
  const name = (row[1] || '').toString().trim();
  const phone = row[2];
  const product = row[5];
  const sum = row[6];
  if (name && !phone && !product && !sum) {
    sections.push({ rowIndex: i, label: name });
  }
}
console.log(`Section markers found: ${sections.length}`);
for (const s of sections) console.log(`  row ${String(s.rowIndex).padStart(5)}: "${s.label}"`);

// What's between the FIRST data row (row 1) and the first section marker?
// That's the unlabeled "earliest" section.
console.log(`\nFirst data row: 1 → ${sections[0]?.rowIndex - 1 ?? raw.length - 1} (no label)`);
console.log(`Last data row: ${sections[sections.length - 1]?.rowIndex + 1 ?? '?'} → ${raw.length - 1} (label: "${sections[sections.length - 1]?.label}")`);

// Show first 3 rows of EACH section so we can verify
const BG_MONTH = {
  'януари': 1, 'февруари': 2, 'март': 3, 'април': 4, 'май': 5, 'юни': 6,
  'юли': 7, 'август': 8, 'септември': 9, 'октомври': 10, 'ноември': 11, 'декември': 12,
};
function parseSectionLabel(label) {
  const lower = label.toLowerCase();
  let mo = null, year = null;
  for (const [name, num] of Object.entries(BG_MONTH)) {
    if (lower.includes(name)) { mo = num; break; }
  }
  const yMatch = lower.match(/(19|20)\d{2}/);
  if (yMatch) year = parseInt(yMatch[0]);
  return { month: mo, year };
}

console.log('\nParsed sections:');
for (const s of sections) {
  const { month, year } = parseSectionLabel(s.label);
  console.log(`  "${s.label.padEnd(30)}" → year=${year} month=${month}`);
}
