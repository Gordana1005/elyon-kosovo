#!/usr/bin/env node
// One-off (re-runnable) Pure-Profit / cost report for a date range.
//
// Prints the actuals breakdown — cash collected, product cost (COGS), agent
// commissions, delivery cost, return loss, clear profit — plus the per-courier
// logistics split, using the SAME math as GET /api/management-insights. If the
// BigArena fee ledger (gagag.xlsx) is present it also reconciles the modeled
// logistics total against the billed total so you can see the accuracy.
//
// Usage (Node 20.6+; project uses v22):
//   node --env-file=.env scripts/cost-report-since-18may.mjs
//   node --env-file=.env scripts/cost-report-since-18may.mjs --from=2026-05-18 --to=2026-06-05
//   node --env-file=.env scripts/cost-report-since-18may.mjs --file=D:/gagag.xlsx
//
// Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const FROM = argVal('from', '2026-05-18');
const TO = argVal('to', new Date().toISOString().slice(0, 10));
const FILE = argVal('file', 'D:/gagag.xlsx');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with:  node --env-file=.env scripts/cost-report-since-18may.mjs');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Money helpers (elyon-currency: fixed peg, dual display) ──
const BGN_PER_EUR = 1.95583;
const eur = (n) => `€${(Math.round(n * 100) / 100).toFixed(2)}`;
const dual = (n) => `${eur(n)} (${(Math.round(n * BGN_PER_EUR * 100) / 100).toFixed(2)} лв)`;
const r2 = (n) => Math.round(n * 100) / 100;

// ── Shared math (mirrors supabase/functions/api/index.ts) ──
const packageBonusRate = (u) => (u >= 35 ? 3 : u > 25 ? 2 : 1);
const orderPackageBonus = (o) => {
  if (!o || o.status !== 'paid') return 0;
  const items = o.order_items || [];
  if (items.length) return items.reduce((s, it) => s + packageBonusRate(Number(it.price_per_unit || 0)) * Number(it.quantity || 0), 0);
  const units = Number(o.quantity || 0) || 1;
  return packageBonusRate(Number(o.price || 0) / Math.max(1, units)) * units;
};
const salesOwnerId = (o) => o.confirmed_by_agent_id ?? o.assigned_agent_id ?? null;
const resolveCourierService = (o) => {
  if (o.delivery_type === 'speedy_office') return { courier: 'speedy', service: 'office' };
  if (o.delivery_type === 'econt_office') return { courier: 'econt', service: 'office' };
  if (o.home_courier === 'speedy' || o.home_courier === 'econt') return { courier: o.home_courier, service: 'door' };
  return null;
};

