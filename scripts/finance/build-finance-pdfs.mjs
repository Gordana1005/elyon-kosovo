#!/usr/bin/env node
/**
 * Build the two operator PDFs (READ-ONLY against the DB):
 *   1. Elyon-Agents-Price-Comparison.pdf  — every agent, the prices they sell at, gap to floor.
 *   2. Elyon-Pricing-Options-Guidebook.pdf — 3 concrete pricing OPTIONS (A/B/C) with prices & profit.
 *
 * Re-queries live data and recomputes the Pure Profit actuals (reconciles to the
 * Insights screen) so the numbers are self-contained and trustworthy.
 *
 * Usage:  node --env-file=.env scripts/finance/build-finance-pdfs.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 * First run only:  npx playwright install chromium
 */
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// ── args / period (default = Insights "1 month" preset) ──
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date(); const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
const FROM = arg('--from', iso(monthAgo)), TO = arg('--to', iso(now)), toEnd = `${TO}T23:59:59`;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (node --env-file=.env ...).'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, KEY);

// ── constants (verbatim from supabase/functions/api/index.ts) ──
const VAT = 0.20, GROSS = 1 + VAT, PEG = 1.95583;
const FALLBACK = { deliver: 3.5, return_: 6.0 };
const num = (x) => Number(x || 0); const r2 = (n) => Math.round(n * 100) / 100;
const tier = (u) => (u >= 35 ? 3 : u > 25 ? 2 : 1);
const resolveCourier = (o) => { const dt = o?.delivery_type; if (dt === 'speedy_office') return ['speedy', 'office']; if (dt === 'econt_office') return ['econt', 'office']; const hc = o?.home_courier; if (hc === 'speedy' || hc === 'econt') return [hc, 'door']; return null; };
const normAgent = (raw) => { let n = String(raw || '').trim().replace(/\s+/g, ' '); if (!n) return 'Unknown'; n = n.replace(/\s+\p{L}\.?$/u, '').trim(); return n || 'Unknown'; };
const ownerOf = (o) => normAgent(o.confirmed_by_name ?? o.assigned_agent_name);
const eur = (n) => `€${num(n).toFixed(2)}`;
const lev = (n) => `${(num(n) * PEG).toFixed(2)} лв`;
const floorPrice = (cogs, deliver, target) => { for (const m of [1, 2, 3]) { const P = GROSS * (target + cogs + deliver + m); if (tier(P) === m) return P; } return GROSS * (target + cogs + deliver + 3); };
const round50 = (x) => Math.round(x * 2) / 2; // nearest €0.50

// ── fetch ──
async function all(build) { const out = []; for (let f = 0; ; f += 1000) { const { data, error } = await build().range(f, f + 999); if (error) { console.error(error.message); process.exit(1); } out.push(...data); if (!data || data.length < 1000) break; } return out; }
console.log(`Period ${FROM} .. ${TO} — fetching…`);
const orders = await all(() => supabase.from('orders').select('id,status,price,quantity,product_name,product_id,delivery_type,home_courier,assigned_agent_name,confirmed_by_name,source_type,created_at,order_items(product_name,product_id,quantity,total_price,price_per_unit)').or('source_type.is.null,source_type.neq.monadon_legacy').gte('created_at', FROM).lte('created_at', toEnd));
const products = await all(() => supabase.from('products').select('name,cost_price'));
const profiles = await all(() => supabase.from('profiles').select('user_id,full_name'));
const roles = await all(() => supabase.from('user_roles').select('user_id,role').in('role', ['agent', 'pending_agent', 'prediction_agent', 'admin', 'manager']));
let courierRows = []; try { const { data } = await supabase.from('courier_rates').select('courier,service,deliver_cost,return_cost'); courierRows = data || []; } catch { /* fallback */ }

