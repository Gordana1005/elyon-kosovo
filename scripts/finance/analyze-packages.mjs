#!/usr/bin/env node
/**
 * Realized per-package pricing & margin analysis (READ-ONLY).
 *
 * Recreates the exact Pure Profit math from supabase/functions/api/index.ts
 * (GET /api/management-insights) so its totals reconcile to the Insights screen,
 * then drills into the thing that screen never shows: the REALIZED price the
 * customer actually paid for every single package (order_items.price_per_unit,
 * cash-allocated like the edge fn), its full per-package cost waterfall, and the
 * margin-floor price needed to net a target profit per package.
 *
 * Nothing is written to the database. Outputs:
 *   - console reconciliation + headline stats
 *   - packages-realized-<period>.xlsx  (one row per order line + summary sheets)
 *   - scratchpad/finance-analysis.json (machine-readable, for the report)
 *
 * Usage:
 *   node --env-file=.env scripts/finance/analyze-packages.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--target 7]
 *   default window = the Insights "1 month" preset: from = today-1month, to = today
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';

// ---- args ----
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
const FROM = arg('--from', iso(oneMonthAgo));
const TO = arg('--to', iso(now));
const TARGET = Number(arg('--target', '7'));        // €/package net-profit floor
const TARGET2 = Number(arg('--target2', '8'));      // stretch
const toEnd = `${TO}T23:59:59`;

// ---- env ----
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (run with: node --env-file=.env ...).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---- constants copied verbatim from index.ts ----
const VAT_RATE = 0.20;
const BLENDED_DELIVER_COST = 3.5;
const BLENDED_RETURN_COST = 6.0;
const num = (x) => Number(x || 0);
const r2 = (n) => Math.round(n * 100) / 100;
const packageBonusRate = (u) => (u >= 35 ? 3 : u > 25 ? 2 : 1);
const resolveCourierService = (o) => {
  const dt = o?.delivery_type;
  if (dt === 'speedy_office') return { courier: 'speedy', service: 'office' };
  if (dt === 'econt_office') return { courier: 'econt', service: 'office' };
  const hc = o?.home_courier;
  if (hc === 'speedy' || hc === 'econt') return { courier: hc, service: 'door' };
  return null;
};
const normAgent = (raw) => {
  let n = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!n) return 'Unknown operator';
  n = n.replace(/\s+\p{L}\.?$/u, '').trim();
  return n || 'Unknown operator';
};
const ownerOf = (o) => normAgent(o.confirmed_by_name ?? o.assigned_agent_name);

// ---- paginated fetch ----
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) { console.error('Query failed:', error.message); process.exit(1); }
    out.push(...data);
    if (!data || data.length < 1000) break;
  }
  return out;
}

console.log(`\nPeriod: ${FROM} .. ${TO}  (created_at)`);
console.log('Fetching…');

const orders = await fetchAll(() =>
  supabase.from('orders')
    .select('id,display_id,status,price,quantity,product_name,product_id,customer_city,delivery_type,home_courier,assigned_agent_name,confirmed_by_name,source_type,created_at,order_items(product_name,product_id,quantity,total_price,price_per_unit)')
    .or('source_type.is.null,source_type.neq.monadon_legacy')
    .gte('created_at', FROM)
    .lte('created_at', toEnd));

const products = await fetchAll(() => supabase.from('products').select('id,name,cost_price,price'));
const profiles = await fetchAll(() => supabase.from('profiles').select('user_id,full_name'));
const roleRows = await fetchAll(() => supabase.from('user_roles').select('user_id,role').in('role', ['agent', 'pending_agent', 'prediction_agent', 'admin', 'manager']));
let courierRows = [];
try { const { data } = await supabase.from('courier_rates').select('courier,service,deliver_cost,return_cost'); courierRows = data || []; } catch { /* fallback only */ }

// ---- lookups ----
const costByName = {};
for (const p of products) if (num(p.cost_price) > 0) costByName[p.name] = num(p.cost_price);
const catalogPriceByName = {};
for (const p of products) catalogPriceByName[p.name] = num(p.price);

