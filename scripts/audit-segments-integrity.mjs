// Prediction-segments engine health check (config-aware — engine v3.4 / v4).
// Read-only. Run any time:  node scripts/audit-segments-integrity.mjs
// Exits 1 if anything fails, so it can gate deploys or run from a scheduler.
//
// Verifies the invariants that broke in the June 2026 incident:
//   1. The LIVE function matches the active engine (drift detection). With
//      active_engine='v3_4' it must be the v3.4 body; with 'v4' it must read
//      segment_engine_config and be tagged engine v4.
//   2. One rule-driven list per phone (exclusivity).
//   3. Frequency labels literally true — boundaries taken FROM THE ACTIVE CONFIG
//      (so an operator edit moves the goalposts instead of false-failing).
//   4. Every member inside its list's recency band — boundaries FROM THE CONFIG.
//   5. No paid customer missing from all lists.
//   6. No monadon_legacy-only phone inside rule lists; FULL MONAD LIST intact.
//   7. Real "Last order" prices on every paid-bucket member.
//   8. Nightly pg_cron job present + member data fresh (<26h).
//   9. Nobody parked in Current Cancels longer than the configured window.
//  10. Current Returns membership matches "newest order is a return", except
//      that engine v3.7-mk sticky trash outranks it (a trashed customer is never
//      callable, additive mirrors included).
//  11. Trash List membership matches the engine v3.7-mk STICKY TRASH rule: in
//      for any reason except not_reachable and duplicate_order, and out again
//      only if they have PAID since; a not_reachable trash is held 21 days from
//      trashed_at (or until they pay), then released.
//  12. No sticky-trashed phone is sitting in a calling (rule-driven) list.
//  13. "Due to Reorder" members are genuinely due (only when reorder is enabled).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  } catch { /* .env optional when vars already exported */ }
  return env;
}

const env = loadEnv();
// Fail closed: never fall back to a hardcoded ref. This token can write to the
// Bulgarian project too, so an unset env var must stop the script, not silently
// retarget it.
const ref = env.VITE_SUPABASE_PROJECT_ID;
if (!ref) { console.error('VITE_SUPABASE_PROJECT_ID missing (set it in .env)'); process.exit(1); }
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN missing (set it in .env)'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const checks = [];
function check(name, pass, detail) { checks.push({ name, pass: !!pass, detail }); }

// SQL string-literal escaper (labels can contain quotes in theory).
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── Active engine + config (default to the v3.4 values if the table is absent) ──
const DEFAULT_CFG = {
  recency_bands: [
    { label: 'NEWCOMERS', max_days: 21, holding_pen: true },
    { label: '21d', max_days: 57 }, { label: '57d', max_days: 120 },
    { label: '4-6m', max_days: 180 }, { label: '6-12m', max_days: 365 },
    { label: '1-2yr', max_days: 730 }, { label: '2yr+', max_days: null },
  ],
  value_bands: [{ label: '≤26', max_price: 26 }, { label: '26+', max_price: null }],
  frequency_bands: [
    { label: '(1-3 orders)', min_count: 1 }, { label: '(3+ orders)', min_count: 3 },
    { label: '(5+ orders)', min_count: 5 }, { label: '(7+ orders)', min_count: 7 },
  ],
  windows: { current_cancels_days: 14, never_converted_recent_days: 180 },
  reorder: { enabled: false, buffer_days: 8, default_days_of_supply_per_unit: 15, list_name: 'Due to Reorder' },
};

let activeEngine = 'v3_4';
let cfg = DEFAULT_CFG;
try {
  const [r] = await q(`select active_engine, config from public.segment_engine_config where is_active = true limit 1`);
  if (r) { activeEngine = r.active_engine || 'v3_4'; cfg = r.config || DEFAULT_CFG; }
} catch { /* table not migrated yet → keep v3.4 defaults */ }