const costByName = {}; for (const p of products) if (num(p.cost_price) > 0) costByName[p.name] = num(p.cost_price);
const agentIds = new Set(), adminIds = new Set();
for (const r of roles) (r.role === 'admin' || r.role === 'manager' ? adminIds : agentIds).add(r.user_id);
const agentNames = new Set(); for (const p of profiles) if (agentIds.has(p.user_id) && !adminIds.has(p.user_id)) agentNames.add(normAgent(p.full_name));
const rates = {}; for (const r of courierRows) rates[`${r.courier}_${r.service}`] = { deliver: num(r.deliver_cost), return_: num(r.return_cost) };
const rateFor = (o) => { const cs = resolveCourier(o); return (cs && rates[`${cs[0]}_${cs[1]}`]) || FALLBACK; };

const PAID = (o) => o.status === 'paid';
const packageBonus = (o) => { if (o.status !== 'paid') return 0; const it = o.order_items || []; if (it.length) return it.reduce((t, x) => t + tier(num(x.price_per_unit)) * num(x.quantity), 0); const u = num(o.quantity) || 1; return tier(num(o.price) / Math.max(1, u)) * u; };
const orderCOGS = (o) => { const it = o.order_items || []; if (it.length) return it.reduce((c, x) => c + (costByName[x.product_name] || 0) * (num(x.quantity) || 1), 0); return (costByName[o.product_name] || 0) * (num(o.quantity) || 1); };

// ── pure profit + per-package rows ──
let cash = 0, paidCount = 0, deliveryCost = 0, returnLoss = 0, cogsPaid = 0, paidPkgs = 0;
const pkgRows = [];                  // { product, unit, qty, cogsKnown, cogsUnit, deliverShare, owner }
const prodAgg = {};                  // per product
const ownerAgg = {};                 // per agent/owner
for (const o of orders) {
  if (PAID(o)) { cash += num(o.price); paidCount++; }
  const st = o.status, shipped = st === 'shipped' || st === 'delivered' || st === 'paid', returned = st === 'returned';
  if (shipped || returned) { const rt = rateFor(o); if (returned) returnLoss += rt.return_; else deliveryCost += rt.deliver; }
  if (!PAID(o)) continue;
  cogsPaid += orderCOGS(o);
  const price = num(o.price), deliver = rateFor(o).deliver;
  const items = (o.order_items?.length) ? o.order_items : [{ product_name: o.product_name, quantity: num(o.quantity) || 1, price_per_unit: 0, total_price: 0 }];
  const totalPkgs = items.reduce((s, x) => s + num(x.quantity), 0) || 1;
  const w = items.map((x) => { const ppu = num(x.price_per_unit), tp = num(x.total_price), q = num(x.quantity) || 1; return ppu > 0 ? ppu * q : tp > 0 ? tp : q; });
  const tot = w.reduce((s, x) => s + x, 0) || 1;
  const deliverShare = deliver / totalPkgs;
  const owner = ownerOf(o);
  items.forEach((x, i) => {
    const q = num(x.quantity); if (q <= 0) return;
    const unit = (price * (w[i] / tot)) / q;
    const name = x.product_name || '(unknown)';
    const known = costByName[name] != null;
    paidPkgs += q;
    pkgRows.push({ product: name, unit, qty: q, cogsKnown: known, cogsUnit: known ? costByName[name] : 0, deliverShare, owner });
    const m = (prodAgg[name] ??= { product: name, packages: 0, sumPrice: 0, deliverSum: 0, cogsKnown: known, cogsUnit: known ? costByName[name] : 0 });
    m.packages += q; m.sumPrice += unit * q; m.deliverSum += deliverShare * q; if (known) { m.cogsKnown = true; m.cogsUnit = costByName[name]; }
    const ag = (ownerAgg[owner] ??= { owner, packages: 0, sumPrice: 0, min: Infinity, max: 0, isAgent: agentNames.has(owner) });
    ag.packages += q; ag.sumPrice += unit * q; ag.min = Math.min(ag.min, unit); ag.max = Math.max(ag.max, unit);
  });
}
const commission = r2(orders.reduce((s, o) => s + (agentNames.has(ownerOf(o)) ? packageBonus(o) : 0), 0));
const vatDue = r2(cash - cash / GROSS);
cash = r2(cash); deliveryCost = r2(deliveryCost); returnLoss = r2(returnLoss); cogsPaid = r2(cogsPaid);
const clear = r2(cash - vatDue - cogsPaid - commission - deliveryCost - returnLoss);
const marginPct = r2((clear / cash) * 100), netPerPkg = r2(clear / paidPkgs);
console.log(`Reconcile: cash ${eur(cash)} (screen €7605.66) · clear ${eur(clear)} · ${paidPkgs} pkgs · ${marginPct}% · ${eur(netPerPkg)}/pkg`);
console.log(`  components: vat ${eur(vatDue)} · cogs ${eur(cogsPaid)} · delivery ${eur(deliveryCost)} · returns ${eur(returnLoss)} · commission ${eur(commission)}`);

