#!/usr/bin/env node
/**
 * Export the Macedonian order history out of AlterCPA — READ ONLY.
 *
 *   node scripts/export-altercpa-mk.mjs                 # export / resume
 *   node scripts/export-altercpa-mk.mjs --verify        # re-fetch every month, compare id sets
 *   node scripts/export-altercpa-mk.mjs --from 2025-04 --to 2025-06
 *
 * Writes raw JSON, one object per line, to scripts/data/altercpa-mk-raw.jsonl.
 * NOTHING is flattened — `goods` (where the product name lives) and `tracking`
 * are nested objects and a CSV would destroy them. Derive CSVs downstream.
 *
 * ── Why month windows and not an `after` cursor ──
 * The API has no page cap, but it 500s on very large windows (94k records came
 * back fine; ~150k died). A whole-range request is therefore NOT "one page" —
 * it is an error, and an error is indistinguishable from "no more data" if you
 * only check `Array.isArray`. Responses are also NOT sorted by id, so a
 * max(id) cursor is unsafe by construction. Month windows sidestep both: each
 * is 1–10k records, and any window that still fails is halved until it fits.
 *
 * ── Safety ──
 * ENDPOINT below is the only URL this file can build. AlterCPA's write
 * endpoints (add/status/edit/audio) are never referenced. Nothing in AlterCPA
 * is modified by running this.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const RAW = join(DATA, 'altercpa-mk-raw.jsonl');
const PROGRESS = join(DATA, 'altercpa-mk-progress.json');

const ENDPOINT = 'https://api.cpa.moe/comp/list.json';   // read-only. never change.
const COUNTRY = 'mk';
const FIRST_MONTH = '2025-04';                            // first MK order: 2025-04-14

const args = process.argv.slice(2);
const VERIFY = args.includes('--verify');
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const API_KEY = process.env.ALTERCPA_API_KEY || readEnv('ALTERCPA_API_KEY');
if (!API_KEY) {
  console.error('Missing ALTERCPA_API_KEY. Put it in .env or pass it in the environment.');
  process.exit(1);
}

function readEnv(key) {
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*?)"?\s*$/);
      if (m && m[1] === key) return m[2];
    }
  } catch { /* no .env */ }
  return null;
}

// ── month helpers ─────────────────────────────────────────────────────────
const monthStart = (ym) => { const [y, m] = ym.split('-').map(Number); return Date.UTC(y, m - 1, 1) / 1000; };
const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const monthsBetween = (from, to) => {
  const out = []; let cur = from;
  while (cur <= to) { out.push(cur); cur = nextMonth(cur); }
  return out;
};
const thisMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

