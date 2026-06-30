// For a few polluted phones, find the original xlsx row(s) by matching on
// customer_name. Show what the original phone field actually contained.
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Re-read the xlsx
const wb = XLSX.read(readFileSync('IN,CPA and OUT.xlsx'), { type: 'buffer', cellDates: true });
const cpaRows = XLSX.utils.sheet_to_json(wb.Sheets['CPA + INBOUND'], { defval: null, raw: false });

// Pick a few polluted phones to investigate
const sampleNames = [
  'Румяна Матеева',  // attached to +359035988911
  'Милко Димитров',   // attached to +359035987811
  'Цветка Василева Русенова',  // attached to +359035989911
];

console.log('Tracing polluted phones back to original xlsx rows:\n');
for (const name of sampleNames) {
  const matches = cpaRows.filter(r => (r['име'] || '').includes(name) || name.includes((r['име'] || '')));
  console.log('═'.repeat(75));
  console.log(`Customer name: "${name}"`);
  console.log(`Matches in xlsx: ${matches.length}`);
  for (const m of matches.slice(0, 3)) {
    console.log(`  Date:    ${m['дата']}`);
    console.log(`  Name:    "${m['име']}"`);
    console.log(`  Phone:   "${m['телефон']}"  (raw)`);
    console.log(`  Product: "${m['поръчка/продукт']}"`);
    console.log('');
  }
}

// Look at the raw phone column distribution for any "0359" / "no phone" patterns
const phoneFreq = new Map();
for (const r of cpaRows) {
  const p = (r['телефон'] || '').toString().trim();
  phoneFreq.set(p, (phoneFreq.get(p) || 0) + 1);
}
const tops = [...phoneFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log('\n═══════════════════════════════════════════════════════════════════════════');
console.log('TOP 20 RAW PHONE STRINGS IN THE XLSX (most repeated):');
console.log('═══════════════════════════════════════════════════════════════════════════');
for (const [p, c] of tops) console.log(`  count=${String(c).padStart(4)}   "${p}"`);
