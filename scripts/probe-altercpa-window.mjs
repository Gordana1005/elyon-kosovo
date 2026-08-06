#!/usr/bin/env node
/**
 * Answer ONE question before the live bridge is built — READ ONLY.
 *
 *   Does comp/list.json's from/to filter on CREATION time or LAST-UPDATE time?
 *
 * It decides the whole sync schedule. If the window is creation-time, an order
 * stays in its birth month forever and a rolling "last 45 minutes" poll can
 * NEVER see a phase change on an older lead — the nightly/weekly sweeps become
 * the only path for outcomes, not a safety net. If it is update-time, the
 * rolling poll catches everything and the sweeps really are just a net.
 *
 * ── How it is answered without waiting days ──
 * scripts/data/altercpa-mk-raw.jsonl is a snapshot of the past, captured
 * 2026-08-05. Re-fetching a month that is already in it gives a free
 * before/after comparison:
 *
 *   • same id set now as in the export        → window is CREATION time
 *   • fewer ids now (they moved out)          → window is UPDATE time
 *   • phases differ between then and now      → outcomes DO change after the
 *                                               fact, so a sweep is mandatory
 *                                               whichever way the first two go
 *
 * ── Safety ──
 * ENDPOINT below is the only URL this file can build, and it is the same
 * read-only listing endpoint scripts/export-altercpa-mk.mjs uses. AlterCPA's
 * write endpoints (add/status/edit/audio) are never referenced. Running this
 * modifies nothing, in AlterCPA or in Supabase — it does not even open a
 * database connection.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'scripts', 'data', 'altercpa-mk-raw.jsonl');

const ENDPOINT = 'https://api.cpa.moe/comp/list.json';   // read-only. never change.

const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
// A month old enough that everything in it has long since settled, but still
// inside the exported range (first MK order: 2025-04-14).
const MONTH = argVal('--month') || '2025-06';

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

const monthStart = (ym) => { const [y, m] = ym.split('-').map(Number); return Date.UTC(y, m - 1, 1) / 1000; };
const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ') : '—');

/**
 * Same contract as the export script: an error comes back as an OBJECT
 * ({"status":"error",...}), and treating that as an empty result is how a probe
 * "proves" a wrong conclusion. Non-array is a hard failure here too.
 */
