#!/usr/bin/env node
// Pull safe destination numbers for the A1 concurrency (CAC) verification test.
//
// Why this exists: proving the trunk really carries N simultaneous calls needs N
// *distinct* destinations ringing at once. A1's contract cl. 16.3 treats "≥5
// similar-duration calls to one number in a short window" as atypical traffic and
// can auto-suspend the trunk, so the test must never reuse a number. This script
// emits one call per number, deduped, so a burst of 26 dials 26 different people.
//
// Source is the static FULL MONAD LIST segment (another company's legacy leads —
// see 20260627000000_monadon_legacy_exclusion.sql). They are numbers we would call
// anyway, they are excluded from every revenue/prediction path, and skipping the
// ones an agent already owns keeps the test out of live work.
//
// The calls themselves ring for ~18s and are never answered, so A1 bills nothing
// (billing starts on answer) and the customer sees one missed call from our Sofia
// DID. Callbacks land in the existing missed-call inbox.
//
// Usage:
//   node --env-file=.env scripts/cac-test-numbers.mjs --count=110 > cac-numbers.txt
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const FULL_MONAD_LIST_ID = '021619fe-7881-4feb-8620-1dc479048a0c';
const COUNT = (() => {
  const a = process.argv.find((x) => x.startsWith('--count='));
  return a ? parseInt(a.split('=')[1], 10) : 110;
})();
// Don't re-ring anyone an agent has phoned recently — the test must not look like
// a follow-up call to the customer, and must not pollute call cadence.
const QUIET_DAYS = (() => {
  const a = process.argv.find((x) => x.startsWith('--quiet-days='));
  return a ? parseInt(a.split('=')[1], 10) : 30;
})();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// PostgREST caps a single response at db-max-rows (1000 on Supabase) — page it.
async function fetchAll(build) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build().range(off, off + 999);
    if (error) { console.error('fetch error:', error.message); process.exit(1); }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const cutoff = new Date(Date.now() - QUIET_DAYS * 86400_000).toISOString();

const rows = await fetchAll(() =>
  supabase
    .from('prediction_segment_members')
    .select('customer_phone,last_call_at,assigned_agent_id,is_completed')
    .eq('list_id', FULL_MONAD_LIST_ID)
    .eq('is_completed', false)
    .is('assigned_agent_id', null)
    .order('customer_phone'),
);

const seen = new Set();
const picked = [];
for (const r of rows) {
  const p = String(r.customer_phone || '').trim();
  // BG mobiles only, strict E.164 — the trunk is dialled directly by the test
  // context, so anything malformed would just burn a slot on a 404.
  if (!/^\+3598[0-9]{8}$/.test(p)) continue;
  if (seen.has(p)) continue;
  if (r.last_call_at && r.last_call_at > cutoff) continue;
  seen.add(p);
  picked.push(p);
  if (picked.length >= COUNT) break;
}

if (picked.length < COUNT) {
  console.error(`WARNING: only ${picked.length} of ${COUNT} usable numbers found ` +
    `(pool ${rows.length}, quiet-days ${QUIET_DAYS}).`);
}
console.error(`${picked.length} distinct destinations selected from FULL MONAD LIST`);
console.log(picked.join('\n'));
