#!/usr/bin/env node
// CONSERVATIVE address restructure — only fixes high-confidence rows.
//
// HOME orders (Case A/B): split the messy text into city / quarter / street /
//   building / apartment / floor / postal columns.
// COURIER orders (Case C): an order whose address mentions Еконт/Спиди is
//   re-typed to the right courier and its OFFICE is matched against our cached
//   office list (courier-scoped — Econt only matches Econt offices, Speedy only
//   Speedy) so the office code is filled in.
//
// Everything ambiguous is left untouched. Every original is snapshotted to an
// order_note before any change, so --revert restores it exactly.
//
// Usage:
//   node --env-file=.env scripts/fix-home-addresses.mjs                  # dry-run
//   node --env-file=.env scripts/fix-home-addresses.mjs --only=home      # only Case A/B
//   node --env-file=.env scripts/fix-home-addresses.mjs --only=courier   # only Case C
//   node --env-file=.env scripts/fix-home-addresses.mjs --commit --max=5 # commit a batch
//   node --env-file=.env scripts/fix-home-addresses.mjs --revert         # undo all

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const SAMPLE_LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : 25;
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX = maxArg ? parseInt(maxArg.split('=')[1]) : Infinity;
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1] : null; // 'home' | 'courier'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const clean = (s) => (s || '').replace(/[«»"„"]/g, '').replace(/\s+/g, ' ').replace(/^[\s,;.-]+|[\s,;.-]+$/g, '').trim();

const HAS_GARBAGE  = /(няма|без улиц|без номер|n\/a|---)/i;
const STREET_START = /^\s*(ул|бул|пл)\.?\s*\S/i;
const HAS_STREET   = /(^|[\s,])(ул|бул|пл)\.?\s*\S/i;
const HAS_KVARTAL  = /(^|[\s,])(кв|ж\.?\s?к|к\.?к)\.?\s*\S/i;
const HAS_COURIER  = /(еконт|econt|спиди|speedy|офис|автомат)/i;
const HAS_DIGIT    = /\d/;
const CITY_PREFIX  = /^\s*(гр\.?|град|с\.?|село)\s+/i;

const STOP = new Set([
  'офис', 'офиса', 'на', 'до', 'еконт', 'econt', 'спиди', 'speedy', 'еконтомат', 'econtomat',
  'ул', 'улица', 'бул', 'булевард', 'пл', 'площад', 'кв', 'квартал', 'жк', 'кк', 'блок', 'бл',
  'ет', 'етаж', 'ап', 'апартамент', 'вх', 'вход', 'гр', 'град', 'село', 'обл', 'област',
  'общ', 'община', 'номер', 'near', 'автомат',
]);
const tokenize = (s) => (s || '').toLowerCase().replace(/[^a-zа-я0-9 ]/gi, ' ').split(/\s+/)
  .filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
const detectCourier = (s) => /еконт|econt/i.test(s) ? 'econt' : /спиди|speedy/i.test(s) ? 'speedy' : null;

