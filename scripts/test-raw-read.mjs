// Try reading the xlsx with raw:true to see if the underlying numeric
// values still have full phone-number precision (vs the display text
// "3.59889E+11" which has rounded).
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const wb = XLSX.read(readFileSync('IN,CPA and OUT.xlsx'), { type: 'buffer', cellDates: true });
const ws = wb.Sheets['CPA + INBOUND'];

// Get raw values
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
const formattedRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

console.log('Comparing raw vs formatted phone reads for first 30 rows that had a phone:\n');
console.log('rawValue (raw:true)              formattedText (raw:false)');
console.log('─'.repeat(70));

let shown = 0;
for (let i = 0; i < rawRows.length && shown < 30; i++) {
  const rawPhone = rawRows[i]['телефон'];
  const fmtPhone = formattedRows[i]['телефон'];
  if (rawPhone == null && fmtPhone == null) continue;
  // Only show ones where formatted looks like scientific notation
  const fmtStr = String(fmtPhone || '');
  const isSci = /e[+-]?\d/i.test(fmtStr);
  if (!isSci && shown > 5) continue;
  console.log(
    `raw=${String(rawPhone).padEnd(20)} typeof=${(typeof rawPhone).padEnd(8)} fmt="${fmtStr}"`
  );
  shown++;
}

// Also check full-number read of the polluted ones
console.log('\n─── Specifically rows whose formatted phone is "3.59889E+11" ───');
let count = 0;
for (let i = 0; i < formattedRows.length && count < 5; i++) {
  if (String(formattedRows[i]['телефон'] || '') === '3.59889E+11') {
    const rawPhone = rawRows[i]['телефон'];
    console.log(`  row ${i}: raw=${rawPhone} (type ${typeof rawPhone})  name="${rawRows[i]['име']}"`);
    count++;
  }
}

// Let's also dump the full xlsx cell content as it sees it
console.log('\n─── Looking at one cell directly via the worksheet ───');
const ref = ws['!ref'];
const range = XLSX.utils.decode_range(ref);
// Phone column header is in cell D1 (column 3 = D); scan column D for first sci-notation
for (let r = range.s.r + 1; r <= Math.min(range.s.r + 50, range.e.r); r++) {
  const addr = XLSX.utils.encode_cell({ r, c: 3 });
  const cell = ws[addr];
  if (!cell) continue;
  if (String(cell.w || '').match(/e[+-]?\d/i)) {
    console.log(`  ${addr}: t=${cell.t} v=${cell.v}  w=${cell.w}`);
    break;
  }
}
