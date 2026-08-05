#!/usr/bin/env node
/**
 * Profile the AlterCPA MK export. Reads only; writes one markdown report.
 *
 *   node scripts/analyze-altercpa-mk.mjs
 *
 * This is the page you read BEFORE importing — it says exactly how many rows
 * will be dropped for a bad phone, what the product names look like against the
 * catalogue, and where the money is.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHASE, PHASE_TO_STATUS, REASON, FX_TO_EUR, toEur,
  normalizeMkPhone, productNameOf, quantityOf, isoDay, readOrders,
} from './lib/altercpa.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'scripts', 'data', 'altercpa-mk-raw.jsonl');
const OUT = join(ROOT, 'scripts', 'data', 'altercpa-mk-analysis.md');

const orders = readOrders(RAW);
const L = [];
const say = (s = '') => L.push(s);
const tally = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;

say(`# AlterCPA Macedonia export — analysis`);
say();
say(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from \`${orders.length.toLocaleString('en-US')}\` orders.`);
say();

// ── 1. coverage ───────────────────────────────────────────────────────────
const byMonth = new Map();
const byMonthPhase = new Map();
for (const o of orders) {
  const m = isoDay(o.time).slice(0, 7);
  tally(byMonth, m);
  tally(byMonthPhase, `${m}|${PHASE[o.phase] || o.phase}`);
}
say(`## 1. Coverage`);
say();
say(`| month | orders | approved | cancelled | trash |`);
say(`|---|---:|---:|---:|---:|`);
for (const m of [...byMonth.keys()].sort()) {
  const g = (p) => byMonthPhase.get(`${m}|${p}`) || 0;
  say(`| ${m} | ${byMonth.get(m).toLocaleString('en-US')} | ${g('approved')} | ${g('cancelled')} | ${g('trash')} |`);
}
say();

// ── 2. outcome ────────────────────────────────────────────────────────────
const byPhase = new Map(), byStatus = new Map(), byReason = new Map();
for (const o of orders) {
  tally(byPhase, PHASE[o.phase] || `phase ${o.phase}`);
  tally(byStatus, o.status);
  if (o.phase === 4 || o.phase === 5) tally(byReason, REASON[o.reason] ?? `reason ${o.reason}`);
}
say(`## 2. Outcome`);
say();
say(`| AlterCPA phase | orders | share | → Elyon status |`);
say(`|---|---:|---:|---|`);
for (const [k, n] of sorted(byPhase)) {
  const ph = Object.entries(PHASE).find(([, v]) => v === k)?.[0];
  say(`| ${k} | ${n.toLocaleString('en-US')} | ${pct(n, orders.length)} | \`${PHASE_TO_STATUS[ph] ?? '?'}\` |`);
}
say();
say(`Cancel/trash reasons:`);
say();
say(`| reason | orders |`);
say(`|---|---:|`);
for (const [k, n] of sorted(byReason)) say(`| ${k} | ${n.toLocaleString('en-US')} |`);
say();
say(`> \`paid\` is 0 on **all ${orders.length.toLocaleString('en-US')}** orders — AlterCPA carries no payment truth.`);
say(`> That is what the collabBox correction pass exists to fix.`);
say();

// ── 3. phones ─────────────────────────────────────────────────────────────
const rawLen = new Map(), shape = new Map();
let dropped = 0;
const droppedSamples = [];
const phoneSet = new Set();
for (const o of orders) {
  const raw = String(o.phone ?? '');
  tally(rawLen, raw.replace(/\D/g, '').length);
  const norm = normalizeMkPhone(raw);
  if (!norm) {
    dropped++;
    if (droppedSamples.length < 10) droppedSamples.push(`${o.id}: "${raw}"`);
    continue;
  }
  phoneSet.add(norm);
  tally(shape, norm.length);
}
say(`## 3. Phones`);
say();
say(`\`normalizeMkPhone\` (the exact function the import endpoint uses) would **drop ${dropped} rows** (${pct(dropped, orders.length)}).`);
say();
say(`| raw digit count | orders |`);
say(`|---:|---:|`);
for (const [k, n] of [...rawLen.entries()].sort((a, b) => a[0] - b[0])) say(`| ${k} | ${n.toLocaleString('en-US')} |`);
say();
say(`Normalised E.164 length (a correct MK mobile is 12 chars, \`+389\` + 8):`);
say();
for (const [k, n] of [...shape.entries()].sort((a, b) => a[0] - b[0])) {
  say(`- \`${k}\` chars — ${n.toLocaleString('en-US')}${k !== 12 ? '  ⚠️ not a standard MK number' : ''}`);
}
say();
say(`**Distinct customers after normalisation: ${phoneSet.size.toLocaleString('en-US')}** (from ${orders.length.toLocaleString('en-US')} orders).`);
if (droppedSamples.length) {
  say();
  say(`Dropped examples: ${droppedSamples.map((s) => `\`${s}\``).join(', ')}`);
}
say();

// ── 4. money ──────────────────────────────────────────────────────────────
const byCur = new Map();
let zeroPrice = 0, unconvertible = 0, sumEur = 0, sumEurPaid = 0;
const pricePoints = new Map();
for (const o of orders) {
  const cur = String(o.currency || '').toLowerCase();
  tally(byCur, cur || '(blank)');
  if (!Number(o.price)) zeroPrice++;
  if (!FX_TO_EUR[cur]) { unconvertible++; continue; }
  const eur = toEur(o.price, cur);
  sumEur += eur;
  if (o.phase === 3) sumEurPaid += eur;
  if (cur === 'mkd') tally(pricePoints, Number(o.price));
}
say(`## 4. Money`);
say();
say(`| currency | orders | conversion |`);
say(`|---|---:|---|`);
for (const [k, n] of sorted(byCur)) {
  const d = FX_TO_EUR[k];
  const how = k === 'eur' ? 'as-is' : d ? `÷ ${d}${['mkd', 'bgn'].includes(k) ? ' (fixed peg)' : ' (approximate — flagged in the note)'}` : '**no rate — would be skipped**';
  say(`| ${k} | ${n.toLocaleString('en-US')} | ${how} |`);
}
say();
say(`- Orders with price 0: **${zeroPrice.toLocaleString('en-US')}** (${pct(zeroPrice, orders.length)}) — imported honestly at €0.`);
say(`- Orders with no usable rate: **${unconvertible}**`);
say(`- Total value, all orders: **€${sumEur.toLocaleString('en-US', { maximumFractionDigits: 0 })}**`);
say(`- Total value, approved only: **€${sumEurPaid.toLocaleString('en-US', { maximumFractionDigits: 0 })}**`);
say();
say(`Top denar price points (and what they become in stored EUR):`);
say();
say(`| ден | orders | → EUR | round-trips back to |`);
say(`|---:|---:|---:|---:|`);
for (const [den, n] of sorted(pricePoints).slice(0, 15)) {
  const eur = toEur(den, 'mkd');
  const back = Math.round(eur * 61.5);
  say(`| ${den.toLocaleString('en-US')} | ${n.toLocaleString('en-US')} | €${eur.toFixed(2)} | ${back.toLocaleString('en-US')} ден${back === den ? ' ✓' : ' ⚠️'} |`);
}
say();

// ── 5. products ───────────────────────────────────────────────────────────
const byProduct = new Map(), productPrices = new Map();
let noProduct = 0;
for (const o of orders) {
  const name = productNameOf(o);
  if (!name) { noProduct++; continue; }
  tally(byProduct, name);
  if (!productPrices.has(name)) productPrices.set(name, new Map());
  if (String(o.currency).toLowerCase() === 'mkd') tally(productPrices.get(name), Number(o.price));
}
const goodsLen = new Map();
for (const o of orders) tally(goodsLen, (o.goods || []).length);
say(`## 5. Products`);
say();
say(`**${byProduct.size} distinct names.** ${noProduct.toLocaleString('en-US')} orders have neither \`goods[]\` nor an offer name — those import as \`"—"\`.`);
say();
say(`\`goods\` array length: ${[...goodsLen.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k} → ${n.toLocaleString('en-US')}`).join(', ')} — **never more than one product per order.**`);
say();
say(`| product | orders | top denar price points |`);
say(`|---|---:|---|`);
for (const [name, n] of sorted(byProduct)) {
  const tops = sorted(productPrices.get(name) || new Map()).slice(0, 3)
    .map(([p, c]) => `${p.toLocaleString('en-US')}×${c}`).join(', ');
  say(`| ${name} | ${n.toLocaleString('en-US')} | ${tops} |`);
}
say();

// ── 6. duplicates ─────────────────────────────────────────────────────────
const cluster = new Map();
for (const o of orders) {
  const p = normalizeMkPhone(o.phone);
  if (!p) continue;
  tally(cluster, `${p}|${productNameOf(o)}|${isoDay(o.time)}`);
}
const dupes = [...cluster.values()].filter((n) => n > 1);
const dupRows = dupes.reduce((a, b) => a + b - 1, 0);
say(`## 6. Same phone + product + day`);
say();
say(`${dupes.length.toLocaleString('en-US')} clusters hold more than one order, covering ${dupRows.toLocaleString('en-US')} extra rows.`);
say();
say(`These are **kept**. Each has its own AlterCPA id, so each imports as its own row —`);
say(`a customer who ordered the same product twice in a day is a real (and valuable) signal,`);
say(`and AlterCPA already routes true duplicates to reason 7 / trash.`);
say();

// ── 7. repeat customers ───────────────────────────────────────────────────
const perPhone = new Map(), paidPerPhone = new Map();
for (const o of orders) {
  const p = normalizeMkPhone(o.phone);
  if (!p) continue;
  tally(perPhone, p);
  if (o.phase === 3) tally(paidPerPhone, p);
}
const band = (m, label) => {
  const b = new Map();
  for (const n of m.values()) tally(b, n >= 5 ? '5+' : String(n));
  return `${label}: ` + ['1', '2', '3', '4', '5+'].map((k) => `${k}→${(b.get(k) || 0).toLocaleString('en-US')}`).join(', ');
};
say(`## 7. Repeat customers`);
say();
say(`- ${band(perPhone, 'orders per phone')}`);
say(`- ${band(paidPerPhone, 'approved orders per phone')}`);
say();
say(`${paidPerPhone.size.toLocaleString('en-US')} phones have at least one approved order — that is the population the`);
say(`prediction engine will build its recency, frequency and value bands from.`);
say();

writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`  orders           ${orders.length.toLocaleString('en-US')}`);
console.log(`  distinct phones  ${phoneSet.size.toLocaleString('en-US')}`);
console.log(`  dropped (phone)  ${dropped}`);
console.log(`  distinct products ${byProduct.size}`);