// ── fetch one window, splitting it if the API chokes ───────────────────────
async function fetchWindow(from, to, depth = 0) {
  const url = `${ENDPOINT}?id=${encodeURIComponent(API_KEY)}&from=${from}&to=${to}`;
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); }
      catch { throw new Error(`unparseable body (${text.slice(0, 120)})`); }

      // An error comes back as an OBJECT: {"status":"error","error":"..."}.
      // Treating that as end-of-stream is how an export silently truncates
      // while reporting success — so it is a hard failure here.
      if (!Array.isArray(body)) {
        throw new Error(`non-array body: ${JSON.stringify(body).slice(0, 200)}`);
      }
      return body;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }

  // Still failing: the window is probably too big to serialise. Halve it.
  if (depth < 4 && to - from > 86400) {
    const mid = Math.floor((from + to) / 2);
    process.stdout.write(`\n    window too large (${lastErr.message}) — splitting\n`);
    const a = await fetchWindow(from, mid, depth + 1);
    const b = await fetchWindow(mid + 1, to, depth + 1);
    return a.concat(b);
  }
  throw new Error(`window ${from}..${to} failed after retries and ${depth} splits: ${lastErr.message}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── state ─────────────────────────────────────────────────────────────────
mkdirSync(DATA, { recursive: true });

const seen = new Set();
if (existsSync(RAW)) {
  let n = 0;
  for (const line of readFileSync(RAW, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { seen.add(JSON.parse(line).id); n++; } catch { /* truncated tail */ }
  }
  console.log(`Existing export: ${n} lines, ${seen.size} distinct ids.`);
}

const progress = existsSync(PROGRESS)
  ? JSON.parse(readFileSync(PROGRESS, 'utf8'))
  : { done: [], countries: {}, started: new Date().toISOString() };

const from = argVal('--from') || FIRST_MONTH;
const to = argVal('--to') || thisMonth();
const months = monthsBetween(from, to);

console.log('═'.repeat(72));
console.log(`AlterCPA export — READ ONLY (${ENDPOINT})`);
console.log(`Months: ${months[0]} → ${months[months.length - 1]}  (${months.length})`);
console.log(`Country filter: ${COUNTRY}`);
console.log(`Mode: ${VERIFY ? 'VERIFY (re-fetch, compare, write nothing)' : 'EXPORT'}`);
console.log('═'.repeat(72));

let kept = 0, skippedDup = 0;
const verifyMissing = [];

const CURRENT = thisMonth();

for (const ym of months) {
  // The current month is still accumulating orders — never checkpoint it as
  // done, or a later run would skip the ones that arrived in the meantime.
  if (!VERIFY && ym !== CURRENT && progress.done.includes(ym)) {
    console.log(`${ym}  ✓ already done (${progress.countries[ym]?.mk ?? '?'} mk)`);
    continue;
  }
  const wFrom = monthStart(ym);
  const wTo = monthStart(nextMonth(ym)) - 1;

  process.stdout.write(`${ym}  fetching…`);
  const rows = await fetchWindow(wFrom, wTo);

  const byCountry = {};
  let mk = 0, added = 0;
  const lines = [];
  for (const o of rows) {
    const c = String(o.country || '').toLowerCase();
    byCountry[c] = (byCountry[c] || 0) + 1;
    if (c !== COUNTRY) continue;
    mk++;
    if (seen.has(o.id)) {
      if (VERIFY) continue;
      skippedDup++;
      continue;
    }
    if (VERIFY) { verifyMissing.push({ ym, id: o.id }); continue; }
    seen.add(o.id);
    lines.push(JSON.stringify(o));
    added++;
  }

  if (!VERIFY) {
    if (lines.length) appendFileSync(RAW, lines.join('\n') + '\n', 'utf8');
    if (ym !== CURRENT) progress.done = progress.done.filter((m) => m !== ym).concat(ym).sort();
    progress.countries[ym] = { ...byCountry, mk, added };
    progress.updated = new Date().toISOString();
    writeFileSync(PROGRESS, JSON.stringify(progress, null, 2), 'utf8');
  }
  kept += mk;

  const others = Object.entries(byCountry)
    .filter(([c]) => c !== COUNTRY)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([c, n]) => `${c}:${n}`).join(' ');
  console.log(`\r${ym}  total ${String(rows.length).padStart(6)}  mk ${String(mk).padStart(6)}` +
    `  new ${String(added).padStart(6)}   (excluded ${others}${Object.keys(byCountry).length > 5 ? ' …' : ''})`);

  await sleep(300);
}

console.log('═'.repeat(72));
if (VERIFY) {
  if (verifyMissing.length) {
    console.log(`✗ VERIFY FAILED — ${verifyMissing.length} MK orders are on the API but not in the export.`);
    for (const m of verifyMissing.slice(0, 20)) console.log(`   ${m.ym}  id ${m.id}`);
    process.exit(1);
  }
  console.log(`✓ VERIFY OK — every MK order in ${from}..${to} is present in the export.`);
} else {
  console.log(`MK orders seen this run: ${kept}   (already had: ${skippedDup}, new: ${kept - skippedDup})`);
  console.log(`Export total: ${seen.size} distinct MK orders`);
  console.log(`File: ${RAW}`);
}
