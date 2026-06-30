// Backfill: split storefront bundle order lines into real catalogue products,
// and normalize line names to the catalogue spelling.
//
// "Brain 4" and "Prostatol 3 + Palmetto 1" are OpenCart promo names stored
// verbatim on order_items — they pollute the Pure Profit product breakdown as
// fake products with no cost. This script rewrites those lines into their real
// components (money split by catalogue-price weights, component totals summing
// EXACTLY to the original line total) and renames variant spellings
// ("Curcumactiv" → "Curcumactiv (500ml)") to the catalogue name.
//
// SAFETY:
//  - Never touches orders.status or orders.price; stock is untouched (stock
//    moves only in API status-flip handlers — bundle lines had product_id NULL,
//    so nothing was ever decremented for them and nothing is decremented now).
//  - Dry-run by default; --commit writes, after saving a rollback JSON with the
//    verbatim original rows.
//  - Reports the agent-bonus delta on affected PAID orders (bonus is per
//    package tiered by line unit price, so splitting changes it — intended).
//
//   node --env-file=.env scripts/backfill-bundle-order-items.mjs
//   node --env-file=.env scripts/backfill-bundle-order-items.mjs --since=2026-05-01 --commit
//
// --since=YYYY-MM-DD limits the rewrite to orders created on/after that date
// (operator decision 2026-06-11: history before 1 May stays as-is).
//
// Rollback: for each entry in the rollback JSON, delete the order's current
// order_items rows whose ids are NOT in `items` and re-insert `items` verbatim,
// then restore orders.product_name / orders.quantity from `order`.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || null;
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PAGE = 1000;
const r2 = (n) => Math.round(n * 100) / 100;

// ── Keep in sync with OPENCART_BUNDLES / OPENCART_NAME_ALIASES in
//    supabase/functions/api/index.ts ──
const BUNDLES = {
  'brain 4': [{ sku: 'NT0063', qty: 4 }],                                              // 4× Brain active (30cps)
  'brain 2': [{ sku: 'NT0063', qty: 2 }],
  'prostatol 4': [{ sku: 'NT0004', qty: 4 }],                                          // 4× Простатол Комплекс
  'prostatol 3 + palmetto 1': [{ sku: 'NT0004', qty: 3 }, { sku: 'NT0055', qty: 1 }],  // 3× Простатол + 1× SAW Palmetto
  'diabetol 4': [{ sku: 'NT0002', qty: 4 }],                                           // 4× Диабетол Форте
  'curcumactiv 2+1snail': [{ sku: 'NT0057', qty: 2 }, { sku: 'NT0025', qty: 1 }],      // 2× Curcumactiv + 1× Snail Complex
  'creatine monohydrate (1+1) + tribulus terrestris безплатно': [{ sku: 'NT0103', qty: 2 }, { sku: 'NT0097', qty: 1 }],
  'slim complex + 2x slim fiber - натурални хапчета за отслабване': [{ sku: 'NT0053', qty: 1 }, { sku: 'NT0054', qty: 2 }],
};
const NAME_ALIASES = {
  'matcha collagen': 'NT0145',
  'neuro active': '5310416001160',
  'prostatol': 'NT0004',
  'creatine monohydrate': 'NT0103',
  'diet shake с вкус на шоколад': 'NT0100',
};
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const matchBundle = (name) => BUNDLES[norm(name)] ?? null;

// Mirror of allocateBundlePrice in the edge function: weight by catalogue
// price × qty, round to cents, remainder on the first line → exact total.
function allocate(lineTotal, comps) {
  const weights = comps.map((c) => (c.cataloguePrice > 0 ? c.cataloguePrice * c.compQty : c.compQty));
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  const totals = comps.map((_c, i) => r2(lineTotal * (weights[i] / wSum)));
  totals[0] = r2(totals[0] + r2(lineTotal - totals.reduce((s, t) => s + t, 0)));
  return comps.map((c, i) => ({
    total_price: totals[i],
    price_per_unit: c.compQty > 0 ? r2(totals[i] / c.compQty) : 0,
  }));
}

