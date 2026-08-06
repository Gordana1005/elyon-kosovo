#!/usr/bin/env node
/**
 * Mirror MEX Poshta's delivery zones into public.mex_cities.
 *
 * MEX's get_cities.php is the only reference data their API publishes — there
 * is no streets, offices or tariff endpoint. 149 rows for Macedonia, Latin-only
 * and inconsistently transliterated, including genuine duplicate rows for the
 * same town (117 "Stip" vs 143 "Štip").
 *
 * This script upserts by city_id and NEVER deletes: a shipped order may still
 * reference a zone MEX later drops, and its history must stay readable.
 *
 * Duplicate handling: rows are grouped by normalizeMkGeo(city_name). The lowest
 * city_id in a group becomes canonical; the rest get is_duplicate_of pointing at
 * it. Rows with canonical_locked = true are never re-decided, so an admin's
 * adjudication survives every refresh.
 *
 *   node --env-file=.env scripts/fetch-mex-cities.mjs --dry-run
 *   node --env-file=.env scripts/fetch-mex-cities.mjs
 *
 * Requires MEX_API_KEY in the environment (docs/VAULT.md).
 */

import { createClient } from '@supabase/supabase-js';
import { normalizeMkGeo } from './lib/mk-translit.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MEX_API_KEY = process.env.MEX_API_KEY;
const MEX_BASE = 'https://mex.mk/api/json';
const MK_COUNTRY_ID = 157;

const DRY_RUN = process.argv.includes('--dry-run');

if (!MEX_API_KEY) {
  console.error('Missing MEX_API_KEY in env.');
  process.exit(1);
}
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

async function fetchCities() {
  const res = await fetch(`${MEX_BASE}/get_cities.php?country_id=${MK_COUNTRY_ID}`, {
    headers: { AuthKey: MEX_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`MEX get_cities ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`MEX get_cities: ${data.response_msg || 'unknown error'}`);
  return data.cities || [];
}

async function main() {
  console.log(`Fetching MEX delivery zones (country_id=${MK_COUNTRY_ID})…`);
  const cities = await fetchCities();
  console.log(`Fetched ${cities.length} zones.`);

  const rows = cities
    .filter(c => c.city_id != null && c.city_name)
    .map(c => ({
      city_id: Number(c.city_id),
      city_name: String(c.city_name).trim(),
      city_name_norm: normalizeMkGeo(c.city_name),
      country_id: Number(c.country_id) || MK_COUNTRY_ID,
      country_code: c.country_code || null,
      is_active: true,
      refreshed_at: new Date().toISOString(),
    }));

  // ── Duplicate detection ────────────────────────────────────────────────────
  // Group by the normalised key. normalizeMkGeo folds diacritics, case and
  // digraphs, which is exactly what collapses MEX's own double entries.
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.city_name_norm)) groups.set(r.city_name_norm, []);
    groups.get(r.city_name_norm).push(r);
  }
  const dupGroups = [...groups.entries()].filter(([, v]) => v.length > 1);

  console.log(`\n${rows.length} zones → ${groups.size} distinct keys.`);
  if (dupGroups.length === 0) {
    console.log('No duplicate groups detected.');
  } else {
    console.log(`DUPLICATE GROUPS (${dupGroups.length}) — lowest city_id wins:\n`);
    for (const [key, members] of dupGroups) {
      const sorted = [...members].sort((a, b) => a.city_id - b.city_id);
      console.log(`  [${key}]`);
      sorted.forEach((m, i) =>
        console.log(`     ${i === 0 ? '→ CANONICAL' : '  duplicate'}  ${m.city_id}  ${m.city_name}`));
    }
    console.log('\nReview these. If the wrong row was chosen, set canonical_locked = true');
    console.log('on the one you want and fix is_duplicate_of by hand — this script will');
    console.log('then leave that group alone.\n');
  }

  // Names that differ too much to auto-collapse still need a human. Surface the
  // near-misses so they can be added to mex_city_aliases rather than silently
  // becoming two separate zones.
  const prefixed = rows.filter(r => /\s-\s|-/.test(r.city_name));
  console.log(`${prefixed.length} zones carry a "Parent - Leaf" prefix (Skopje/Tetovo/…).`);

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Which groups has an admin already adjudicated? Leave those untouched.
  const { data: locked, error: lockErr } = await supabase
    .from('mex_cities')
    .select('city_id, city_name_norm, canonical_locked')
    .eq('canonical_locked', true);
  if (lockErr) throw lockErr;
  const lockedKeys = new Set((locked || []).map(r => r.city_name_norm));

  // Pass 1: upsert every zone with is_duplicate_of cleared, so a row that is no
  // longer a duplicate stops being marked as one.
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map(r => ({ ...r, is_duplicate_of: null }));
    const { error } = await supabase.from('mex_cities').upsert(slice, { onConflict: 'city_id' });
    if (error) throw error;
    written += slice.length;
    process.stdout.write(`\r  upserted ${written}/${rows.length}`);
  }
  console.log();

  // Pass 2: point duplicates at their canonical row. Separate pass because the
  // FK requires the canonical row to exist first.
  let marked = 0;
  for (const [key, members] of dupGroups) {
    if (lockedKeys.has(key)) {
      console.log(`  skipping locked group [${key}]`);
      continue;
    }
    const sorted = [...members].sort((a, b) => a.city_id - b.city_id);
    const canonical = sorted[0].city_id;
    for (const dup of sorted.slice(1)) {
      const { error } = await supabase
        .from('mex_cities')
        .update({ is_duplicate_of: canonical })
        .eq('city_id', dup.city_id);
      if (error) throw error;
      marked++;
    }
  }

  console.log(`\nDone. ${written} zones in mex_cities, ${marked} marked as duplicates.`);
  console.log('Next: node --env-file=.env scripts/map-settlements-to-mex.mjs --dry-run');
}

main().catch(e => { console.error(e); process.exit(1); });
