#!/usr/bin/env node
/**
 * Fill mk_settlements.post_code so the order form auto-fills it and the agent
 * never types a postal code by hand.
 *
 * Why this script exists: OpenStreetMap carries a postcode for only 9 of our
 * 2.157 Macedonian settlements, and postal_code is a HARD requirement in
 * validateOrderForFulfilment — so without it, every order would be silently
 * held back from export.
 *
 * Source: GeoNames MK.zip (CC-BY 4.0), the standard open postal-code dataset.
 * It lists 220 Macedonian codes, each with coordinates. That is post-office
 * level, not one row per village — but Macedonian postal codes ARE regional
 * (a post office serves the settlements around it), so assigning each
 * settlement its nearest postal point is faithful to how the system works,
 * not a fudge.
 *
 * Two tiers:
 *   exact     the settlement's name matches a GeoNames place name → its own code
 *   nearest   otherwise, the geographically nearest postal point
 *
 * MEX does not use postal codes at all — add_shipment.php has no such field.
 * This is for our own records, the warehouse hand-off and the agent's screen.
 *
 *   node --env-file=.env scripts/enrich-mk-postal-codes.mjs --dry-run
 *   node --env-file=.env scripts/enrich-mk-postal-codes.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { normalizeMkGeo } from './lib/mk-translit.mjs';
import { haversineKm, CACHE_DIR } from './lib/osm-fetch.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const GEONAMES_URL = 'https://download.geonames.org/export/zip/MK.zip';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

/**
 * GeoNames ships a zip. Rather than add an unzip dependency for one 5 KB file,
 * read the single deflated entry straight out of the archive with zlib.
 */
async function loadGeonames() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, 'geonames-mk.txt');
  if (fs.existsSync(cached)) {
    console.log('  [cache] geonames-mk.txt');
    return fs.readFileSync(cached, 'utf8');
  }

  console.log(`  [fetch] ${GEONAMES_URL}`);
  const res = await fetch(GEONAMES_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GeoNames ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());

  const zlib = await import('node:zlib');
  // Read the CENTRAL DIRECTORY (PK\x01\x02), not the local file header.
  // GeoNames writes the archive with a data descriptor, which leaves the
  // compressed size as 0 in the local header — parsing that yields an empty
  // buffer and a Z_BUF_ERROR. The central directory always carries the real
  // sizes and the offset of the local header.
  let out = null;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const compMethod = zip.readUInt16LE(i + 10);
    const compSize = zip.readUInt32LE(i + 20);
    const nameLen = zip.readUInt16LE(i + 28);
    const extraLen = zip.readUInt16LE(i + 30);
    const commentLen = zip.readUInt16LE(i + 32);
    const localOffset = zip.readUInt32LE(i + 42);
    const name = zip.subarray(i + 46, i + 46 + nameLen).toString();
    if (!/^MK\.txt$/i.test(name)) continue;

    // Jump to the local header to find where the payload actually starts —
    // its name/extra lengths can differ from the central directory's.
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const body = zip.subarray(start, start + compSize);
    out = compMethod === 0 ? body.toString('utf8') : zlib.inflateRawSync(body).toString('utf8');
    break;
  }
  if (!out) throw new Error('MK.txt not found inside the GeoNames archive');
  fs.writeFileSync(cached, out);
  return out;
}

async function main() {
  console.log('Loading Macedonian postal codes…');
  const tsv = await loadGeonames();

  // GeoNames postal format: country, postcode, place, admin1..3, lat, lng, acc
  const points = tsv.split('\n').filter(Boolean).map(line => {
    const f = line.split('\t');
    return { code: f[1], place: f[2], lat: parseFloat(f[9]), lng: parseFloat(f[10]) };
  }).filter(p => /^\d{4}$/.test(p.code) && Number.isFinite(p.lat) && Number.isFinite(p.lng));

  console.log(`${points.length} postal points.`);

  const byNorm = new Map();
  for (const p of points) {
    const k = normalizeMkGeo(p.place);
    if (k && !byNorm.has(k)) byNorm.set(k, p);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const settlements = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('mk_settlements')
      .select('id, name, name_norm, name_lat, post_code, lat, lng')
      .range(from, from + 999);
    if (error) throw error;
    settlements.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  console.log(`${settlements.length} settlements.\n`);

  const updates = [];
  let exact = 0, nearest = 0, kept = 0, none = 0;

  for (const s of settlements) {
    // An OSM-supplied code is authoritative — never overwrite it.
    if (/^\d{4}$/.test(String(s.post_code || ''))) { kept++; continue; }

    let code = null, how = null;
    for (const key of [s.name_norm, normalizeMkGeo(s.name_lat || '')].filter(Boolean)) {
      if (byNorm.has(key)) { code = byNorm.get(key).code; how = 'exact'; break; }
    }

    if (!code && s.lat != null && s.lng != null) {
      let best = null, bestD = Infinity;
      for (const p of points) {
        const d = haversineKm(Number(s.lat), Number(s.lng), p.lat, p.lng);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) { code = best.code; how = 'nearest'; }
    }

    if (!code) { none++; continue; }
    how === 'exact' ? exact++ : nearest++;
    updates.push({ id: s.id, name: s.name, post_code: code });
  }

  console.log('POSTAL CODE ASSIGNMENT');
  console.log(`  already set (OSM) ${String(kept).padStart(5)}`);
  console.log(`  exact name match  ${String(exact).padStart(5)}`);
  console.log(`  nearest postal pt ${String(nearest).padStart(5)}`);
  console.log(`  unresolved        ${String(none).padStart(5)}`);
  console.log(`  → coverage        ${(((kept + exact + nearest) / settlements.length) * 100).toFixed(1)}%`);

  const spot = ['Скопје', 'Битола', 'Охрид', 'Тетово', 'Куманово', 'Штип', 'Прилеп', 'Струмица'];
  console.log('\nSpot check:');
  for (const n of spot) {
    const hit = updates.find(u => u.name === n) || settlements.find(s => s.name === n && s.post_code);
    console.log(`  ${n.padEnd(12)} ${hit?.post_code ?? '—'}`);
  }

  if (DRY_RUN) { console.log('\n--dry-run: nothing written.'); return; }

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    // Patch only post_code; upsert would need every NOT NULL column.
    await Promise.all(slice.map(u =>
      supabase.from('mk_settlements').update({ post_code: u.post_code }).eq('id', u.id)
        .then(({ error }) => { if (error) throw error; })
    ));
    written += slice.length;
    process.stdout.write(`\r  updated ${written}/${updates.length}`);
  }
  console.log(`\n\nDone. ${written} settlements given a postal code.`);
}

main().catch(e => { console.error(e); process.exit(1); });
