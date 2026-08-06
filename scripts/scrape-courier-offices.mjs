#!/usr/bin/env node
// Scrape Speedy + Econt office locators and upsert into courier_offices.
//
// Both endpoints are publicly accessible without auth. Office data changes
// rarely so this is run once at ship + manually whenever the Refresh button
// is clicked.
//
// Usage:
//   node --env-file=.env scripts/scrape-courier-offices.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Cyrillic → Latin transliteration for city_normalized (search-friendly).
const CYR_TO_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s',
  'т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht',
  'ъ':'a','ь':'y','ю':'yu','я':'ya',
  // Macedonian-only letters — absent from the Bulgarian original, so they used
  // to pass through unchanged and leave a mixed-script key. Keep in sync with
  // src/lib/transliterate.ts.
  'ѓ':'gj','ѕ':'dz','ј':'j','љ':'lj','њ':'nj','ќ':'kj','џ':'dzh','ѐ':'e','ѝ':'i',
};
function normalizeCity(s) {
  if (!s) return '';
  return s.toLowerCase().split('').map(c => CYR_TO_LAT[c] ?? c).join('').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripCityPrefix(name) {
  // Econt city names sometimes include "гр. ", "с. ", "к.к. " — drop those.
  return (name || '').replace(/^(гр\.\s*|с\.\s*|к\.к\.\s*|кв\.\s*)/i, '').trim();
}

// ── ECONT ─────────────────────────────────────────────────────────────────
// Public Nomenclatures endpoint — same one their office locator UI uses.
async function fetchEcont() {
  const res = await fetch('https://ee.econt.com/services/Nomenclatures/NomenclaturesService.getOffices.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ countryCode: 'BGR' }),
  });
  if (!res.ok) throw new Error(`Econt fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const offices = data.offices || [];
  return offices.map(o => {
    const city = stripCityPrefix(o.address?.city?.name || '');
    const street = o.address?.fullAddress
      || [o.address?.street, o.address?.num].filter(Boolean).join(' ')
      || '';
    const hoursParts = [];
    if (o.normalBusinessHoursFrom != null && o.normalBusinessHoursTo != null) {
      const f = formatHHMM(o.normalBusinessHoursFrom);
      const t = formatHHMM(o.normalBusinessHoursTo);
      hoursParts.push(`Mon-Fri ${f}-${t}`);
    }
    if (o.halfDayBusinessHoursFrom != null && o.halfDayBusinessHoursTo != null) {
      const f = formatHHMM(o.halfDayBusinessHoursFrom);
      const t = formatHHMM(o.halfDayBusinessHoursTo);
      if (f !== '00:00' || t !== '00:00') hoursParts.push(`Sat ${f}-${t}`);
    }
    return {
      courier: 'econt',
      office_code: String(o.code || o.id),
      city,
      city_normalized: normalizeCity(city),
      post_code: String(o.address?.city?.postCode || o.address?.zip || ''),
      name: o.name || '',
      address: street,
      hours: hoursParts.join(', '),
      lat: o.address?.location?.latitude ?? null,
      lng: o.address?.location?.longitude ?? null,
    };
  }).filter(r => r.office_code && r.city);
}

function formatHHMM(secondsSinceMidnight) {
  const total = Math.round(secondsSinceMidnight / 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ── SPEEDY ────────────────────────────────────────────────────────────────
// Speedy deprecated their public bulk-list JSON endpoints, but the office
// locator widget's autocomplete API is still open and respects a custom
// `limit`. Strategy:
//   1. Query searchOffices.php once per Cyrillic letter (А–Я) with
//      limit=10000 — accumulating up to ~700 unique offices across all
//      letter prefixes. Each result has officeId, name, lat/lng.
//   2. For each unique officeId, POST getOfficeDetails.php to fetch the
//      structured address + working hours. Concurrent batches of 20 keep
//      the total time under a minute.
// Both endpoints are publicly accessible without auth.

const CYRILLIC_LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ'.split('');

async function fetchSpeedyOfficeList() {
  const allIds = new Set();
  for (const letter of CYRILLIC_LETTERS) {
    const url = `https://services.speedy.bg/officesmap_v2/api/searchOffices.php?countryId=100&lang=bg&query=${encodeURIComponent(letter)}&limit=10000`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const o of (data.offices || [])) {
        if (o.officeId) allIds.add(o.officeId);
      }
    } catch { /* skip letter on transient error */ }
  }
  return [...allIds];
}