const cancelsDays = Number(cfg?.windows?.current_cancels_days ?? 14);
const reorderEnabled = !!cfg?.reorder?.enabled;
const reorderName = cfg?.reorder?.list_name || 'Due to Reorder';
const reorderBuffer = Number(cfg?.reorder?.buffer_days ?? 8);
const reorderDefault = Number(cfg?.reorder?.default_days_of_supply_per_unit ?? 15);
const reorderAgg = cfg?.reorder?.aggregation === 'earliest' ? 'earliest' : 'longest';

// Build the frequency-violation SQL from the config (most-specific min_count wins).
const freqBands = [...(cfg.frequency_bands || [])].sort((a, b) => a.min_count - b.min_count);
const freqClauses = freqBands.map((b, i) => {
  const min = b.min_count;
  const max = i + 1 < freqBands.length ? freqBands[i + 1].min_count - 1 : null;
  const range = max == null ? `m.paid_count < ${min}` : `(m.paid_count < ${min} or m.paid_count > ${max})`;
  return `(l.name like ${lit('%' + b.label + '%')} and ${range})`;
}).join('\n          or ');

// Build recency lower/upper CASE arms from the config (first match wins by name prefix).
const recBands = cfg.recency_bands || [];
const recLowerArms = recBands.map((b, i) => `when l.name like ${lit(b.label + '%')} then ${i === 0 ? 0 : (recBands[i - 1].max_days ?? 0)}`).join(' ');
const recUpperArms = recBands.map((b) => `when l.name like ${lit(b.label + '%')} then ${b.max_days == null ? 1000000 : b.max_days}`).join(' ');

// 1. live function fingerprint (branch on the active engine)
const [fn] = await q(`
  select obj_description(oid) as comment,
         prosrc like '%monadon_legacy%' as m,
         prosrc like '%NEWCOMERS %' as n,
         prosrc like '%Current Cancels%' as c,
         prosrc like '%trigger_price%' as t,
         prosrc like '%get_segment_engine_config%' as cfgread,
         prosrc like '%call_again_since%' as s
  from pg_proc where proname = 'recompute_customer_segments'`);
if (activeEngine === 'v4') {
  check('Live engine is v4 (config-driven, no drift)',
    fn && fn.cfgread && fn.m && fn.t && (fn.comment || '').includes('engine v4'),
    fn ? (fn.comment || '').slice(0, 60) : 'function missing');
} else {
  check('Live engine is v3.x (no drift)',
    fn && fn.m && fn.n && fn.c && fn.t && fn.s && (fn.comment || '').includes('engine v3'),
    fn ? (fn.comment || '').slice(0, 60) : 'function missing');
}

// Engine v3.7-mk sticky trash, expressed once so the three checks below cannot
// drift from each other or from the SQL function. Mirrors the detection block in
// 20260913000200_segment_engine_v3_7_sticky_trash.sql exactly:
//   • PERMANENT  — any trash reason except not_reachable and duplicate_order,
//                  UNLESS the customer has paid since (money releases them).
//   • PARKED     — a not_reachable trash younger than 21 days, same paid escape.
//   • duplicate_order is not a trash of the customer at all.
const STICKY_TRASH_CTE = `
       (select customer_phone,
               max(created_at) as max_all,
               max(created_at) filter (where status = 'returned') as max_ret,
               max(coalesce(trashed_at, created_at))
                 filter (where status = 'trashed'
                           and trash_reason is distinct from 'not_reachable'
                           and trash_reason is distinct from 'duplicate_order') as perm_at,
               max(coalesce(trashed_at, created_at))
                 filter (where status = 'trashed' and trash_reason = 'not_reachable') as unreach_at,
               max(created_at) filter (where status = 'paid') as paid_at
        from orders where source_type is distinct from 'monadon_legacy'
        group by customer_phone)`;

const PERM_TRASHED =
  `(pd.perm_at is not null and (pd.paid_at is null or pd.paid_at <= pd.perm_at))`;

const PARKED_UNREACHABLE =
  `(not ${PERM_TRASHED} and pd.unreach_at is not null
    and now() - pd.unreach_at < interval '21 days'
    and (pd.paid_at is null or pd.paid_at <= pd.unreach_at))`;