async function fetchWindow(from, to) {
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
      if (!Array.isArray(body)) throw new Error(`non-array body: ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`window ${from}..${to} failed after 3 attempts: ${lastErr.message}`);
}

// ── the export snapshot, restricted to this month + MK ──────────────────────
const wFrom = monthStart(MONTH);
const wTo = monthStart(nextMonth(MONTH)) - 1;

const then = new Map();          // id -> { phase, status, time }
let exportTotal = 0;
for (const line of readFileSync(RAW, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  exportTotal++;
  if (o.time >= wFrom && o.time <= wTo) then.set(o.id, { phase: o.phase, status: o.status, time: o.time });
}

console.log('═'.repeat(76));
console.log(`AlterCPA window-semantics probe — READ ONLY (${ENDPOINT})`);
console.log(`Month: ${MONTH}   window ${iso(wFrom)} → ${iso(wTo)}  (epoch ${wFrom}..${wTo})`);
console.log(`Export snapshot: ${exportTotal.toLocaleString('en-US')} MK orders total, ${then.size.toLocaleString('en-US')} with time in this month`);
console.log('═'.repeat(76));

if (!then.size) {
  console.error(`\nNo exported orders fall in ${MONTH}. Pick another month with --month YYYY-MM.`);
  process.exit(1);
}

// ── re-fetch the same window today ──────────────────────────────────────────
process.stdout.write('Re-fetching the same window from the live API… ');
const rows = await fetchWindow(wFrom, wTo);
const now = new Map();
let nonMk = 0;
for (const o of rows) {
  if (String(o.country || '').toLowerCase() !== 'mk') { nonMk++; continue; }
  now.set(o.id, { phase: o.phase, status: o.status, time: o.time });
}
console.log(`${rows.length.toLocaleString('en-US')} rows (${now.size.toLocaleString('en-US')} mk, ${nonMk.toLocaleString('en-US')} other geos)\n`);

// ── 1. id-set comparison → the window question ──────────────────────────────
const missingNow = [...then.keys()].filter((id) => !now.has(id));   // were exported, gone today
const newNow = [...now.keys()].filter((id) => !then.has(id));       // appeared since the export

console.log('── 1. Is the window CREATION time or UPDATE time? ─────────────────────────');
console.log(`   in export, not in API today : ${missingNow.length.toLocaleString('en-US')}`);
console.log(`   in API today, not in export : ${newNow.length.toLocaleString('en-US')}`);

// Any row still returned whose out-of-window creation time proves the filter is
// not creation-based. Checked explicitly because it is the unambiguous signal.
const outOfBirthWindow = [...now.entries()].filter(([, v]) => v.time < wFrom || v.time > wTo);

let verdict;
if (outOfBirthWindow.length) {
  verdict = 'UPDATE';
  console.log(`   ⚠ ${outOfBirthWindow.length} returned rows were CREATED outside the window`);
} else if (missingNow.length === 0) {
  verdict = 'CREATION';
} else {
  verdict = 'AMBIGUOUS';
}

console.log();
if (verdict === 'CREATION') {
  console.log('   → CREATION time. Every order exported for this month is still returned for');
  console.log('     it, and nothing created outside the window came back.');
  console.log('     CONSEQUENCE: a rolling "last 45 minutes" poll sees NEW leads only. Phase');
  console.log('     changes on older leads arrive ONLY via the nightly/weekly sweeps — those');
  console.log('     are load-bearing, not a safety net. Size them to the real sales cycle.');
} else if (verdict === 'UPDATE') {
  console.log('   → UPDATE time. The window tracks last modification, not birth.');
  console.log('     CONSEQUENCE: the rolling poll catches phase changes on its own; the');
  console.log('     sweeps are a genuine safety net and can stay narrow.');
} else {
  console.log('   → AMBIGUOUS. Orders vanished from the window but nothing foreign appeared.');
  console.log('     Most likely deletions/merges on their side rather than update-time');
  console.log('     filtering. Inspect the sample below before choosing a schedule.');
  for (const id of missingNow.slice(0, 10)) {
    const t = then.get(id);
    console.log(`       id ${id}  exported phase=${t.phase} status=${t.status} created ${iso(t.time)}`);
  }
}

// ── 2. phase drift → does an outcome change after the fact? ─────────────────
const drift = [];
for (const [id, t] of then) {
  const n = now.get(id);
  if (n && (n.phase !== t.phase || n.status !== t.status)) drift.push({ id, t, n });
}

console.log('\n── 2. Do phases change AFTER the order was first seen? ────────────────────');
console.log(`   compared        : ${(then.size - missingNow.length).toLocaleString('en-US')} orders present in both`);
console.log(`   phase/status drift: ${drift.length.toLocaleString('en-US')}`);
if (drift.length) {
  const byMove = new Map();
  for (const d of drift) {
    const k = `phase ${d.t.phase} → ${d.n.phase}`;
    byMove.set(k, (byMove.get(k) || 0) + 1);
  }
  for (const [k, n] of [...byMove.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`      ${String(n).padStart(6)}  ${k}`);
  }
  console.log('   → outcomes DO move after intake. A sweep is mandatory regardless of §1,');
  console.log('     and status_mirror must be able to update an already-mirrored order.');
} else {
  console.log('   → no drift in this month. Outcomes look settled by the time we see them,');
  console.log('     but this is one old month — do not conclude "never" from it.');
}

// ── 3. how long does an order stay open? sizes the sweep windows ───────────
const settleDays = [];
for (const o of rows) {
  if (String(o.country || '').toLowerCase() !== 'mk') continue;
  const end = Number(o.paid) || Number(o.done) || 0;
  if (end > 0 && o.time > 0 && end >= o.time) settleDays.push((end - o.time) / 86400);
}
console.log('\n── 3. How long from creation to settlement? (sizes the sweep windows) ─────');
if (settleDays.length) {
  settleDays.sort((a, b) => a - b);
  const pct = (p) => settleDays[Math.min(settleDays.length - 1, Math.floor((p / 100) * settleDays.length))].toFixed(1);
  console.log(`   n=${settleDays.length.toLocaleString('en-US')}   p50 ${pct(50)}d   p90 ${pct(90)}d   p99 ${pct(99)}d   max ${settleDays[settleDays.length - 1].toFixed(1)}d`);
  console.log(`   → the weekly sweep must reach back at least p99 (${pct(99)} days) or it will`);
  console.log('     permanently miss the slowest conversions.');
} else {
  console.log('   no paid/done timestamps in this window — cannot size from this month.');
}

console.log('\n' + '═'.repeat(76));
console.log(`VERDICT: window = ${verdict};  phase drift = ${drift.length ? 'YES' : 'none in this month'}`);
console.log('═'.repeat(76));
console.log('Nothing was written. This probe is read-only.');