const agentUserIds = new Set(), superAdminIds = new Set();
for (const r of roleRows) {
  if (r.role === 'admin' || r.role === 'manager') superAdminIds.add(r.user_id);
  else agentUserIds.add(r.user_id);
}
const agentNames = new Set();
for (const p of profiles) if (agentUserIds.has(p.user_id) && !superAdminIds.has(p.user_id)) agentNames.add(normAgent(p.full_name));

const courierRates = {};
for (const r of courierRows) courierRates[`${r.courier}_${r.service}`] = { deliver: num(r.deliver_cost), return_: num(r.return_cost) };
const courierFallback = { deliver: BLENDED_DELIVER_COST, return_: BLENDED_RETURN_COST };
const rateFor = (o) => {
  const cs = resolveCourierService(o);
  const rate = (cs && courierRates[`${cs.courier}_${cs.service}`]) || courierFallback;
  return { rate, label: cs ? `${cs.courier}_${cs.service}` : 'unknown', courier: cs?.courier ?? 'unknown', service: cs?.service ?? '—' };
};

const PAID = (o) => o.status === 'paid';
const costOfName = (_pid, name) => costByName[name] || 0;
const orderCOGS = (o) => {
  const items = o.order_items || [];
  if (items.length) return items.reduce((c, it) => c + costOfName(it.product_id, it.product_name) * (num(it.quantity) || 1), 0);
  return costOfName(o.product_id, o.product_name) * (num(o.quantity) || 1);
};
const orderPackageBonus = (o) => {
  if (o.status !== 'paid') return 0;
  const items = o.order_items || [];
  if (items.length) return items.reduce((t, it) => t + packageBonusRate(num(it.price_per_unit)) * num(it.quantity), 0);
  const units = num(o.quantity) || 1;
  return packageBonusRate(num(o.price) / Math.max(1, units)) * units;
};

// ============================================================
// 1) PURE PROFIT REPLICA  (must reconcile to the Insights screen)
// ============================================================
let paidRevenue = 0, paidCount = 0;
let deliveryCost = 0, returnLoss = 0, cogsPaid = 0, paidPackages = 0;
const logisticsMap = {};
for (const o of orders) {
  if (PAID(o)) { paidRevenue += num(o.price); paidCount++; }
  const st = o.status;
  const shipped = st === 'shipped' || st === 'delivered' || st === 'paid';
  const returned = st === 'returned';
  if (shipped || returned) {
    const { rate, label, courier, service } = rateFor(o);
    const L = (logisticsMap[label] ??= { courier, service, delivered: 0, returned: 0, deliver_cost: 0, return_cost: 0 });
    if (returned) { returnLoss += rate.return_; L.returned++; L.return_cost += rate.return_; }
    else { deliveryCost += rate.deliver; L.delivered++; L.deliver_cost += rate.deliver; }
  }
  if (PAID(o)) { cogsPaid += orderCOGS(o); paidPackages += (o.order_items?.length ? o.order_items.reduce((s, i) => s + num(i.quantity), 0) : (num(o.quantity) || 1)); }
}
const totalCommission = r2(orders.reduce((s, o) => s + (agentNames.has(ownerOf(o)) ? orderPackageBonus(o) : 0), 0));
const commissionAllPaid = r2(orders.reduce((s, o) => s + orderPackageBonus(o), 0)); // ignores owner gate
const vatDue = r2(paidRevenue - paidRevenue / (1 + VAT_RATE));
deliveryCost = r2(deliveryCost); returnLoss = r2(returnLoss); cogsPaid = r2(cogsPaid); paidRevenue = r2(paidRevenue);
const clearProfit = r2(paidRevenue - vatDue - cogsPaid - totalCommission - deliveryCost - returnLoss);