async function paginate(make) {
  const all = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await make().range(f, f + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  console.log(`\n=== Elyon Pure-Profit report  ${FROM} → ${TO} ===\n`);

  // Rate card (+ blended fallback). If the courier_rates table isn't there yet
  // (migration not applied), use the calibrated seed values so the report is
  // still accurate per courier+service.
  const SEED = {
    econt_office: { deliver: 3.05, return_: 5.32 }, econt_door: { deliver: 4.56, return_: 7.36 },
    speedy_office: { deliver: 2.48, return_: 4.24 }, speedy_door: { deliver: 3.21, return_: 5.70 },
  };
  const { data: rateRows } = await supabase.from('courier_rates').select('courier,service,deliver_cost,return_cost');
  const rates = {};
  for (const r of rateRows || []) rates[`${r.courier}_${r.service}`] = { deliver: Number(r.deliver_cost || 0), return_: Number(r.return_cost || 0) };
  if (!Object.keys(rates).length) { Object.assign(rates, SEED); console.log('(courier_rates table empty/missing — using calibrated seed rates)\n'); }
  const fallback = { deliver: 3.5, return_: 6.0 };

  // Products → unit cost by id and by name.
  const products = await paginate(() => supabase.from('products').select('id,name,cost_price'));
  const costById = {}, costByName = {};
  for (const p of products) { const c = Number(p.cost_price || 0); if (c > 0) { costById[p.id] = c; costByName[p.name] = c; } }
  const unitCost = (pid, name) => costById[pid] ?? costByName[name] ?? 0;

  // Agent user ids (bonus is paid only to real agents). Super-admins (admin/manager)
  // earn €0 even if they also hold an agent role.
  const { data: roleRows2 } = await supabase.from('user_roles').select('user_id, role').in('role', ['agent', 'pending_agent', 'prediction_agent', 'admin', 'manager']);
  const agentIds = new Set(); const superIds = new Set();
  for (const r of roleRows2 || []) { if (r.role === 'admin' || r.role === 'manager') superIds.add(r.user_id); else agentIds.add(r.user_id); }
  for (const id of superIds) agentIds.delete(id);

  // Orders in range.
  const orders = await paginate(() => supabase
    .from('orders')
    .select('id,status,price,quantity,product_id,product_name,delivery_type,home_courier,confirmed_by_agent_id,assigned_agent_id,order_items(product_id,product_name,quantity,price_per_unit)')
    .gte('created_at', FROM)
    .lte('created_at', `${TO}T23:59:59`));

  let cash = 0, cogs = 0, commissions = 0, delivery = 0, returnLoss = 0;
  let paidCount = 0, shippedCount = 0, returnedCount = 0, paidPackages = 0;
  const logi = {};
  const prod = {};
  const addProd = (oid, name, qty, revenue, cost) => {
    const m = (prod[name] ??= { packages: 0, orders: 0, revenue: 0, cogs: 0, _seen: new Set() });
    m.packages += qty; m.revenue += revenue; m.cogs += cost;
    if (!m._seen.has(oid)) { m.orders++; m._seen.add(oid); }
  };
  for (const o of orders) {
    const st = o.status;
    const shipped = st === 'shipped' || st === 'delivered' || st === 'paid';
    const returned = st === 'returned';
    if (shipped || returned) {
      const cs = resolveCourierService(o);
      const rate = (cs && rates[`${cs.courier}_${cs.service}`]) || fallback;
      const label = cs ? `${cs.courier}_${cs.service}` : 'unknown';
      const L = (logi[label] ??= { delivered: 0, returned: 0, deliver_cost: 0, return_cost: 0 });
      if (returned) { returnLoss += rate.return_; L.returned++; L.return_cost += rate.return_; returnedCount++; }
      else { delivery += rate.deliver; L.delivered++; L.deliver_cost += rate.deliver; shippedCount++; }
    }
    if (st === 'paid') {
      paidCount++;
      const price = Number(o.price || 0);
      cash += price;
      const items = o.order_items || [];
      if (items.length) {
        const w = items.map((it) => {
          const ppu = Number(it.price_per_unit || 0), tp = Number(it.total_price || 0), q = Number(it.quantity) || 1;
          return ppu > 0 ? ppu * q : tp > 0 ? tp : q;
        });
        const tot = w.reduce((s, x) => s + x, 0) || 1;
        items.forEach((it, i) => {
          const q = Number(it.quantity) || 1, u = unitCost(it.product_id, it.product_name);
          cogs += u * q; paidPackages += q;
          addProd(o.id, it.product_name || '(unknown)', q, price * (w[i] / tot), u * q);
        });
      } else {
        const q = Number(o.quantity || 0) || 1, u = unitCost(o.product_id, o.product_name);
        cogs += u * q; paidPackages += q;
        addProd(o.id, o.product_name || '(unknown)', q, price, u * q);
      }
      if (agentIds.has(salesOwnerId(o))) commissions += orderPackageBonus(o);
    }
  }
  const clear = r2(cash - cogs - commissions - delivery - returnLoss);

  console.log(`Orders in range: ${orders.length}   (paid ${paidCount}, shipped-not-returned ${shippedCount}, returned ${returnedCount})\n`);
  console.log('PURE PROFIT (actuals — money in vs out)');
  console.log('  + Cash collected (paid)      ', dual(cash));
  console.log('  − Product cost (COGS)        ', dual(cogs));
  console.log('  − Agent commissions (agents) ', dual(commissions));
  console.log('  − Delivery cost (shipped)    ', dual(delivery));
  console.log('  − Return loss (round-trip)   ', dual(returnLoss));
  console.log('  ───────────────────────────');
  console.log('  = CLEAR PROFIT               ', dual(clear), '\n');

  console.log(`PRODUCT BREAKDOWN (paid orders)   ${paidCount} orders · ${paidPackages} packages · ${(paidPackages / Math.max(1, paidCount)).toFixed(1)} per order`);
  for (const [name, m] of Object.entries(prod).sort((a, b) => b[1].packages - a[1].packages)) {
    const unit = m.packages > 0 ? m.revenue / m.packages : 0;
    console.log(`  ${name.slice(0, 32).padEnd(34)} ${String(m.packages).padStart(3)} pkg × ${eur(unit).padStart(7)}   rev ${eur(m.revenue).padStart(9)}  cost ${eur(m.cogs).padStart(8)}  profit ${eur(m.revenue - m.cogs)}`);
  }
  console.log('');

  console.log('LOGISTICS SPEND BY COURIER');
  let modeledLogi = 0;
  for (const [k, L] of Object.entries(logi).sort((a, b) => (b[1].deliver_cost + b[1].return_cost) - (a[1].deliver_cost + a[1].return_cost))) {
    const total = L.deliver_cost + L.return_cost;
    modeledLogi += total;
    console.log(`  ${k.padEnd(14)}  del ${String(L.delivered).padStart(3)} / ret ${String(L.returned).padStart(3)}   ${eur(L.deliver_cost).padStart(9)} + ${eur(L.return_cost).padStart(8)} = ${eur(total)}`);
  }
  console.log(`  TOTAL modeled logistics: ${dual(modeledLogi)}\n`);

  // Reconcile against the BigArena fee ledger if present.
  if (existsSync(FILE)) {
    const wb = XLSX.read(readFileSync(FILE), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    let billed = 0; const byType = {}; const fileOrders = new Set();
    for (const row of rows) {
      const amt = Number(row['Amount'] || 0); billed += amt;
      const t = row['Fee Type'] || '(none)'; byType[t] = (byType[t] || 0) + amt;
      if (row['Fulfillment Order ID'] != null) fileOrders.add(row['Fulfillment Order ID']);
    }
    const modeledShipments = shippedCount + returnedCount;
    console.log('RECONCILE vs BigArena fee ledger', FILE);
    for (const [t, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(26)} ${eur(v)}`);
    console.log(`  BILLED TOTAL (file):     ${eur(billed)}  over ${fileOrders.size} fulfilment orders  → avg ${eur(billed / Math.max(1, fileOrders.size))}/order`);
    console.log(`  MODELED TOTAL (rates):   ${eur(modeledLogi)}  over ${modeledShipments} CRM shipments     → avg ${eur(modeledLogi / Math.max(1, modeledShipments))}/shipment`);
    console.log('  ↳ totals differ because they cover different order sets; the per-order AVERAGE is the');
    console.log('    accuracy check — our default rate should land within a few cents of the billed avg.');
    console.log('  (file bills returns as the return leg only; the model charges the full round-trip,');
    console.log('   and the file has no shared key with CRM orders — it calibrates the rate card.)\n');
  } else {
    console.log(`(fee ledger not found at ${FILE} — skipping reconciliation)\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
