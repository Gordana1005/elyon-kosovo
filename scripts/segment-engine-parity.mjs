// Segment engine PARITY check — live (v3.4) vs shadow (v4).
// Read-only. Run any time:  node scripts/segment-engine-parity.mjs
//
// Compares membership (customer_phone -> list) between the LIVE table
// prediction_segment_members and the SHADOW table written by engine v4
// (prediction_segment_members_shadow). While v4 is seeded to the exact v3.4
// thresholds (and the package "Due to Reorder" list is disabled), the two must
// match EXACTLY — a non-zero diff means v4 would change someone's calling list,
// so it is NOT safe to cut over. Once the operator deliberately edits the engine
// config (moves a band, enables Due-to-Reorder), a diff is EXPECTED and this
// script becomes the "what will change at cutover" preview.
//
// Exits 1 if the diff is non-zero, so it can gate a cutover.

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
const ref = env.VITE_SUPABASE_PROJECT_ID || 'sxymaloycddnoxudxaqp';
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

// Does the shadow table even exist yet? (Scaffold migration must be applied.)
const [exists] = await q(`
  select to_regclass('public.prediction_segment_members_shadow') is not null as ok`);
if (!exists?.ok) {
  console.error('prediction_segment_members_shadow does not exist — apply 20260726000000_segment_engine_v4_scaffold.sql first.');
  process.exit(1);
}

// Compare only ENGINE-MANAGED lists. The engine writes is_static=false lists plus
// the additive static lists Trashed / Due to Reorder; it never touches the
// externally-imported static lists (FULL MONAD LIST, Cancelled Pendings), which
// therefore exist in live but not in the fresh shadow table — not a discrepancy.
const ENGINE = `(l.is_static = false OR l.name IN ('Trashed','Due to Reorder'))`;
const [tot] = await q(`
  select
    (select count(*) from prediction_segment_members m join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}) as live_total,
    (select count(*) from prediction_segment_members_shadow m join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}) as shadow_total,
    (select count(*) from (
       select m.customer_phone, m.list_id from prediction_segment_members m join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}
       except
       select m.customer_phone, m.list_id from prediction_segment_members_shadow m join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}) x) as only_live,
    (select count(*) from (
       select m.customer_phone, m.list_id from prediction_segment_members_shadow m join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}
       except
       select m.customer_phone, m.list_id from prediction_segment_members m join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}) y) as only_shadow,
    (select max(updated_at) from prediction_segment_members_shadow) as shadow_freshest`);

// A few concrete examples of where they differ (with human-readable list names).
const sample = await q(`
  with live_e as (
    select m.customer_phone, m.list_id from prediction_segment_members m
    join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}
  ), shadow_e as (
    select m.customer_phone, m.list_id from prediction_segment_members_shadow m
    join prediction_segment_lists l on l.id=m.list_id where ${ENGINE}
  ), diff as (
    select customer_phone, list_id, 'only in LIVE (v3.4)'  as side from live_e
    except all
    select customer_phone, list_id, 'only in LIVE (v3.4)' from shadow_e
    union all
    select customer_phone, list_id, 'only in SHADOW (v4)' from shadow_e
    except all
    select customer_phone, list_id, 'only in SHADOW (v4)' from live_e
  )
  select d.side, d.customer_phone, l.name as list_name
  from diff d
  join prediction_segment_lists l on l.id = d.list_id
  order by d.side, d.customer_phone
  limit 40`);

const onlyLive = Number(tot.only_live);
const onlyShadow = Number(tot.only_shadow);
const drift = onlyLive + onlyShadow;
const freshH = tot.shadow_freshest
  ? ((Date.now() - new Date(tot.shadow_freshest).getTime()) / 3600000).toFixed(1)
  : 'n/a';

console.log('\nSegment engine parity — live (v3.4) vs shadow (v4) — ' + new Date().toISOString());
console.log('─'.repeat(64));
console.log(`  live members ............ ${tot.live_total}`);
console.log(`  shadow members .......... ${tot.shadow_total}`);
console.log(`  shadow freshest ......... ${freshH}h ago`);
console.log(`  memberships only in LIVE  ${onlyLive}`);
console.log(`  memberships only in SHADOW ${onlyShadow}`);
console.log('─'.repeat(64));

if (sample.length) {
  console.log('  sample differences (phone — list — side):');
  for (const r of sample) {
    console.log(`    ${String(r.customer_phone).padEnd(16)} ${String(r.list_name).padEnd(24)} ${r.side}`);
  }
  console.log('─'.repeat(64));
}

if (drift === 0) {
  console.log('  ✅ PARITY: shadow matches live exactly — safe to cut over (if config unchanged).');
  process.exit(0);
} else {
  console.log(`  ⚠️  ${drift} membership difference(s). If you did NOT edit the engine config, v4 is`);
  console.log('     not yet at parity — investigate before any cutover. If you DID edit the config,');
  console.log('     this is the previewed change set.');
  process.exit(1);
}