// ============================================================
// 2) REALIZED PER-PACKAGE ROWS  (one row per PAID order line)
// ============================================================
const pkgRows = [];           // { ...line economics }
const allUnitPrices = [];     // expanded per package (for percentiles)
for (const o of orders) {
  if (!PAID(o)) continue;
  const price = num(o.price);
  const { rate, courier, service } = rateFor(o);
  const items = (o.order_items && o.order_items.length) ? o.order_items : [{ product_name: o.product_name, product_id: o.product_id, quantity: num(o.quantity) || 1, price_per_unit: 0, total_price: 0 }];
  const totalPkgs = items.reduce((s, i) => s + num(i.quantity), 0) || 1;
  const w = items.map((it) => { const ppu = num(it.price_per_unit), tp = num(it.total_price), q = num(it.quantity) || 1; return ppu > 0 ? ppu * q : tp > 0 ? tp : q; });
  const tot = w.reduce((s, x) => s + x, 0) || 1;
  const deliverPerPkg = rate.deliver / totalPkgs;     // amortize the single delivery across the order's packages
  items.forEach((it, i) => {
    const q = num(it.quantity);
    if (q <= 0) return;
    const allocated = price * (w[i] / tot);
    const realizedUnit = allocated / q;
    const name = it.product_name || '(unknown)';
    const cogsUnit = costByName[name] ?? null;          // null = unknown cost
    const cogsUnitNum = cogsUnit ?? 0;
    const commUnit = packageBonusRate(realizedUnit);    // what an agent would earn on this package
    const vatUnit = realizedUnit / (1 + VAT_RATE) * VAT_RATE; // = realizedUnit/6 at 20%
    const netUnit = realizedUnit - vatUnit - cogsUnitNum - deliverPerPkg - commUnit;
    pkgRows.push({
      order: o.display_id || o.id, status: o.status, source: o.source_type || 'manual', city: o.customer_city || '',
      owner: ownerOf(o), product: name, qty: q, pkgs_in_order: totalPkgs,
      recorded_ppu: r2(num(it.price_per_unit)), realized_unit_price: r2(realizedUnit),
      cogs_unit: cogsUnit == null ? '' : r2(cogsUnitNum), cost_known: cogsUnit != null,
      delivery_share: r2(deliverPerPkg), commission_unit: commUnit, vat_unit: r2(vatUnit),
      net_profit_unit: r2(netUnit), courier, service,
    });
    for (let k = 0; k < q; k++) allUnitPrices.push(realizedUnit);
  });
}

// ---- stats helpers ----
const pct = (sorted, p) => { if (!sorted.length) return 0; const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1)))); return sorted[idx]; };
function describe(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  return { n, sum: r2(sum), mean: r2(n ? sum / n : 0), min: r2(s[0] || 0), p10: r2(pct(s, 10)), p25: r2(pct(s, 25)), median: r2(pct(s, 50)), p75: r2(pct(s, 75)), p90: r2(pct(s, 90)), max: r2(s[n - 1] || 0) };
}
// group expanded per-package prices by a key function over pkgRows
function groupStats(keyFn) {
  const g = {};
  for (const row of pkgRows) { const k = keyFn(row); (g[k] ??= []).push(...Array(row.qty).fill(row.realized_unit_price)); }
  return Object.entries(g).map(([k, vals]) => ({ key: k, ...describe(vals) })).sort((a, b) => b.n - a.n);
}
const sizeBucket = (n) => (n <= 1 ? '1' : n <= 3 ? '2-3' : n <= 5 ? '4-5' : n <= 7 ? '6-7' : '8+');

const overall = describe(allUnitPrices);
const byProductStats = groupStats((r) => r.product);
const bySizeStats = groupStats((r) => sizeBucket(r.pkgs_in_order));
const bySourceStats = groupStats((r) => r.source);
const byCourierStats = groupStats((r) => `${r.courier} ${r.service}`);
const byOwnerStats = groupStats((r) => r.owner);

