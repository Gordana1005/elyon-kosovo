#!/usr/bin/env node
// Backfill postal_code on office-delivery orders from the courier office's own
// post code (courier_offices.post_code). Home orders are untouched.
//
// Usage:  node --env-file=.env scripts/backfill-office-postal-codes.mjs            # dry run
//         node --env-file=.env scripts/backfill-office-postal-codes.mjs --commit   # write
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.slice(2).includes('--commit');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// All office orders (any status), so the fulfilment CSV is complete.
const orders = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, display_id, status, delivery_type, courier_office_code, courier_office_city, postal_code')
    .in('delivery_type', ['speedy_office', 'econt_office'])
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  orders.push(...data);
  if (data.length < 1000) break;
}

// Resolve each office's post code in one pass (cache by courier|code).
const cache = new Map();
const postCodeFor = async (deliveryType, code) => {
  const courier = deliveryType === 'speedy_office' ? 'speedy' : 'econt';
  const key = `${courier}|${code}`;
  if (cache.has(key)) return cache.get(key);
  const { data } = await supabase
    .from('courier_offices').select('post_code').eq('courier', courier).eq('office_code', code).maybeSingle();
  const pc = data?.post_code ? String(data.post_code) : null;
  cache.set(key, pc);
  return pc;
};

// Fallback for legacy/deactivated office codes that no longer carry a post
// code: use the post code shared by active offices in the same city — but only
// when they all agree (avoids guessing in multi-zip cities like Sofia).
const cityCache = new Map();
const cityPostCode = async (deliveryType, city) => {
  const courier = deliveryType === 'speedy_office' ? 'speedy' : 'econt';
  const key = `${courier}|${city}`;
  if (cityCache.has(key)) return cityCache.get(key);
  const { data } = await supabase
    .from('courier_offices').select('post_code').eq('courier', courier).eq('city', city).eq('is_active', true).neq('post_code', '');
  const distinct = [...new Set((data || []).map(r => String(r.post_code)))];
  const pc = distinct.length === 1 ? distinct[0] : null;
  cityCache.set(key, pc);
  return pc;
};

const updates = [], unresolved = [];
for (const o of orders) {
  if (!o.courier_office_code) { unresolved.push({ o, reason: 'no office code' }); continue; }
  let pc = await postCodeFor(o.delivery_type, o.courier_office_code);
  if (!pc && o.courier_office_city) pc = await cityPostCode(o.delivery_type, o.courier_office_city);
  if (!pc) { unresolved.push({ o, reason: 'office + city both unresolved' }); continue; }
  if (String(o.postal_code || '') !== pc) updates.push({ o, pc });
}

console.log(`${COMMIT ? '✍️  COMMIT' : '🌵 DRY RUN'} — ${orders.length} office orders; ${updates.length} to set, ${unresolved.length} unresolved\n`);
for (const { o, pc } of updates)
  console.log(`   #${(o.display_id || o.id).toString().padEnd(8)} ${o.status.padEnd(10)} ${o.courier_office_city || ''} office ${o.courier_office_code} → ${pc}  (was '${o.postal_code || ''}')`);
if (unresolved.length) { console.log('\n⚠ Unresolved:'); unresolved.forEach(({ o, reason }) => console.log(`   #${o.display_id || o.id} (${o.courier_office_city}) — ${reason}`)); }

if (!COMMIT) { console.log('\nRe-run with --commit to write.'); process.exit(0); }

let ok = 0;
for (const { o, pc } of updates) {
  const { error } = await supabase.from('orders').update({ postal_code: pc }).eq('id', o.id);
  if (error) { console.error(`✗ #${o.display_id || o.id}: ${error.message}`); continue; }
  ok++;
}
console.log(`\n✅ Updated ${ok}/${updates.length} office orders.`);