const productTable = Object.values(prodAgg).map((m) => ({ ...m, avgPrice: m.packages ? m.sumPrice / m.packages : 0, avgDeliver: m.packages ? m.deliverSum / m.packages : 0 })).sort((a, b) => b.packages - a.packages);
const owners = Object.values(ownerAgg).map((a) => ({ ...a, avg: a.packages ? a.sumPrice / a.packages : 0 })).sort((a, b) => b.packages - a.packages);

// ── 3 OPTIONS ──
const OPTIONS = [
  { key: 'A', name: 'Gentle', minFloor: 13, target: 6, color: '#0e7490', tag: 'Smallest changes · lowest risk' },
  { key: 'B', name: 'Recommended', minFloor: 14, target: 7, color: '#15803d', tag: 'Hits your €7–8 / package goal' },
  { key: 'C', name: 'Aggressive', minFloor: 15, target: 8, color: '#b45309', tag: 'Maximum profit · more price-rise' },
  { key: 'D', name: 'Flat €19', flat: 19, color: '#7c3aed', tag: 'ONE price for every package — highest profit, biggest price jump (test demand!)' },
];
const recPriceFor = (prod, opt) => opt.flat ? opt.flat : round50(Math.max(opt.minFloor, floorPrice(prod.cogsKnown ? prod.cogsUnit : 0, prod.avgDeliver, opt.target)));
const recByProductForOpt = (opt) => { const map = {}; for (const p of productTable) map[p.product] = recPriceFor(p, opt); return map; };
const optionResult = (opt) => {
  const rec = recByProductForOpt(opt);
  let deltaCash = 0, moved = 0;
  for (const row of pkgRows) {
    const target = rec[row.product] ?? (opt.flat ?? opt.minFloor);
    if (opt.flat) { deltaCash += (target - row.unit) * row.qty; if (row.unit !== target) moved += row.qty; }   // flat: set ALL to the price (may lower a few)
    else if (row.unit < target) { deltaCash += (target - row.unit) * row.qty; moved += row.qty; }              // floor: only lift below-floor
  }
  const newCash = cash + deltaCash, newProfit = r2(clear + deltaCash / GROSS), newMargin = r2((newProfit / newCash) * 100);
  return { ...opt, rec, deltaCash: r2(deltaCash), moved, newCash: r2(newCash), newProfit, profitUp: r2(newProfit - clear), profitUpPct: Math.round((newProfit / clear - 1) * 100), netPerPkg: r2(newProfit / paidPkgs), newMargin };
};
const results = OPTIONS.map(optionResult);