// ============================================================
// 3) PER-PRODUCT MARGIN + FLOOR PRICE
// ============================================================
const floorPrice = (cogs, deliver, target) => { // solve P - P/6 - cogs - deliver - m = target, m by tier
  for (const m of [1, 2, 3]) { const P = (1 + VAT_RATE) / 1 * 0 + 1.2 * (target + cogs + deliver + m); if (packageBonusRate(P) === m) return r2(P); }
  return r2(1.2 * (target + cogs + deliver + 3));
};
const prodAgg = {};
for (const row of pkgRows) {
  const m = (prodAgg[row.product] ??= { product: row.product, packages: 0, orders: new Set(), revenue: 0, cogsKnown: row.cost_known, cogsUnit: row.cost_known ? Number(row.cogs_unit) : null, deliverSum: 0, net: 0, vat: 0, comm: 0 });
  m.packages += row.qty; m.orders.add(row.order);
  m.revenue += row.realized_unit_price * row.qty;
  m.deliverSum += row.delivery_share * row.qty;
  m.vat += row.vat_unit * row.qty; m.comm += row.commission_unit * row.qty;
  m.net += row.net_profit_unit * row.qty;
  if (row.cost_known) { m.cogsKnown = true; m.cogsUnit = Number(row.cogs_unit); }
}
const productTable = Object.values(prodAgg).map((m) => {
  const pkgs = m.packages;
  const avgPrice = pkgs ? m.revenue / pkgs : 0;
  const avgDeliver = pkgs ? m.deliverSum / pkgs : 0;
  const cogs = m.cogsUnit ?? 0;
  const netNow = pkgs ? m.net / pkgs : 0;
  const f7 = floorPrice(cogs, avgDeliver, TARGET);
  const f8 = floorPrice(cogs, avgDeliver, TARGET2);
  return {
    product: m.product, packages: pkgs, orders: m.orders.size,
    cost_known: m.cogsKnown, cogs_unit: m.cogsKnown ? r2(cogs) : '',
    avg_realized_price: r2(avgPrice), avg_delivery_share: r2(avgDeliver),
    net_profit_per_pkg_now: r2(netNow), clears_target_now: netNow >= TARGET,
    floor_price_t7: f7, floor_price_t8: f8,
    uplift_to_t7_pct: avgPrice > 0 ? Math.round((f7 / avgPrice - 1) * 100) : null,
  };
}).sort((a, b) => b.packages - a.packages);

// ============================================================
// 4) BUNDLE / GIVEAWAY FORENSICS
// ============================================================
const isPromoName = (name) => { const n = String(name || ''); return / \+ |\+ | x\d|Prostatol\s*\d|Palmetto\s*\d|\d\s*\+\s*|\d\s*x\s*\d/i.test(n) || /\s+\d{1,2}\s*$/.test(n); };
const FREE_RX = /(безплатн|подар|gratis|free|bonus|\bфалас\b|gjphpfgj)/i;
let freePkgs = 0, freeCogs = 0, freeLines = 0;
let zeroOrNearZero = 0;
for (const row of pkgRows) {
  if (row.recorded_ppu === 0 || FREE_RX.test(row.product)) { freeLines++; freePkgs += row.qty; freeCogs += (row.cost_known ? Number(row.cogs_unit) : 0) * row.qty; }
  if (row.realized_unit_price < 1) zeroOrNearZero += row.qty;
}
// realized €/pkg: single-line single-qty orders vs multi-package orders
const singlePkgPrices = [], multiPkgPrices = [];
for (const row of pkgRows) (row.pkgs_in_order <= 1 ? singlePkgPrices : multiPkgPrices).push(...Array(row.qty).fill(row.realized_unit_price));
const bundleForensics = {
  free_lines: freeLines, free_packages: freePkgs, free_cogs_eur: r2(freeCogs),
  packages_under_1eur: zeroOrNearZero,
  single_pkg_orders: describe(singlePkgPrices),
  multi_pkg_orders: describe(multiPkgPrices),
};

// ============================================================
// 5) GAPS & LOSS-MAKERS
// ============================================================
const missingCost = productTable.filter((p) => !p.cost_known).map((p) => ({ product: p.product, packages: p.packages }));
const lossPkgs = pkgRows.filter((r) => r.net_profit_unit < 0).sort((a, b) => a.net_profit_unit - b.net_profit_unit);
const lossSummary = { count_packages: lossPkgs.reduce((s, r) => s + r.qty, 0), worst: lossPkgs.slice(0, 15) };