// Best office for a free-text courier address. Courier-scoped. Confident only:
// score ≥ 2, or a unique single-token hit.
function matchOffice(offices, courier, text) {
  const tokens = tokenize(text);
  if (!tokens.length) return null;
  const scored = offices.filter(o => o.courier === courier).map(o => {
    const hay = `${o.name} ${o.address}`.toLowerCase();
    return { o, score: tokens.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0) };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const best = scored[0];
  const ties = scored.filter(x => x.score === best.score).length;
  if (best.score >= 2) return best.o;
  if (best.score === 1 && ties === 1) return best.o;
  return null;
}

function cityName(s) {
  if (!s) return '';
  let v = clean(s);
  if (!v) return '';
  if (HAS_COURIER.test(v) || HAS_STREET.test(v) || HAS_KVARTAL.test(v) || HAS_GARBAGE.test(v)) return '';
  if (HAS_DIGIT.test(v)) return '';
  if (v.replace(CITY_PREFIX, '').trim().length < 2) return '';
  return v;
}
// A street run ends at the next address keyword (settlement/quarter/building/
// region/postal), a comma, or end — so the city/village/region never bleeds into
// the street when the whole address is one blob.
const STREET_BOUNDARY =
  String.raw`(?=[,;]|\s+(?:с\.|село|гр\.|град|кв\.|ж\.?\s?к|квартал|бл\.|блок|ет\.|ап\.|вх\.|общ\.|обл\.|\d{4})|$)`;
function extractStreet(s) {
  const t = clean(s);
  const m = t.match(new RegExp(String.raw`((?:ул\.?|бул\.?|пл\.)\s*[А-Яа-яA-Za-z0-9 .№#'-]+?)` + STREET_BOUNDARY, 'i'));
  return m ? clean(m[1]) : '';
}
function extractKvartal(s) {
  const t = clean(s);
  const m = t.match(/(?:^|[\s,])((?:кв\.|ж\.?\s?к\.?|квартал)\s*[А-Яа-яA-Za-z0-9 .'-]+?)(?=[,;]|\s+(?:ул|бул|пл|бл|ет|ап|вх|гр|с\.|село|общ|обл|\d{4})|$)/i);
  return m ? clean(m[1]) : '';
}
function extractMunicipality(s) {
  const m = (s || '').match(/(?:общ\.|община)\s*([А-Яа-яA-Za-z .'-]+?)(?=[,;]|\s+(?:ул|бул|пл|кв|обл|гр|с\.|село|\d{4})|$)/i);
  return m ? clean(m[1]) : '';
}
function withMunicipality(settlement, muni) {
  const c = clean(settlement);
  if (!muni || /общ/i.test(c)) return c;
  return `${c}, общ. ${muni}`;
}
function stripRegion(s) {
  return clean((s || '').replace(/(?:^|[\s,;])обл(?:аст)?\.?\s*[А-Яа-яA-Za-z. '-]+/gi, ' '));
}
function extractDetails(s) {
  const r = { block: '', entry: '', apartment: '', floor: '', postal: '' };
  let g;
  if ((g = (s || '').match(/(?<!\d)(\d{4})(?!\d)/))) r.postal = g[1];
  if ((g = (s || '').match(/(?:^|[\s,(])бл\.?\s*(\d[0-9A-Za-zА-Яа-я]*)/i))) r.block = g[1];
  if ((g = (s || '').match(/(?:^|[\s,(])вх\.?\s*(?:од)?\s*([0-9A-Za-zА-Яа-я]+)/i))) r.entry = g[1];
  if ((g = (s || '').match(/(?:^|[\s,(])ап\.?\s*(?:артамент)?\s*([0-9]+)/i))) r.apartment = g[1];
  if ((g = (s || '').match(/(?:^|[\s,(])ет\.?\s*(?:аж)?\s*([0-9]+)/i))) r.floor = g[1];
  return r;
}
// Split a trailing house number into the dedicated street_number column, so
// "ул. Шипка 6" → { street: "ул. Шипка", street_number: "6" }.
function splitStreetNumber(street) {
  const t = clean(street);
  if (!t) return { street: '', street_number: '' };
  // Strip an optional No/№/номер marker too. index>0 so a number-only value
  // (no street name) is left intact rather than blanked.
  const m = t.match(/(?:№|no|номер)?\.?\s*(\d+[А-Яа-яA-Za-z]?)\s*$/i);
  if (m && m.index !== undefined && m.index > 0) return { street: clean(t.slice(0, m.index)), street_number: m[1] };
  return { street: t, street_number: '' };
}
// Extract a village ("с. …") / town ("гр. …") settlement from a blob. Brackets
// (e.g. "гр. СОЗОПОЛ [8130]") are flattened first so the bracketed postal doesn't
// block the match.
function extractSettlement(s) {
  const t = (s || '').replace(/[[\]()]/g, ' ');
  // Boundary includes a SECOND settlement prefix (гр.|с.|село|град) so a stray
  // duplicate token never gets swallowed into the name (e.g. "гр.Бургас гр.Бургас"
  // → "гр.Бургас").
  const m = t.match(/(?:^|[\s,])((?:с\.|гр\.)\s*[А-Яа-яA-Za-z .'-]+?)(?=[,;]|\s+(?:обл|общ|ул|бул|пл|кв|ж\.?\s?к|жк|бл|ет|ап|вх|гр\.|с\.|село|град|\d{4})|$)/i);
  return m ? clean(m[1]) : '';
}
function stripPostal(s, postal) {
  let v = clean(s);
  if (postal) v = clean(v.replace(new RegExp(`[\\s,.-]*\\b${postal}\\b\\s*$`), ''));
  return v;
}

// Resolve the община for a settlement from the bg_settlements reference, so a
// village home-order gets its parent city (e.g. Чоба → общ. Брезово). Returns
// '' for towns that are their own община (no redundant suffix) and for
// ambiguous duplicate names we can't disambiguate by oblast.
function lookupMunicipality(settlements, cityValue, addrText) {
  const bare = clean(cityValue).replace(/^\s*(гр\.?|град|с\.?|село)\s*/i, '').split(',')[0].trim().toLowerCase();
  if (bare.length < 2) return '';
  const cands = settlements.get(bare);
  if (!cands || !cands.length) return '';
  let muni = '';
  if (cands.length === 1) muni = cands[0].municipality;
  else {
    const om = (addrText || '').match(/обл(?:аст)?\.?\s*([А-Яа-яA-Za-z .'-]+)/i);
    if (om) {
      const ob = clean(om[1]).toLowerCase();
      const hit = cands.find(c => c.region_lc === ob || c.region_lc.includes(ob) || ob.includes(c.region_lc));
      if (hit) muni = hit.municipality;
    }
  }
  return (muni && muni.toLowerCase() !== bare) ? muni : '';
}

function planFix(o, offices, settlements) {
  const city = o.customer_city || '';
  const addr = o.customer_address || '';
  const blob = `${city} ${addr}`;

  // ── Case C: courier-office order ──
  const courier = detectCourier(blob);
  if (courier) {
    const dt = o.delivery_type || 'home';
    if ((dt === 'econt_office' || dt === 'speedy_office') && o.courier_office_code) return null; // already structured
    const match = matchOffice(offices, courier, blob);
    if (!match) return null; // can't confidently match — leave for the agent
    return {
      reason: 'C',
      update: {
        delivery_type: courier === 'econt' ? 'econt_office' : 'speedy_office',
        courier_office_code: match.office_code,
        courier_office_name: match.name,
        courier_office_city: match.city,
      },
      note: `→ ${courier} #${match.office_code} ${match.name}`,
    };
  }

  // ── Home (skip if street already structured) ──
  if (o.street && o.street.trim()) return null;
  const cityIsClean = !!cityName(city);
  const addrIsCleanCity = !!cityName(addr);
  const kvartal = extractKvartal(blob);

  // Case A: clean city + a street in the address.
  if (cityIsClean && HAS_STREET.test(addr) && !HAS_GARBAGE.test(addr)) {
    const street = extractStreet(addr);
    if (!street) return null;
    const d = extractDetails(addr);
    const sp = splitStreetNumber(stripPostal(street, d.postal));
    const muni = extractMunicipality(blob) || lookupMunicipality(settlements, city, blob);
    return {
      reason: 'A',
      update: {
        customer_city: withMunicipality(stripRegion(city), muni),
        quarter: kvartal || o.quarter || '',
        street: sp.street,
        street_number: sp.street_number || o.street_number || '',
        block: d.block || o.block || '',
        entry: d.entry || o.entry || '',
        apartment: d.apartment || o.apartment || '',
        floor: d.floor || o.floor || '',
        postal_code: d.postal || o.postal_code || '',
      },
    };
  }

  // Case B: city field is a street + the address is a clean city.
  if (STREET_START.test(city) && addrIsCleanCity && !HAS_STREET.test(addr)) {
    const d = extractDetails(blob);
    const sp = splitStreetNumber(stripPostal(extractStreet(city) || clean(city), d.postal));
    const muni = extractMunicipality(blob) || lookupMunicipality(settlements, addr, blob);
    return {
      reason: 'B',
      update: {
        customer_city: withMunicipality(stripRegion(addr), muni),
        quarter: kvartal || o.quarter || '',
        street: sp.street,
        street_number: sp.street_number || o.street_number || '',
        block: d.block || o.block || '',
        entry: d.entry || o.entry || '',
        apartment: d.apartment || o.apartment || '',
        floor: d.floor || o.floor || '',
        postal_code: d.postal || o.postal_code || '',
      },
    };
  }

  // Case D: everything crammed into one field (street + village/town + region +
  // postal), with city empty or messy so A/B don't fire. Parse the whole blob
  // into granular parts. Fires only when a street OR a settlement is found, so
  // ambiguous rows are still left untouched.
  const dStreet = extractStreet(blob);
  const settlement = extractSettlement(blob);
  if (dStreet || settlement) {
    const d = extractDetails(blob);
    const sp = splitStreetNumber(stripPostal(dStreet, d.postal));
    // City must come from a prefixed settlement ("с./гр. …") or an already-clean
    // city field. If neither, we can't tell which token is the city — leave the
    // row for the agent rather than guess or blank it (shipping-critical).
    const cityVal = settlement || (cityIsClean ? clean(city) : '');
    if (cityVal) {
      const muni = lookupMunicipality(settlements, cityVal, blob);
      return {
        reason: 'D',
        update: {
          customer_city: withMunicipality(stripRegion(cityVal), muni),
          quarter: kvartal || o.quarter || '',
          street: sp.street,
          street_number: sp.street_number || o.street_number || '',
          block: d.block || o.block || '',
          entry: d.entry || o.entry || '',
          apartment: d.apartment || o.apartment || '',
          floor: d.floor || o.floor || '',
          postal_code: d.postal || o.postal_code || '',
        },
      };
    }
  }

  return null;
}

const SELECT = 'id, display_id, delivery_type, customer_city, customer_address, street, street_number, quarter, apartment, floor, block, entry, postal_code, courier_office_code, courier_office_name, courier_office_city';

async function loadOffices() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('courier_offices')
      .select('courier, office_code, name, city, address')
      .eq('is_active', true)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

// Map of settlement name_lc → [{ region_lc, municipality }] for община lookup.
// Only rows that actually have a municipality are loaded.
async function loadSettlements() {
  const map = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bg_settlements')
      .select('name_lc, region, municipality')
      .not('municipality', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const s of data) {
      const key = (s.name_lc || '').trim();
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push({ region_lc: (s.region || '').toLowerCase(), municipality: s.municipality });
      map.set(key, arr);
    }
    if (data.length < 1000) break;
  }
  return map;
}

// Order ids that already carry a restructure snapshot — they've been processed
// once and must never be touched again (the guard against the no-street rows
// that otherwise re-qualify every run and concatenate the city).
async function loadProcessed() {
  const set = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('order_notes').select('order_id')
      .like('text', 'Address auto-restructured%').range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const n of data) set.add(n.order_id);
    if (data.length < 1000) break;
  }
  return set;
}

async function revert() {
  console.log('── REVERT: restoring originals from backup notes ──');
  let restored = 0;
  for (let from = 0; ; from += 1000) {
    const { data: notes, error } = await supabase
      .from('order_notes').select('id, order_id, text')
      .like('text', 'Address auto-restructured%').range(from, from + 999);
    if (error) throw error;
    if (!notes || notes.length === 0) break;
    for (const n of notes) {
      let orig = null;
      const j = n.text.match(/__ORIG__(\{[\s\S]*\})\s*$/);
      if (j) { try { orig = JSON.parse(j[1]); } catch { /* */ } }
      if (!orig) {
        const m = n.text.match(/Original: city="([\s\S]*?)" addr="([\s\S]*?)"\s*$/);
        if (m) orig = { customer_city: m[1], customer_address: m[2], street: '', block: '', apartment: '', floor: '', postal_code: '' };
      }
      if (!orig) continue;
      // Snapshots written before the building→block rename carry a stale key —
      // map it across so the restore targets a column that still exists.
      if ('building' in orig) { orig.block = orig.block ?? orig.building; delete orig.building; }
      await supabase.from('orders').update(orig).eq('id', n.order_id);
      await supabase.from('order_notes').delete().eq('id', n.id);
      restored++;
    }
    if (notes.length < 1000) break;
  }
  console.log(`Restored ${restored} orders.`);
}

async function main() {
  if (process.argv.includes('--revert')) return revert();
  console.log(COMMIT
    ? `── COMMIT (${ONLY || 'all'}, high-confidence${MAX !== Infinity ? `, max ${MAX}` : ''}) ──`
    : `── DRY RUN — ${ONLY || 'all'} (showing ${SAMPLE_LIMIT}) ──`);

  const offices = await loadOffices();
  const settlements = await loadSettlements();
  const processed = await loadProcessed();
  console.log(`Loaded ${offices.length} courier offices, ${settlements.size} settlement names, ${processed.size} already-processed orders.\n`);

  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let total = 0, shown = 0, committed = 0, skipped = 0;
  const PAGE = 1000;

  outer:
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('orders').select(SELECT).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const o of data) {
      total++;
      // Once-only: never re-touch an order we've already restructured (its
      // snapshot exists). Prevents the no-street re-qualification loop.
      if (processed.has(o.id)) { skipped++; continue; }
      const plan = planFix(o, offices, settlements);
      if (!plan) { skipped++; continue; }
      if (ONLY === 'home' && plan.reason === 'C') { skipped++; continue; }
      if (ONLY === 'courier' && plan.reason !== 'C') { skipped++; continue; }
      counts[plan.reason]++;

      const show = COMMIT ? committed < MAX : shown < SAMPLE_LIMIT;
      if (show) {
        shown++;
        console.log(`\n${o.display_id}  [Case ${plan.reason}]${plan.note ? '  ' + plan.note : ''}`);
        console.log(`  was: city="${o.customer_city || ''}" | addr="${o.customer_address || ''}"`);
        if (plan.reason === 'C') {
          console.log(`  now: ${plan.update.delivery_type} office #${plan.update.courier_office_code} — ${plan.update.courier_office_name} (${plan.update.courier_office_city})`);
        } else {
          console.log(`  now: city="${plan.update.customer_city}" | quarter="${plan.update.quarter}" | street="${plan.update.street}" №"${plan.update.street_number}" | postal="${plan.update.postal_code}" бл"${plan.update.block}" вх"${plan.update.entry}" ап"${plan.update.apartment}" ет"${plan.update.floor}"`);
        }
      }

      if (COMMIT) {
        if (committed >= MAX) break outer;
        const orig = {
          customer_city: o.customer_city || '', customer_address: o.customer_address || '',
          street: o.street || '', street_number: o.street_number || '', quarter: o.quarter || '',
          block: o.block || '', entry: o.entry || '',
          apartment: o.apartment || '', floor: o.floor || '', postal_code: o.postal_code || '',
          delivery_type: o.delivery_type || 'home',
          courier_office_code: o.courier_office_code || '', courier_office_name: o.courier_office_name || '',
          courier_office_city: o.courier_office_city || '',
        };
        await supabase.from('order_notes').insert({
          order_id: o.id,
          text: `Address auto-restructured (Case ${plan.reason}). __ORIG__${JSON.stringify(orig)}`,
          author_name: 'System',
        });
        await supabase.from('orders').update(plan.update).eq('id', o.id);
        committed++;
        if (committed >= MAX) break outer;
      }
    }
    if (data.length < PAGE) break;
  }

  console.log(`\n──────────────`);
  if (COMMIT) {
    console.log(`Committed: ${committed}${MAX !== Infinity ? ` (test batch)` : ''}. Originals saved to order_notes.`);
  } else {
    console.log(`Scanned ${total} orders. Confident fixes — A: ${counts.A}, B: ${counts.B}, D: ${counts.D} (home), C: ${counts.C} (courier). Skipped: ${skipped}.`);
    console.log('Dry run — add --commit to apply.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