// Mirror of resolveCatalogueProductId: curated aliases, then longest
// substring match either direction. Used for variant-name normalization.
function resolveProduct(rawName, catalogue) {
  const key = norm(rawName);
  if (!key) return null;
  for (const alias in NAME_ALIASES) {
    if (key.includes(alias)) {
      const p = catalogue.find((c) => c.sku === NAME_ALIASES[alias]);
      if (p) return p;
    }
  }
  let best = null;
  for (const c of catalogue) {
    const n = norm(c.name);
    if (!n) continue;
    if (key.includes(n) || n.includes(key)) {
      if (!best || n.length > norm(best.name).length) best = c;
    }
  }
  return best;
}

// REPORT-ONLY mirror of packageBonusRate/orderPackageBonus (the calc sites of
// record are the shared helpers in the edge function — this exists purely so
// the dry-run can show the operator the bonus delta before committing).
const bonusRate = (unit) => (unit >= 35 ? 3 : unit > 25 ? 2 : 1);
const itemsBonus = (items) => items.reduce((s, it) => s + bonusRate(Number(it.price_per_unit || 0)) * Number(it.quantity || 0), 0);

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}${SINCE ? ` · orders created since ${SINCE}` : ''}`);

const { data: products, error: pErr } = await sb.from('products').select('id, sku, name, price, cost_price');
if (pErr) { console.error(pErr.message); process.exit(1); }
const bySku = new Map(products.map((p) => [p.sku, p]));
const byId = new Map(products.map((p) => [p.id, p]));

// Every bundle component must exist in the catalogue or we abort outright.
for (const [bname, comps] of Object.entries(BUNDLES)) {
  for (const c of comps) {
    if (!bySku.has(c.sku)) { console.error(`ABORT: bundle "${bname}" component SKU ${c.sku} not in products`); process.exit(1); }
  }
}

const items = await pageAll((a, b) => sb.from('order_items')
  .select('id, order_id, product_id, product_name, quantity, price_per_unit, total_price')
  .order('id').range(a, b));
const orders = await pageAll((a, b) => sb.from('orders')
  .select('id, display_id, status, product_name, quantity, price, created_at')
  .order('id').range(a, b));
const orderById = new Map(orders.map((o) => [o.id, o]));
console.log(`Scanned: ${orders.length} orders · ${items.length} order_items`);

const itemsByOrder = new Map();
for (const it of items) {
  if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
  itemsByOrder.get(it.order_id).push(it);
}

// ── Classify every order: does any of its lines need a rewrite? ──
// plan = { order, oldItems, newItems, kinds: Set<'bundle'|'variant'> }
const plans = [];
const bundleCounts = {};
let variantRenames = 0;
let multiplierLines = 0;
// Trailing count ("Prostatol 3") or additive promo ("2+1", "1+1+1Snail").
const QTY_BEARING = /(\s\d{1,2}\s*$)|(\d\s*\+)|(\+\s*\d)/;
const qtyBearing = new Map();

for (const [orderId, oldItems] of itemsByOrder) {
  const order = orderById.get(orderId);
  if (!order) continue;
  if (SINCE && String(order.created_at || '').slice(0, 10) < SINCE) continue;
  const newItems = [];
  const kinds = new Set();

  for (const it of oldItems) {
    const bundle = matchBundle(it.product_name);
    if (bundle) {
      const lineQty = Number(it.quantity) || 1;
      const ppu = Number(it.price_per_unit) || 0;
      const T = Number(it.total_price) > 0 ? r2(Number(it.total_price)) : r2(ppu * lineQty);
      // NOTE: stored bundle lines carry the qty the webhook saved (often already
      // the package count). Components multiply the BUNDLE count, which is
      // qty ÷ Σ component packages when the stored qty is the package total,
      // else qty itself. Detect: if qty is divisible by the bundle's package
      // sum, treat it as package-total; otherwise as bundle count.
      const pkgSum = bundle.reduce((s, b) => s + b.qty, 0);
      const bundleCount = lineQty % pkgSum === 0 ? lineQty / pkgSum : lineQty;
      const comps = bundle.map((b) => {
        const p = bySku.get(b.sku);
        return { product: p, compQty: b.qty * bundleCount, cataloguePrice: Number(p.price) || 0 };
      });
      const money = allocate(T, comps);
      comps.forEach((c, i) => newItems.push({
        order_id: orderId,
        product_id: c.product.id,
        product_name: c.product.name,
        quantity: c.compQty,
        price_per_unit: money[i].price_per_unit,
        total_price: money[i].total_price,
      }));
      kinds.add('bundle');
      bundleCounts[norm(it.product_name)] = (bundleCounts[norm(it.product_name)] || 0) + 1;
      continue;
    }

    // Leading-multiplier marketing names: "3X Curcumactiv (500ml) - сироп…" is
    // 3 packages of one product — multiply qty, divide ppu, keep total exact.
    const multi = String(it.product_name || '').trim().match(/^(\d{1,2})\s*[xх×]\s+(.+)$/i);
    if (multi) {
      const prod = resolveProduct(multi[2], products);
      if (prod) {
        const mult = parseInt(multi[1], 10);
        const lineQty = Number(it.quantity) || 1;
        const T = Number(it.total_price) > 0 ? r2(Number(it.total_price)) : r2((Number(it.price_per_unit) || 0) * lineQty);
        const q = mult * lineQty;
        newItems.push({
          order_id: orderId, product_id: prod.id, product_name: prod.name,
          quantity: q, price_per_unit: r2(T / q), total_price: T,
        });
        kinds.add('multiplier');
        multiplierLines++;
        continue;
      }
    }

    // Variant-name normalization: line resolves to a catalogue product whose
    // name differs from the stored one → adopt the catalogue name (+ id).
    // EXCLUDED: promo names that carry a package count ("Prostatol 3",
    // "Diabetol 2+1", "Curcumactiv 1+1+1Snail") — renaming those without
    // decomposing the quantity would hide multi-package orders inside a
    // qty-1 line. They're reported separately for an operator decision.
    const resolved = it.product_id ? byId.get(it.product_id) : resolveProduct(it.product_name, products);
    if (resolved && resolved.name && norm(resolved.name) !== norm(it.product_name)) {
      if (QTY_BEARING.test(it.product_name || '')) {
        qtyBearing.set(norm(it.product_name), (qtyBearing.get(norm(it.product_name)) || 0) + 1);
        newItems.push(it);
        continue;
      }
      newItems.push({ ...it, product_id: resolved.id, product_name: resolved.name });
      kinds.add('variant');
      variantRenames++;
      continue;
    }

    newItems.push(it); // untouched
  }

  if (kinds.size > 0) plans.push({ order, oldItems, newItems, kinds });
}

// Itemless legacy orders whose own product_name is a bundle — report only.
const itemlessBundles = orders.filter((o) => !itemsByOrder.has(o.id) && matchBundle(o.product_name));

// ── Dry-run report ──
const byStatus = {};
for (const p of plans) byStatus[p.order.status] = (byStatus[p.order.status] || 0) + 1;
console.log(`\nOrders to rewrite: ${plans.length}`);
console.log(`  by status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}`);
console.log(`  bundle lines: ${Object.entries(bundleCounts).map(([k, v]) => `"${k}"×${v}`).join(' · ') || '—'}`);
console.log(`  variant renames (safe, no count in name): ${variantRenames}`);
console.log(`  leading-multiplier lines ("3X <product>"): ${multiplierLines}`);
if (qtyBearing.size) {
  const top = [...qtyBearing.entries()].sort((a, b) => b[1] - a[1]);
  const total = top.reduce((s, [, v]) => s + v, 0);
  console.log(`  EXCLUDED quantity-bearing promo names (need decomposition rules — NOT touched): ${total} lines, ${top.length} distinct`);
  for (const [name, count] of top.slice(0, 25)) console.log(`      ${count.toString().padStart(5)} × "${name}"`);
  if (top.length > 25) console.log(`      … and ${top.length - 25} more distinct names`);
}
const inFlight = plans.filter((p) => ['shipped', 'delivered'].includes(p.order.status) && (p.kinds.has('bundle') || p.kinds.has('multiplier')));
console.log(`  shipped/delivered bundle orders (return-later stock edge — review): ${inFlight.length}`);
if (itemlessBundles.length) {
  console.log(`  ITEMLESS bundle orders (NOT touched — manual review): ${itemlessBundles.map((o) => o.display_id).join(', ')}`);
}

// Bonus delta on PAID orders (report-only; the gate is status=paid).
let oldBonus = 0, newBonus = 0;
for (const p of plans) {
  if (p.order.status !== 'paid') continue;
  oldBonus += itemsBonus(p.oldItems);
  newBonus += itemsBonus(p.newItems);
}
console.log(`  agent-bonus delta on paid orders: €${r2(oldBonus)} → €${r2(newBonus)} (Δ ${r2(newBonus - oldBonus) >= 0 ? '+' : ''}€${r2(newBonus - oldBonus)})`);

// Money invariant: per order, Σ new totals must equal Σ old totals.
for (const p of plans) {
  const a = r2(p.oldItems.reduce((s, i) => s + (Number(i.total_price) || (Number(i.price_per_unit) || 0) * (Number(i.quantity) || 1)), 0));
  const b = r2(p.newItems.reduce((s, i) => s + Number(i.total_price || 0), 0));
  if (Math.abs(a - b) > 0.01) { console.error(`ABORT: money drift on order ${p.order.display_id}: ${a} → ${b}`); process.exit(1); }
}

console.log('\nSample (first 8):');
for (const p of plans.slice(0, 8)) {
  console.log(`  ${p.order.display_id} (${p.order.status}) [${[...p.kinds].join('+')}]`);
  for (const it of p.oldItems) console.log(`    − ${it.quantity}× ${it.product_name} @ €${it.price_per_unit} (= €${it.total_price})`);
  for (const it of p.newItems) console.log(`    + ${it.quantity}× ${it.product_name} @ €${it.price_per_unit} (= €${it.total_price})`);
}

if (plans.length === 0) { console.log('\nNothing to backfill.'); process.exit(0); }
if (!COMMIT) { console.log('\nRe-run with --commit to apply.'); process.exit(0); }

// ── Rollback snapshot, then rewrite per order ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rollbackPath = `scripts/backfill-bundle-rollback-${stamp}.json`;
writeFileSync(rollbackPath, JSON.stringify(plans.map((p) => ({
  order: { id: p.order.id, display_id: p.order.display_id, product_name: p.order.product_name, quantity: p.order.quantity },
  items: p.oldItems,
})), null, 2));
console.log(`\nRollback snapshot: ${rollbackPath}`);

let done = 0, failed = 0;
for (const p of plans) {
  // Insert the new lines FIRST, then delete the old ones — if the delete fails
  // we'd rather have doubled lines (visible, fixable from the rollback file)
  // than an order with no items at all.
  const inserts = p.newItems.map((it) => ({
    order_id: p.order.id,
    product_id: it.product_id ?? null,
    product_name: it.product_name,
    quantity: it.quantity,
    price_per_unit: it.price_per_unit,
    total_price: it.total_price,
  }));
  const { error: insErr } = await sb.from('order_items').insert(inserts);
  if (insErr) { failed++; console.warn(`  ${p.order.display_id}: insert failed — ${insErr.message}`); continue; }
  const { error: delErr } = await sb.from('order_items').delete().in('id', p.oldItems.map((i) => i.id));
  if (delErr) { failed++; console.warn(`  ${p.order.display_id}: DELETE FAILED (doubled lines!) — ${delErr.message}`); continue; }
  // Keep the order's denormalized summary in step (same join the webhook uses).
  const { error: updErr } = await sb.from('orders').update({
    product_name: p.newItems.map((i) => i.product_name).join(', '),
    quantity: p.newItems.reduce((s, i) => s + Number(i.quantity || 0), 0),
  }).eq('id', p.order.id);
  if (updErr) { failed++; console.warn(`  ${p.order.display_id}: order summary update failed — ${updErr.message}`); continue; }
  done++;
  if (done % 25 === 0) process.stdout.write(`\r  rewritten ${done}/${plans.length}`);
}
console.log(`\n\nDone — orders rewritten: ${done}, failed: ${failed}`);
console.log(`Rollback file: ${rollbackPath}`);
