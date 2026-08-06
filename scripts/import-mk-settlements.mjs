#!/usr/bin/env node
/**
 * Populate public.mk_settlements from OpenStreetMap.
 *
 * Replaces the empty, Bulgarian bg_settlements with real Macedonian data: every
 * city, town and village, plus Skopje's neighbourhoods as `city_district` rows
 * so they line up with the ~60 Skopje zones MEX routes on.
 *
 * MEX cannot supply any of this — their API has no settlement register, only
 * 149 coarse delivery zones. This table is what the AGENT searches; the mapping
 * to a MEX zone happens in map-settlements-to-mex.mjs.
 *
 * ⚠️ `municipality` here is DERIVED, not authoritative. OSM's administrative
 * boundaries for Macedonia could not be used: is_in/addr:city tags are present
 * on ~100 of 2.157 places (and mostly just say "Macedonia"), and Overpass
 * returns admin_level=8 relations for this bbox with bounding boxes only, no
 * ring geometry — so there is nothing to run a point-in-polygon test against.
 *
 * Instead we record the nearest city/town within NEAREST_HUB_KM. For the one
 * thing this field actually drives — which MEX zone serves a village — that is
 * the better signal anyway: MEX is depot-routed and genuinely delivers rural
 * addresses off the nearest hub's route, not along administrative lines. For
 * the UI it reads as useful disambiguation between same-named villages.
 *
 * The upgrade path is the Cadastre Agency's official register, which would make
 * this column authoritative. Until then, treat it as "nearest town", and do not
 * use it for anything legal or fiscal.
 *
 * Idempotent: upserts by a stable 'osm:<type><id>' key, so a re-run refreshes
 * rather than duplicating.
 *
 *   node --env-file=.env scripts/import-mk-settlements.mjs --dry-run
 *   node --env-file=.env scripts/import-mk-settlements.mjs
 *   node --env-file=.env scripts/import-mk-settlements.mjs --refresh   # bypass cache
 *
 * Data © OpenStreetMap contributors, ODbL.
 */

import { createClient } from '@supabase/supabase-js';
import { normalizeMkGeo } from './lib/mk-translit.mjs';
import { overpass, MK_AREA, haversineKm } from './lib/osm-fetch.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const REFRESH = process.argv.includes('--refresh');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

// place=* → our `kind`. suburb/neighbourhood/quarter become city_district and
// are only kept when they fall inside a city, so we don't turn a rural hamlet's
// quarter into a routable settlement.
const PLACE_KIND = {
  city: 'city', town: 'town', village: 'village', hamlet: 'village',
  suburb: 'city_district', neighbourhood: 'city_district', quarter: 'city_district',
};

const Q_SETTLEMENTS = `
[out:json][timeout:300];
area(${MK_AREA})->.mk;
(
  node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|quarter)$"]["name"](area.mk);
);
out tags center;`;

// A village further than this from any city/town gets no hub. Macedonia is
// small and densely settled; beyond ~25 km the nearest town is no longer a
// meaningful statement about who delivers there.
const NEAREST_HUB_KM = 25;