async function fetchSpeedyDetails(officeId) {
  try {
    const res = await fetch('https://services.speedy.bg/officesmap_v2/getOfficeDetails.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ officeId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.office) return null;
    const o = data.office;
    const city = stripCityPrefix(o.address?.siteName || '');
    const hoursParts = [];
    if (o.workingTimeFrom && o.workingTimeTo) hoursParts.push(`Mon-Fri ${o.workingTimeFrom}-${o.workingTimeTo}`);
    if (o.workingTimeHalfFrom && o.workingTimeHalfTo &&
        (o.workingTimeHalfFrom !== '00:00' || o.workingTimeHalfTo !== '00:00')) {
      hoursParts.push(`Sat ${o.workingTimeHalfFrom}-${o.workingTimeHalfTo}`);
    }
    return {
      courier: 'speedy',
      office_code: String(o.id),
      city,
      city_normalized: normalizeCity(city),
      post_code: String(o.address?.postCode || ''),
      name: o.name || '',
      address: o.address?.localAddressString || o.address?.fullAddressString || '',
      hours: hoursParts.join(', '),
      lat: o.address?.y ?? null,
      lng: o.address?.x ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchSpeedy() {
  process.stdout.write('  enumerating office IDs by letter… ');
  const ids = await fetchSpeedyOfficeList();
  console.log(`${ids.length} unique IDs`);

  process.stdout.write(`  fetching details (concurrency=20)… `);
  const results = [];
  const CONCURRENCY = 20;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const detailed = await Promise.all(batch.map(fetchSpeedyDetails));
    for (const d of detailed) if (d && d.city) results.push(d);
    process.stdout.write('.');
  }
  console.log(` ${results.length} ok`);
  return results;
}

// ── upsert + activeness reconciliation ────────────────────────────────────
async function upsertCourier(courier, rows) {
  if (rows.length === 0) {
    console.log(`  ${courier}: 0 fetched, skipping upsert.`);
    return { fetched: 0, written: 0, deactivated: 0 };
  }

  // Existing codes for this courier
  const existing = new Map();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('courier_offices')
      .select('office_code, is_active')
      .eq('courier', courier)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) existing.set(r.office_code, r.is_active);
    if (data.length < 1000) break;
    from += 1000;
  }

  // Upsert in batches of 200
  let written = 0;
  const seenCodes = new Set();
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map(r => ({ ...r, is_active: true, refreshed_at: new Date().toISOString() }));
    const { error } = await supabase.from('courier_offices').upsert(batch, { onConflict: 'courier,office_code' });
    if (error) throw error;
    for (const r of batch) seenCodes.add(r.office_code);
    written += batch.length;
  }

  // Deactivate codes that didn't appear this run
  const stale = [...existing.keys()].filter(code => !seenCodes.has(code) && existing.get(code));
  let deactivated = 0;
  if (stale.length > 0) {
    for (let i = 0; i < stale.length; i += 200) {
      const batch = stale.slice(i, i + 200);
      const { error, count } = await supabase
        .from('courier_offices')
        .update({ is_active: false }, { count: 'exact' })
        .eq('courier', courier)
        .in('office_code', batch);
      if (error) throw error;
      deactivated += count || 0;
    }
  }

  return { fetched: rows.length, written, deactivated };
}

// ── main ──────────────────────────────────────────────────────────────────
console.log('Scraping courier offices…');
console.log('Econt:');
const econt = await fetchEcont();
const econtRes = await upsertCourier('econt', econt);
console.log(`  fetched=${econtRes.fetched}  written=${econtRes.written}  deactivated=${econtRes.deactivated}`);

console.log('Speedy:');
const speedy = await fetchSpeedy();
const speedyRes = await upsertCourier('speedy', speedy);
console.log(`  fetched=${speedyRes.fetched}  written=${speedyRes.written}  deactivated=${speedyRes.deactivated}`);

console.log(`\nDone. Total active rows: ${econtRes.written + speedyRes.written}.`);