// ============================================================
// 6) PRICE-FLOOR SCENARIOS  (lift every below-floor package to the floor)
// Commission stays in the €1 tier for floors < €25, so only revenue & VAT move:
//   Δprofit = ΔRevenue × (1 − 1/6)   (the 1/6 going to VAT)
// COGS / delivery / returns / volume held constant (conservative: no demand loss).
// ============================================================
const scenarios = [13, 14, 15, 16].map((floor) => {
  let belowPkgs = 0, upliftRev = 0;
  for (const p of allUnitPrices) { if (p < floor) { belowPkgs++; upliftRev += floor - p; } }
  const newProfit = r2(clearProfit + upliftRev * (1 / (1 + VAT_RATE)));
  const newCash = r2(paidRevenue + upliftRev);
  return {
    floor, packages_below: belowPkgs, pct_below: Math.round((belowPkgs / allUnitPrices.length) * 100),
    extra_cash: r2(upliftRev), new_clear_profit: newProfit, profit_uplift: r2(newProfit - clearProfit),
    profit_uplift_pct: Math.round((newProfit / clearProfit - 1) * 100),
    new_net_per_pkg: r2(newProfit / paidPackages), new_margin_pct: r2((newProfit / newCash) * 100),
  };
});

// ============================================================
// OUTPUT
// ============================================================
const expect = { cash: 7605.66, vat: 1267.61, cogs: 1614.29, delivery: 647.88, returns: 121.18, commission: 509.0, clear: 3445.70, packages: 621, paid_orders: 160 };
const fmt = (n) => `€${Number(n).toFixed(2)}`;
console.log('\n================ PURE PROFIT REPLICA (reconcile to screen) ================');
const line = (label, got, exp) => console.log(`${label.padEnd(22)} ${String(fmt(got)).padStart(12)}   screen ${fmt(exp).padStart(12)}   ${Math.abs(got - exp) <= 0.5 ? 'OK' : 'DIFF'}`);
line('Cash collected', paidRevenue, expect.cash);
line('VAT (20%)', vatDue, expect.vat);
line('COGS', cogsPaid, expect.cogs);
line('Delivery', deliveryCost, expect.delivery);
line('Return loss', returnLoss, expect.returns);
line('Agent commission', totalCommission, expect.commission);
line('Clear profit', clearProfit, expect.clear);
console.log(`Paid orders ${String(paidCount).padStart(10)}   screen ${expect.paid_orders}`);
console.log(`Paid packages ${String(paidPackages).padStart(8)}   screen ${expect.packages}`);
console.log(`Commission (all paid, ignoring agent-gate): ${fmt(commissionAllPaid)}`);

console.log('\n================ REALIZED PRICE PER PACKAGE (paid) ================');
console.log(overall);
console.log(`avg packages/order: ${r2(paidPackages / Math.max(1, paidCount))}`);

console.log('\n--- realized €/pkg by order size bucket ---');
for (const r of bySizeStats) console.log(`${r.key.padEnd(5)} n=${String(r.n).padStart(4)} mean ${fmt(r.mean)} median ${fmt(r.median)} min ${fmt(r.min)} max ${fmt(r.max)}`);

console.log('\n--- bundle / giveaway forensics ---');
console.log(bundleForensics);

console.log('\n--- per-product floor (top 12 by volume) ---');
for (const p of productTable.slice(0, 12)) console.log(`${p.product.slice(0, 26).padEnd(27)} pk=${String(p.packages).padStart(3)} now €/pkg ${fmt(p.avg_realized_price)} net/pkg ${fmt(p.net_profit_per_pkg_now)} → floor€7 ${fmt(p.floor_price_t7)} (${p.uplift_to_t7_pct}% up) ${p.clears_target_now ? 'CLEARS' : 'below'}`);

console.log(`\nMissing cost on ${missingCost.length} sold products; packages sold at a loss: ${lossSummary.count_packages}`);

