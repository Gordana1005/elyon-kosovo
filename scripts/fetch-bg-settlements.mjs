#!/usr/bin/env node
// Populate public.bg_settlements from Econt's public Nomenclatures API.
// ~5,495 Bulgarian settlements with name, postal code, region. Idempotent
// (upsert by Econt id). Run after the migration; re-run to refresh.
//
// Usage: node --env-file=.env scripts/fetch-bg-settlements.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log('Fetching settlements from Econt…');
  const res = await fetch('https://ee.econt.com/services/Nomenclatures/NomenclaturesService.getCities.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ countryCode: 'BGR' }),
  });
  if (!res.ok) throw new Error(`Econt getCities ${res.status}`);
  const data = await res.json();
  const cities = data.cities || [];
  console.log(`Fetched ${cities.length} settlements.`);

  const rows = cities
    .filter(c => c.name)
    .map(c => ({
      id: String(c.id),
      name: c.name,
      name_en: c.nameEn || null,
      name_lc: String(c.name).toLowerCase(),
      post_code: c.postCode ? String(c.postCode) : null,
      region: c.regionName || null,
    }));

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('bg_settlements').upsert(slice, { onConflict: 'id' });
    if (error) throw error;
    written += slice.length;
    process.stdout.write(`\r  upserted ${written}/${rows.length}`);
  }
  console.log(`\nDone. ${written} settlements in bg_settlements.`);
}

main().catch(e => { console.error(e); process.exit(1); });