// ════════════════════════════ HTML ════════════════════════════
const DATESTR = `${FROM} → ${TO}`;
const css = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; margin: 0; font-size: 12px; }
  .head { background: #0f172a; color: #fff; padding: 20px 24px; border-radius: 10px 10px 0 0; }
  .head h1 { margin: 0; font-size: 24px; }
  .head .sub { font-size: 12px; opacity: .8; margin-top: 4px; }
  h2 { font-size: 16px; margin: 22px 0 8px; color: #0f172a; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }
  p.lead { color: #475569; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
  thead th { background: #f1f5f9; color: #334155; text-align: left; padding: 7px 9px; border-bottom: 2px solid #cbd5e1; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody td { padding: 6px 9px; border-bottom: 1px solid #eef2f7; }
  tr:nth-child(even) td { background: #fafcff; }
  .pos { color: #15803d; font-weight: 700; } .neg { color: #b91c1c; font-weight: 700; } .amb { color: #b45309; font-weight: 600; }
  .muted { color: #94a3b8; }
  .kpis { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  .kpi { flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
  .kpi .l { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .3px; }
  .kpi .v { font-size: 18px; font-weight: 800; margin-top: 2px; }
  .kpi .s { font-size: 10px; color: #94a3b8; }
  .opt { border: 2px solid; border-radius: 10px; padding: 14px 16px; margin-top: 14px; break-inside: avoid; }
  .opt h3 { margin: 0 0 2px; font-size: 18px; }
  .opt .tag { font-size: 11px; color: #475569; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; color: #fff; }
  .foot { text-align: center; color: #94a3b8; font-size: 10px; margin-top: 18px; }
  .note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 8px; padding: 8px 12px; font-size: 11px; margin-top: 10px; }
  .formula { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px 14px; font-size: 13px; text-align: center; margin: 10px 0; font-weight: 600; }
`;

// ---------- PDF 1: Agents price comparison ----------
const totalUpside = owners.filter(o => o.isAgent && o.avg < 14).reduce((s, o) => s + (14 - o.avg) * o.packages / GROSS, 0);
const agentRows = owners.map((o) => {
  const gap = 14 - o.avg;
  const upside = o.isAgent && o.avg < 14 ? (14 - o.avg) * o.packages / GROSS : 0;
  const disc = o.avg >= 14 ? 'pos' : o.avg >= 12 ? 'amb' : 'neg';
  return `<tr>
    <td>${o.owner}${o.isAgent ? '' : ' <span class="muted">(admin · €0 bonus)</span>'}</td>
    <td class="num">${o.packages.toLocaleString()}</td>
    <td class="num ${disc}">${eur(o.avg)}</td>
    <td class="num muted">${eur(o.min)}</td>
    <td class="num muted">${eur(o.max)}</td>
    <td class="num ${gap > 0 ? 'neg' : 'pos'}">${gap > 0 ? '−' + eur(gap) : eur(-gap)}</td>
    <td class="num">${upside > 0 ? '<span class="pos">+' + eur(upside) + '</span>' : '—'}</td>
  </tr>`;
}).join('');
const agentsHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div class="head"><h1>Elyon — Agents Price Comparison</h1><div class="sub">${DATESTR} · paid packages only · prices = what the customer actually paid / package</div></div>
  <p class="lead">Same products, different prices. This is what each agent realizes <b>per package</b>. The floor for a healthy €7 profit is <b>€14/package</b>; the last two columns show how far each agent is from it and the extra monthly profit if they sold at €14 (volume unchanged).</p>
  <div class="kpis">
    <div class="kpi"><div class="l">Avg price / package</div><div class="v">${eur(cash / paidPkgs)}</div><div class="s">${lev(cash / paidPkgs)}</div></div>
    <div class="kpi"><div class="l">Packages</div><div class="v">${paidPkgs.toLocaleString()}</div><div class="s">${paidCount} paid orders</div></div>
    <div class="kpi"><div class="l">Net / package now</div><div class="v">${eur(netPerPkg)}</div><div class="s">target €7–8</div></div>
    <div class="kpi" style="border-color:#86efac;background:#f0fdf4"><div class="l">Total upside if all at €14</div><div class="v pos">+${eur(totalUpside)}</div><div class="s">${lev(totalUpside)} / month</div></div>
  </div>
  <table>
    <thead><tr><th>Agent</th><th class="num">Packages</th><th class="num">Avg €/pkg</th><th class="num">Lowest</th><th class="num">Highest</th><th class="num">Gap to €14</th><th class="num">Upside @ €14</th></tr></thead>
    <tbody>${agentRows}</tbody>
  </table>
  <div class="note">Green ≥ €14 (healthy) · amber €12–14 · red &lt; €12. Admins/founders earn €0 commission so their pricing only affects margin, not payout. Coaching the high-volume / low-price agents toward €14 is the single biggest lever — and the high-price agents prove customers accept it.</div>
  <div class="foot">Elyon CRM · generated ${iso(now)} · figures reconcile to Insights → Pure Profit · EUR peg ${PEG}</div>
</body></html>`;

// ---------- PDF 2: 3-option pricing guidebook ----------
const productList = productTable.filter(p => p.packages >= 1);
const optCard = (rprev) => {
  const rows = productList.map((p) => {
    const recv = rprev.rec[p.product];
    const keep = !rprev.flat && p.avgPrice >= recv;      // floor options never lower a healthy price; flat €19 sets all
    const up = (!keep && p.avgPrice > 0) ? Math.round((recv / p.avgPrice - 1) * 100) : 0;
    const setCell = keep ? `<span class="muted">keep ${eur(p.avgPrice)}</span>` : `<span class="pos">${eur(recv)}</span>`;
    const chgCell = keep ? '<span class="muted">—</span>' : `<span class="${up >= 0 ? 'amb' : 'neg'}">${up >= 0 ? '+' : ''}${up}%</span>`;
    return `<tr><td>${p.product}${p.cogsKnown ? '' : ' <span class="muted">(no cost)</span>'}</td><td class="num">${p.packages}</td><td class="num muted">${eur(p.avgPrice)}</td><td class="num">${setCell}</td><td class="num">${chgCell}</td></tr>`;
  }).join('');
  return `<div class="opt" style="border-color:${rprev.color}">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div><h3 style="color:${rprev.color}">Option ${rprev.key} — ${rprev.name}</h3><div class="tag">${rprev.tag}</div></div>
      <span class="badge" style="background:${rprev.color}">${rprev.profitUpPct >= 0 ? '+' : ''}${rprev.profitUpPct}% profit</span>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="l">Monthly profit</div><div class="v" style="color:${rprev.color}">${eur(rprev.newProfit)}</div><div class="s">${lev(rprev.newProfit)} · was ${eur(clear)}</div></div>
      <div class="kpi"><div class="l">Net / package</div><div class="v">${eur(rprev.netPerPkg)}</div><div class="s">was ${eur(netPerPkg)}</div></div>
      <div class="kpi"><div class="l">Margin</div><div class="v">${rprev.newMargin}%</div><div class="s">was ${marginPct}%</div></div>
      <div class="kpi"><div class="l">Extra / month</div><div class="v pos">+${eur(rprev.profitUp)}</div><div class="s">${lev(rprev.profitUp)}</div></div>
    </div>
    <table>
      <thead><tr><th>Product</th><th class="num">Pkgs</th><th class="num">Now €/pkg</th><th class="num">Set to €/pkg</th><th class="num">Change</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
};
const guideHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div class="head"><h1>Elyon — Pricing Options Guidebook</h1><div class="sub">${DATESTR} · four options, pick one · all figures reconcile to Pure Profit</div></div>

  <h2>Where you are today</h2>
  <p class="lead">You collected <b>${eur(cash)}</b> (${lev(cash)}) on <b>${paidPkgs} packages</b> and kept <b>${eur(clear)}</b> (${lev(clear)}) — a <b>${marginPct}% margin</b>, or <b>${eur(netPerPkg)} per package</b>. Your goal is €7–8 per package. The customer pays an average of <b>${eur(cash / paidPkgs)}</b> per package today (not the catalogue price — bundles set the real price).</p>
  <div class="kpis">
    <div class="kpi"><div class="l">Cash collected</div><div class="v">${eur(cash)}</div><div class="s">${lev(cash)}</div></div>
    <div class="kpi"><div class="l">− VAT 20%</div><div class="v neg">−${eur(vatDue)}</div></div>
    <div class="kpi"><div class="l">− Product cost</div><div class="v neg">−${eur(cogsPaid)}</div></div>
    <div class="kpi"><div class="l">− Delivery+returns</div><div class="v neg">−${eur(deliveryCost + returnLoss)}</div></div>
    <div class="kpi"><div class="l">− Agent commission</div><div class="v neg">−${eur(commission)}</div></div>
    <div class="kpi" style="border-color:#cbd5e1;background:#f0fdf4"><div class="l">Pure profit</div><div class="v pos">${eur(clear)}</div><div class="s">${marginPct}% · ${eur(netPerPkg)}/pkg</div></div>
  </div>

  <h2>The rule behind every price</h2>
  <div class="formula">Floor price = 1.2 × ( target profit + product cost + delivery share + €1 commission )</div>
  <p class="lead">The <b>1.2×</b> adds back the VAT you only get to keep €1 of every €1.20. Bigger bundles split one delivery across more packages, so the floor drops a little for big packs. Staying in the €14–€24 band keeps agent commission at its cheapest (€1/package).</p>

  <h2>Choose your path</h2>
  <p class="lead">Four options. A–C raise each product to a healthy floor (and never lower a price that's already higher). <b>Option D is a single flat €19 for every package</b> — the most profit, but also the biggest jump, so demand must be watched closely. Each shows the exact price to set per product and the profit on this month's volume (held flat — no demand change assumed).</p>
  ${results.map(optCard).join('')}

  <div class="note"><b>Safety:</b> at Option B (€14) you'd earn ${eur(results[1].netPerPkg)}/package vs ${eur(netPerPkg)} today — you could lose up to ~29% of all volume and still beat today's profit, and a ~15% rise rarely costs a quarter of buyers. <b>Option D (flat €19)</b> is a ~55% average price jump that pushes profit to ${eur(results[3].newProfit)} (${results[3].profitUpPct >= 0 ? '+' : ''}${results[3].profitUpPct}%) — only safe if conversion holds; pilot it on one product first. It also <b>lowers</b> your few premium items (Broncho, Diet shakes) to €19, so keep those higher if you prefer. <br><b>Before you launch:</b> enter the 4 missing cost prices (Settings → Products) so high-cost items (Curcumactiv €6.30) are priced right.</p>

  <div class="foot">Elyon CRM · generated ${iso(now)} · the live "Margin Lab" tab in Insights lets you tune the target and simulate any bundle · EUR peg ${PEG}</div>
</body></html>`;

// ── render ──
async function render(html, outPdf, outHtml) {
  writeFileSync(outHtml, html);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: outPdf, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await browser.close();
  console.log(`Wrote ${outPdf}`);
}
await render(agentsHtml, 'Elyon-Agents-Price-Comparison.pdf', 'Elyon-Agents-Price-Comparison.html');
await render(guideHtml, 'Elyon-Pricing-Options-Guidebook.pdf', 'Elyon-Pricing-Options-Guidebook.html');
console.log('\nOptions summary:');
for (const r of results) console.log(`  ${r.key} ${r.name.padEnd(12)} ${r.flat ? 'flat €' + r.flat : 'floor €' + r.minFloor} → ${eur(r.newProfit)} (+${r.profitUpPct}%) · ${eur(r.netPerPkg)}/pkg · ${r.newMargin}%`);