// ---- JSON for the report ----
const summary = {
  period: { from: FROM, to: TO },
  pure_profit: { paidRevenue, vatDue, cogsPaid, deliveryCost, returnLoss, totalCommission, commissionAllPaid, clearProfit, paidCount, paidPackages, packagesPerOrder: r2(paidPackages / Math.max(1, paidCount)), net_margin_pct: r2((clearProfit / paidRevenue) * 100) },
  per_package: { overall, net_profit_per_pkg_now: r2(clearProfit / Math.max(1, paidPackages)) },
  by_product: productTable, by_size: bySizeStats, by_source: bySourceStats, by_courier: byCourierStats, by_owner: byOwnerStats,
  bundle_forensics: bundleForensics, missing_cost: missingCost, loss: lossSummary, logistics: logisticsMap,
  scenarios, targets: { t7: TARGET, t8: TARGET2 },
};
// Per-product floor scenario: reprice each package up to ITS product's floor.
const floorByProductT7 = {}, floorByProductT8 = {};
for (const p of productTable) { floorByProductT7[p.product] = p.floor_price_t7; floorByProductT8[p.product] = p.floor_price_t8; }
function perProductScenario(floorMap, label) {
  let upliftRev = 0, moved = 0;
  const byProd = {};
  for (const row of pkgRows) {
    const f = floorMap[row.product] || 0;
    if (row.realized_unit_price < f) {
      const u = (f - row.realized_unit_price) * row.qty;
      upliftRev += u; moved += row.qty;
      byProd[row.product] = (byProd[row.product] || 0) + u;
    }
  }
  if (label.includes('€7')) {
    console.log('  per-product uplift (cash):');
    for (const [p, u] of Object.entries(byProd).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${p.slice(0, 28).padEnd(29)} +€${u.toFixed(2)}`);
  }
  const newProfit = r2(clearProfit + upliftRev * (1 / (1 + VAT_RATE)));
  const newCash = r2(paidRevenue + upliftRev);
  return { label, packages_moved: moved, extra_cash: r2(upliftRev), new_clear_profit: newProfit, profit_uplift: r2(newProfit - clearProfit), profit_uplift_pct: Math.round((newProfit / clearProfit - 1) * 100), new_net_per_pkg: r2(newProfit / paidPackages), new_margin_pct: r2((newProfit / newCash) * 100) };
}
const perProductScenarios = [perProductScenario(floorByProductT7, 'per-product floor (€7 target)'), perProductScenario(floorByProductT8, 'per-product floor (€8 target)')];
summary.per_product_scenarios = perProductScenarios;

console.log('\n--- flat price-floor scenarios (hold volume) ---');
for (const s of scenarios) console.log(`floor €${s.floor}: ${s.pct_below}% pkgs below → +${fmt(s.profit_uplift)} profit (+${s.profit_uplift_pct}%) → €${s.new_clear_profit} clear, €${s.new_net_per_pkg}/pkg, ${s.new_margin_pct}% margin`);
console.log('\n--- per-product floor scenarios (each product to its own floor) ---');
for (const s of perProductScenarios) console.log(`${s.label}: +${fmt(s.profit_uplift)} (+${s.profit_uplift_pct}%) → €${s.new_clear_profit} clear, €${s.new_net_per_pkg}/pkg, ${s.new_margin_pct}% margin`);
const scratch = process.env.SCRATCH || '.';
writeFileSync(`${scratch}/finance-analysis.json`, JSON.stringify(summary, null, 2));
console.log(`\nWrote ${scratch}/finance-analysis.json`);

// ---- xlsx ----
const wb = XLSX.utils.book_new();
const add = (name, rows, cols) => { const ws = XLSX.utils.json_to_sheet(rows); if (cols) ws['!cols'] = cols; XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
add('Packages', pkgRows);
add('By Product', productTable);
add('Dist by size', bySizeStats);
add('Dist by source', bySourceStats);
add('Dist by courier', byCourierStats);
add('Dist by agent', byOwnerStats);
add('Loss makers', lossPkgs);
add('Missing cost', missingCost);
const outFile = `packages-realized-${FROM}_to_${TO}.xlsx`;
XLSX.writeFile(wb, outFile);
console.log(`Wrote ${outFile}`);
