#!/usr/bin/env node
// Heuristic scanner for hardcoded user-facing strings that still need i18n.
// Read-only — prints a per-file report so each translation phase can verify
// it left no stragglers. Expect noise; it errs toward over-reporting.
//
// Usage: node scripts/i18n-scan.mjs [pathPrefix]
//   e.g. node scripts/i18n-scan.mjs src/pages/CallsPage.tsx
//        node scripts/i18n-scan.mjs src/components/calls

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const filterPrefix = process.argv[2] ? join(ROOT, process.argv[2]) : SRC;

// Generated UI primitives & non-UI code we never scan.
const EXCLUDE = [
  /[\\/]components[\\/]ui[\\/]/,
  /[\\/]integrations[\\/]/,
  /[\\/]i18n[\\/]/,
  /\.test\.(ts|tsx)$/,
  /[\\/]test[\\/]/,
];

// Lines that LOOK like user-facing English text.
const PATTERNS = [
  // JSX text content: >Word ... (starts with capital, has letters)
  { re: />\s*[A-Z][a-zA-Z][^<>{}]*</g, label: 'jsx-text' },
  // Common string props with literal capitalized text
  { re: /(?:placeholder|title|label|description|aria-label)=\s*"[A-Z][^"]{2,}"/g, label: 'string-prop' },
  // toast({ title: 'Text' ... with literal text
  { re: /title:\s*['"`][A-Z][^'"`]{2,}['"`]/g, label: 'toast-title' },
  { re: /description:\s*['"`][A-Z][^'"`]{2,}['"`]/g, label: 'toast-desc' },
];

// Things that match the patterns above but are not translatable text.
const IGNORE_LINE = [
  /className=/u, // tailwind-only lines often trip jsx-text via icons; keep if it ALSO has words — handled below
  /^\s*\/\//, /^\s*\*/, /^\s*\/\*/, // comments
];
const IGNORE_MATCH = [
  /^>\s*[A-Z]{1,4}</, // short acronyms like >OK<, >ID<, >EUR<
  /Elyon|Speedy|Econt|BigArena|naturatherapy|OpenCart/, // brand names stay untranslated
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(name)) yield p;
  }
}

let totalHits = 0;
const report = [];

for (const file of walk(SRC)) {
  if (!file.startsWith(filterPrefix)) continue;
  if (EXCLUDE.some(re => re.test(file))) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const hits = [];

  lines.forEach((line, i) => {
    if (IGNORE_LINE.some(re => re.test(line)) && !/>[A-Z][a-z]/.test(line)) return;
    if (line.includes("t('") || line.includes('t("') || line.includes('i18n.t(')) return; // already translated
    for (const { re, label } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const snippet = m[0].slice(0, 80);
        if (IGNORE_MATCH.some(re2 => re2.test(snippet))) continue;
        hits.push({ line: i + 1, label, snippet });
      }
    }
  });

  if (hits.length > 0) {
    report.push({ file: relative(ROOT, file), hits });
    totalHits += hits.length;
  }
}

report.sort((a, b) => b.hits.length - a.hits.length);
for (const { file, hits } of report) {
  console.log(`\n${file} — ${hits.length} candidate(s)`);
  for (const h of hits.slice(0, 15)) {
    console.log(`  L${h.line} [${h.label}] ${h.snippet}`);
  }
  if (hits.length > 15) console.log(`  … and ${hits.length - 15} more`);
}
console.log(`\n${report.length} file(s), ${totalHits} candidate string(s). Heuristic — review before acting.`);
