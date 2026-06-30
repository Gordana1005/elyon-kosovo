#!/usr/bin/env node
// Fill bg_settlements.municipality (община) from the EKATTE classifier
// (yurukov/Bulgaria-geocoding). Joins on settlement name + oblast so the ~103
// duplicate names (e.g. 4× Клисура) map to the right община. Idempotent.
//
// Usage: node --env-file=.env scripts/enrich-settlements-municipality.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing env.'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// NSI 3-letter oblast code → Econt region name (lowercased for matching).
const OBLAST = {
  BLG: 'благоевград', BGS: 'бургас', VAR: 'варна', VTR: 'велико търново', VID: 'видин',
  VRC: 'враца', GAB: 'габрово', DOB: 'добрич', KRZ: 'кърджали', KNL: 'кюстендил',
  LOV: 'ловеч', MON: 'монтана', PAZ: 'пазарджик', PER: 'перник', PVN: 'плевен',
  PDV: 'пловдив', RAZ: 'разград', RSE: 'русе', SLS: 'силистра', SLV: 'сливен',
  SML: 'смолян', SFO: 'софия област', SOF: 'софия', SZR: 'стара загора',
  TGV: 'търговище', HKV: 'хасково', SHU: 'шумен', JAM: 'ямбол',
};

const csv = async (url) => (await (await fetch(url)).text()).split(/\r?\n/).filter(Boolean);
const cell = (s) => (s || '').replace(/^"|"$/g, '').trim();

async function main() {
  console.log('Fetching EKATTE settlements + municipalities…');
  const [setLines, muniLines] = await Promise.all([
    csv('https://raw.githubusercontent.com/yurukov/Bulgaria-geocoding/master/settlements.csv'),
    csv('https://raw.githubusercontent.com/yurukov/Bulgaria-geocoding/master/municipalities.csv'),
  ]);

  // município code → name
  const muniName = {};
  for (const line of muniLines.slice(1)) {
    const [code, name] = line.split(',').map(cell);
    if (code) muniName[code] = name;
  }

  // settlement name (lc) + oblast → município name
  // header: ekatte,municipality,name_bg,name_en,area,population
  const byNameOblast = new Map(); // `${nameLc}|${oblastLc}` -> muniName
  const byName = new Map();        // nameLc -> muniName (fallback, unique names)
  const nameDup = new Set();
  for (const line of setLines.slice(1)) {
    const parts = line.split(',');
    const muniCode = cell(parts[1]);
    const nameBg = cell(parts[2]);
    if (!nameBg || !muniCode) continue;
    const oblastLc = OBLAST[muniCode.slice(0, 3)] || '';
    const mName = muniName[muniCode] || '';
    if (!mName) continue;
    const nameLc = nameBg.toLowerCase();
    byNameOblast.set(`${nameLc}|${oblastLc}`, mName);
    if (byName.has(nameLc)) nameDup.add(nameLc); else byName.set(nameLc, mName);
  }
  console.log(`EKATTE: ${byName.size} unique names, ${nameDup.size} duplicated.`);

  // Walk bg_settlements, resolve município, update.
  let matched = 0, missed = 0, updated = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bg_settlements').select('id, name, name_lc, region').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    const updates = [];
    for (const s of data) {
      const nameLc = s.name_lc || (s.name || '').toLowerCase();
      const oblastLc = (s.region || '').toLowerCase();
      let muni = byNameOblast.get(`${nameLc}|${oblastLc}`);
      if (!muni && !nameDup.has(nameLc)) muni = byName.get(nameLc); // unique name → safe fallback
      // Include NOT NULL columns so the upsert's insert-part stays valid.
      if (muni) { matched++; updates.push({ id: s.id, name: s.name, name_lc: s.name_lc, municipality: muni }); }
      else missed++;
    }
    // Upsert the matched rows (id PK).
    for (let i = 0; i < updates.length; i += 500) {
      const slice = updates.slice(i, i + 500);
      const { error: e2 } = await supabase.from('bg_settlements').upsert(slice, { onConflict: 'id' });
      if (e2) throw e2;
      updated += slice.length;
    }
    if (data.length < PAGE) break;
  }

  console.log(`\nMatched ${matched}, missed ${missed}, updated ${updated}.`);
  // Spot-check
  const { data: chk } = await supabase.from('bg_settlements').select('name, region, post_code, municipality').in('name', ['Стожер', 'Чоба', 'София', 'Пловдив']);
  (chk || []).forEach(c => console.log(`  ${c.name} (${c.region}, ${c.post_code}) → общ. ${c.municipality}`));
}

main().catch(e => { console.error(e); process.exit(1); });
