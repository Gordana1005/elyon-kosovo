// Read-only analysis of IN,CPA and OUT.xlsx — prints structure + samples.
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'IN,CPA and OUT.xlsx';
const buf = readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

console.log('='.repeat(80));
console.log('FILE:', path);
console.log('SHEETS:', wb.SheetNames.length);
console.log('='.repeat(80));

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : null;
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })[0] || [];

  console.log('\n' + '─'.repeat(80));
  console.log(`SHEET: "${name}"`);
  console.log(`Range: ${ref}  |  rows: ${rows.length}  |  cols: ${range ? range.e.c - range.s.c + 1 : 0}`);
  console.log(`Header: ${JSON.stringify(headerRow)}`);

  // Column type analysis
  if (rows.length > 0) {
    const cols = Object.keys(rows[0]);
    const colInfo = cols.map(col => {
      const vals = rows.map(r => r[col]).filter(v => v !== null && v !== '');
      const sample = vals.slice(0, 3);
      const types = new Set(vals.map(v => typeof v));
      return { col, nonNull: vals.length, types: [...types].join('|'), sample };
    });
    console.log('Columns:');
    for (const c of colInfo) {
      console.log(`  ${c.col.padEnd(25)} | ${String(c.nonNull).padStart(5)}/${rows.length} | ${c.types.padEnd(8)} | sample: ${JSON.stringify(c.sample).slice(0, 100)}`);
    }
  }

  // First 5 rows verbatim
  console.log('\nFirst 5 rows:');
  for (const r of rows.slice(0, 5)) {
    console.log('  ' + JSON.stringify(r));
  }
  if (rows.length > 5) {
    console.log(`  ... ${rows.length - 5} more rows`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('END OF ANALYSIS');