// 2-7. data invariants in one pass (boundaries injected from the active config)
const [d] = await q(`
  select
    (select count(*) from (
       select m.customer_phone from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id and l.is_static = false and l.name <> 'Current Returns'
       group by m.customer_phone having count(*) > 1) x) as dup_phones,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id and l.is_static = false
       where ${freqClauses || 'false'}) as freq_violations,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id
       where l.is_static = false and l.trigger_event = 'last_paid' and l.name not like 'Never-%'
         and m.last_paid_at is not null
         and (extract(epoch from (now() - m.last_paid_at))/86400 <
                (case ${recLowerArms} end)
           or extract(epoch from (now() - m.last_paid_at))/86400 >
                (case ${recUpperArms} end))) as out_of_band,
    (select count(*) from (
       select o.customer_phone,
              max(o.created_at) filter (where o.status = 'paid' and o.source_type is distinct from 'monadon_legacy') as lp
       from orders o group by o.customer_phone) ph
     where ph.lp is not null and not exists (
       select 1 from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id and l.is_static = false and l.name <> 'Current Returns'
       where m.customer_phone = ph.customer_phone)
       and not exists (
         select 1 from prediction_segment_members mt
         join prediction_segment_lists lt on lt.id = mt.list_id and lt.is_static = true
         where mt.customer_phone = ph.customer_phone)) as paid_phones_unlisted,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id and l.is_static = false
       where not exists (select 1 from orders o where o.customer_phone = m.customer_phone
                         and o.source_type is distinct from 'monadon_legacy')) as legacy_in_rule_lists,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id
       where l.name = 'FULL MONAD LIST') as full_monad,
    (select count(*) from orders where source_type = 'monadon_legacy') as monadon_orders,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id
       where l.is_static = false and l.trigger_event = 'last_paid' and l.name not like 'Never-%'
         and coalesce(m.trigger_price, 0) = 0) as paid_bucket_zero_price,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id
       where l.name = 'Current Cancels'
         and m.trigger_event_at < now() - interval '${cancelsDays + 1} days') as cancels_overdue,
    (select count(*) from ${STICKY_TRASH_CTE} pd
     where (pd.max_ret is not null and pd.max_ret = pd.max_all
            -- engine v3.7-mk: sticky trash outranks the returns mirror. A
            -- trashed customer is never callable, Current Returns included.
            and not ${PERM_TRASHED} and not ${PARKED_UNREACHABLE})
        is distinct from exists(
          select 1 from prediction_segment_members m
          join prediction_segment_lists l on l.id = m.list_id
          where l.name = 'Current Returns' and m.customer_phone = pd.customer_phone)
    ) as returns_violations,
    (select count(*) from ${STICKY_TRASH_CTE} pd
     where (${PERM_TRASHED} or ${PARKED_UNREACHABLE})
        is distinct from exists(
          select 1 from prediction_segment_members m
          join prediction_segment_lists l on l.id = m.list_id
          where l.name = 'Trash List' and m.customer_phone = pd.customer_phone)
    ) as trashed_violations,
    (select count(*) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id and l.is_static = false
       join ${STICKY_TRASH_CTE} pd on pd.customer_phone = m.customer_phone
     where ${PERM_TRASHED} or ${PARKED_UNREACHABLE}
    ) as trashed_in_calling_lists,
    (select max(m.updated_at) from prediction_segment_members m
       join prediction_segment_lists l on l.id = m.list_id and l.is_static = false) as freshest`);