async function main() {
  console.log('Fetching Macedonian settlements from OpenStreetMap…');
  const places = await overpass('mk-places', Q_SETTLEMENTS, { refresh: REFRESH });

  // ── Settlements ────────────────────────────────────────────────────────────
  const raw = (places.elements || [])
    .filter(e => e.tags?.name && (e.lat ?? e.center?.lat) != null)
    .map(e => {
      const lat = e.lat ?? e.center.lat;
      const lon = e.lon ?? e.center.lon;
      const t = e.tags;
      return {
        id: `osm:${e.type[0]}${e.id}`,
        name: String(t.name).trim(),
        name_lat: t['name:en'] || null,
        name_sq: t['name:sq'] || null,
        post_code: (t['addr:postcode'] || t.postal_code || '').match(/\b\d{4}\b/)?.[0] || null,
        place: t.place,
        kind: PLACE_KIND[t.place] || 'village',
        lat, lon,
      };
    });

  console.log(`${raw.length} named places.`);

  // ── Nearest hub (the derived `municipality`) ───────────────────────────────
  // See the header: this is "nearest city/town", not administrative containment.
  const cities = raw.filter(s => s.kind === 'city' || s.kind === 'town');
  console.log(`${cities.length} cities/towns act as hubs.`);

  const nearestHub = (s) => {
    let best = null, bestD = Infinity;
    for (const c of cities) {
      if (c.id === s.id) continue;
      const d = haversineKm(s.lat, s.lon, c.lat, c.lon);
      if (d < bestD) { bestD = d; best = c; }
    }
    return { hub: best, km: bestD };
  };

  process.stdout.write('Resolving nearest hubs… ');
  for (const s of raw) {
    if (s.kind === 'city' || s.kind === 'town') { s.municipality = s.name; s.hubKm = 0; continue; }
    const { hub, km } = nearestHub(s);
    s.municipality = hub && km <= NEAREST_HUB_KM ? hub.name : null;
    s.hub = hub && km <= NEAREST_HUB_KM ? hub : null;
    s.hubKm = km;
  }
  const withMuni = raw.filter(s => s.municipality).length;
  console.log(`${withMuni}/${raw.length} placed (within ${NEAREST_HUB_KM} km of a town).`);

  // ── city_district parenting ────────────────────────────────────────────────
  // A suburb only counts as a city_district if there is a real city/town close
  // enough to belong to. Otherwise it is demoted to a village so it stays
  // searchable instead of being orphaned. 12 km covers Skopje's outlying
  // neighbourhoods without swallowing separate villages.
  let districts = 0, demoted = 0;
  for (const s of raw) {
    if (s.kind !== 'city_district') continue;
    if (s.hub && s.hubKm <= 12) { s.parent_id = s.hub.id; districts++; }
    else { s.kind = 'village'; s.parent_id = null; demoted++; }
  }
  console.log(`${districts} city districts parented, ${demoted} demoted to village (no city within 12 km).`);

  const rows = raw.map(s => ({
    id: s.id,
    name: s.name,
    name_lc: s.name.toLowerCase(),
    name_norm: normalizeMkGeo(s.name),
    name_lat: s.name_lat,
    name_sq: s.name_sq,
    municipality: s.municipality,
    post_code: s.post_code,
    kind: s.kind,
    parent_id: s.parent_id || null,
    lat: s.lat,
    lng: s.lon,
    source: 'osm',
    updated_at: new Date().toISOString(),
  }));

  const byKind = rows.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {});
  console.log('\nBy kind:', JSON.stringify(byKind));
  console.log('With postal code:', rows.filter(r => r.post_code).length);
  console.log('With Albanian name:', rows.filter(r => r.name_sq).length);
  console.log('Sample:', rows.filter(r => r.kind === 'city').slice(0, 6).map(r => `${r.name}${r.municipality ? ' · општ. ' + r.municipality : ''}`).join(' | '));

  if (DRY_RUN) { console.log('\n--dry-run: nothing written.'); return; }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Two passes: parent_id is a self-FK, so every row must exist before we can
  // point children at parents.
  const flat = rows.map(r => ({ ...r, parent_id: null }));
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < flat.length; i += CHUNK) {
    const slice = flat.slice(i, i + CHUNK);
    const { error } = await supabase.from('mk_settlements').upsert(slice, { onConflict: 'id' });
    if (error) throw error;
    written += slice.length;
    process.stdout.write(`\r  upserted ${written}/${flat.length}`);
  }
  console.log();

  const children = rows.filter(r => r.parent_id);
  let linked = 0;
  for (let i = 0; i < children.length; i += CHUNK) {
    const slice = children.slice(i, i + CHUNK);
    const { error } = await supabase.from('mk_settlements').upsert(slice, { onConflict: 'id' });
    if (error) throw error;
    linked += slice.length;
    process.stdout.write(`\r  linked ${linked}/${children.length} districts to parents`);
  }
  console.log(`\n\nDone. ${written} settlements in mk_settlements.`);
  console.log('Next: node --env-file=.env scripts/import-mk-streets-osm.mjs');
}

main().catch(e => { console.error(e); process.exit(1); });
