#!/usr/bin/env node
// Read-only analysis of home-delivery address data quality.
//
// Historical imports scattered address parts across the wrong columns — e.g.
// a street value sitting in customer_city, or an Econt office string in a
// "home" order. This script classifies what each field actually holds so we
// can design a safe backfill. NO writes.
//
// Usage: node --env-file=.env scripts/analyze-home-addresses.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Bulgarian address heuristics ──
const STREET_RE  = /(^|\s)(ул\.?|улица|бул\.?|булевард|пл\.?|площад)(\s|$)/i;
const KVARTAL_RE = /(^|\s)(кв\.?|квартал|ж\.?\s?к\.?|к\.?к\.?|жилищен комплекс)(\s|$)/i;
const COURIER_RE = /(еконт|econt|спиди|speedy|офис|автомат|apt|machine)/i;
const CITY_RE    = /(^|\s)(гр\.?|град|с\.?|село)(\s|$)/i;
const POSTAL_RE  = /\b(\d{4})\b/;

function classify(s) {
  if (!s || !s.trim()) return 'empty';
  if (COURIER_RE.test(s)) return 'courier';
  if (STREET_RE.test(s)) return 'street';
  if (KVARTAL_RE.test(s)) return 'kvartal';
  if (CITY_RE.test(s)) return 'city';
  if (/^\d{4}$/.test(s.trim())) return 'postal';
  return 'plain'; // bare token — likely a city/village name, or a name w/o prefix
}

function bump(map, key) { map[key] = (map[key] || 0) + 1; }

async function main() {
  console.log(`Target: ${SUPABASE_URL}\nScanning orders…\n`);

  const cityClass = {};
  const addrClass = {};
  const streetClass = {};
  let total = 0, home = 0, courierType = 0;
  let cityIsStreet = 0, cityIsCourier = 0, cityHasPostal = 0;
  const samplesCityStreet = [];
  const samplesCityCourier = [];

  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, display_id, delivery_type, customer_city, customer_address, street, postal_code, courier_office_code')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const o of data) {
      total++;
      const dt = o.delivery_type || 'home';
      if (dt === 'speedy_office' || dt === 'econt_office') { courierType++; continue; }
      home++;

      const cClass = classify(o.customer_city);
      bump(cityClass, cClass);
      bump(addrClass, classify(o.customer_address));
      bump(streetClass, classify(o.street));

      if (cClass === 'street') {
        cityIsStreet++;
        if (samplesCityStreet.length < 12) samplesCityStreet.push(`${o.display_id}: city="${o.customer_city}"  street="${o.street || ''}"  addr="${o.customer_address || ''}"`);
      }
      if (cClass === 'courier') {
        cityIsCourier++;
        if (samplesCityCourier.length < 12) samplesCityCourier.push(`${o.display_id}: city="${o.customer_city}"`);
      }
      if (o.customer_city && POSTAL_RE.test(o.customer_city)) cityHasPostal++;
    }
    if (data.length < PAGE) break;
  }

  console.log(`Total orders:            ${total}`);
  console.log(`  Courier-office type:   ${courierType}`);
  console.log(`  Home (or untyped):     ${home}\n`);

  console.log('customer_city content classification (home orders):');
  for (const [k, v] of Object.entries(cityClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log('\ncustomer_address content classification (home orders):');
  for (const [k, v] of Object.entries(addrClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log('\nstreet content classification (home orders):');
  for (const [k, v] of Object.entries(streetClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8)} ${v}`);

  console.log(`\n⚠ Mislabeled signals:`);
  console.log(`  City field holds a STREET:   ${cityIsStreet}`);
  console.log(`  City field holds COURIER ref: ${cityIsCourier}`);
  console.log(`  City field contains a postal: ${cityHasPostal}`);

  console.log(`\nSamples — street-in-city:`);
  samplesCityStreet.forEach(s => console.log('  ' + s));
  console.log(`\nSamples — courier-in-city:`);
  samplesCityCourier.forEach(s => console.log('  ' + s));
}

main().catch(e => { console.error(e); process.exit(1); });