check('One list per phone (exclusivity)', d.dup_phones === 0, `${d.dup_phones} duplicate phones`);
check('Frequency labels literally true', d.freq_violations === 0, `${d.freq_violations} violations`);
check('All members inside their recency band', d.out_of_band === 0, `${d.out_of_band} out of band`);
check('No paid customer missing from lists', d.paid_phones_unlisted === 0, `${d.paid_phones_unlisted} unlisted`);
// Two separate things: (a) no monadon_legacy phone has leaked into a calling
// list, and (b) if a Monadon import exists at all, its static list is intact.
// Bulgaria always has one, so the original check hard-required full_monad > 0.
// Macedonia has never run the Monadon import (0 monadon_legacy orders, no list),
// so demanding a non-empty list there is a guaranteed red line that would mask
// the real half of the check. Assert (b) only when there is an import to guard.
check('No Monadon phones in calling lists',
  d.legacy_in_rule_lists === 0 && (d.monadon_orders === 0 || d.full_monad > 0),
  d.monadon_orders === 0
    ? `${d.legacy_in_rule_lists} polluting (no Monadon import in this market)`
    : `${d.legacy_in_rule_lists} polluting, FULL MONAD ${d.full_monad}`);
check('Real Last-order price on paid buckets', d.paid_bucket_zero_price === 0, `${d.paid_bucket_zero_price} zero-price`);
check(`Nobody parked in Current Cancels > ${cancelsDays}d`, d.cancels_overdue === 0, `${d.cancels_overdue} overdue`);
check('Current Returns matches "newest is a return" (minus sticky trash)', d.returns_violations === 0, `${d.returns_violations} mismatches`);
check('Trash List matches sticky-trash rule (unpaid-since, or unreachable < 21d)', d.trashed_violations === 0, `${d.trashed_violations} mismatches`);
check('No sticky-trashed phone in any calling list', d.trashed_in_calling_lists === 0, `${d.trashed_in_calling_lists} still callable`);

const freshHours = (Date.now() - new Date(d.freshest).getTime()) / 3600000;
check('Member data fresh (< 26h)', freshHours < 26, `freshest ${freshHours.toFixed(1)}h ago`);

// 12. Due to Reorder — only meaningful once the list is live + enabled.
if (reorderEnabled) {
  const [rr] = await q(`
    with mem as (
      select m.customer_phone, m.last_paid_at
      from prediction_segment_members m
      join prediction_segment_lists l on l.id = m.list_id and l.name = ${lit(reorderName)}
    ),
    sup as (
      select mem.customer_phone, mem.last_paid_at,
        (select ${reorderAgg === 'earliest' ? 'min' : 'max'}(ps) from (
           select sum(oi.quantity * coalesce(p.days_of_supply_per_unit, ${reorderDefault})) as ps
             from orders o
             join order_items oi on oi.order_id = o.id
             left join products p on p.id = oi.product_id
            where o.customer_phone = mem.customer_phone and o.status = 'paid'
              and o.source_type is distinct from 'monadon_legacy'
              and o.created_at = mem.last_paid_at
            group by oi.product_id) pp) as supply_days
      from mem
    )
    select count(*) as not_due
    from sup
    where supply_days > 0
      and now() < (last_paid_at + (supply_days - ${reorderBuffer}) * interval '1 day')`);
  check('"Due to Reorder" members are genuinely due', Number(rr.not_due) === 0, `${rr.not_due} not yet due`);
} else {
  check('"Due to Reorder" (disabled — skipped)', true, 'reorder not enabled');
}

// 8. cron job
let cron = [];
try { cron = await q(`select jobname, schedule, active from cron.job where jobname = 'nightly-segment-recompute'`); } catch { /* ext missing */ }
check('Nightly recompute cron scheduled + active', cron[0]?.active === true,
  cron[0] ? `${cron[0].schedule}` : 'job missing');

const width = Math.max(...checks.map(c => c.name.length)) + 2;
console.log('\nPrediction-segments integrity audit — ' + new Date().toISOString() + `  (engine: ${activeEngine})`);
console.log('─'.repeat(width + 24));
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`  ${c.pass ? '✅ PASS' : '❌ FAIL'}  ${c.name.padEnd(width)} ${c.detail ?? ''}`);
}
console.log('─'.repeat(width + 24));
console.log(failed === 0 ? '  ALL CHECKS PASSED' : `  ${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
