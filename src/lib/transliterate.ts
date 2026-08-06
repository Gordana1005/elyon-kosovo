/**
 * Cyrillic ↔ Latin transliteration for search.
 *
 * Two separate normalisers live here and they are NOT interchangeable:
 *
 *   normalizeForSearch()  — general search over people, products and courier
 *                           offices. Digraph style (ж→zh, ч→ch), inherited from
 *                           the Bulgarian fork. Used by the helpers pane, the
 *                           office filter, the importers and phone recovery.
 *
 *   normalizeMkGeo()      — Macedonian PLACE NAMES only. Aggressively lossy, so
 *                           that MEX Poshta's inconsistent Latin ("Kicevo" and
 *                           "Kočani" in the same list), our Cyrillic and OSM's
 *                           name:en all collapse onto one key. Never use it for
 *                           product or person search — it folds ц and ч
 *                           together and would produce false hits.
 *
 * MUST stay in sync with:
 * - scripts/lib/mk-translit.mjs      (normalizeMkGeo + splitMexCityName)
 * - scripts/lib/phone-recovery.mjs   (CYR_TO_LAT)
 * - scripts/import-cpa-xlsx.mjs      (CYR_TO_LAT)
 * - scripts/import-outbound-xlsx.mjs (CYR_TO_LAT)
 * - scripts/scrape-courier-offices.mjs (CYR_TO_LAT)
 * - supabase/functions/api/index.ts  (CYR_TO_LAT + qNorm)
 *
 * src/lib/transliterate.test.ts imports the .mjs copy and asserts it agrees
 * with this file over a corpus, so drift in normalizeMkGeo fails the suite.
 */

const CYR_TO_LAT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s',
  'т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht',
  'ъ':'a','ь':'y','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ж':'Zh','З':'Z','И':'I',
  'Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S',
  'Т':'T','У':'U','Ф':'F','Х':'H','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sht',
  'Ъ':'A','Ь':'Y','Ю':'Yu','Я':'Ya',
  // ── Macedonian-only letters (added 2026-08-06) ──────────────────────────
  // These seven have no Bulgarian equivalent and were previously absent, so
  // they passed through UNCHANGED and left a mixed-script key: "Ѓорѓи" became
  // "ѓorѓi", which no Latin query could ever match. Macedonian given names
  // (Ѓорѓи, Јован, Љупчо, Њаки, Џабир) and place names hit this constantly.
  // Purely additive — nothing that transliterated correctly before changes.
  'ѓ':'gj','ѕ':'dz','ј':'j','љ':'lj','њ':'nj','ќ':'kj','џ':'dzh',
  'Ѓ':'Gj','Ѕ':'Dz','Ј':'J','Љ':'Lj','Њ':'Nj','Ќ':'Kj','Џ':'Dzh',
  // Accented е/и, valid Macedonian orthography (ѐден, ѝ).
  'ѐ':'e','ѝ':'i','Ѐ':'E','Ѝ':'I',
};

/**
 * Transliterates Cyrillic to Latin (case-preserving where possible).
 * Also normalizes common "СП" → "SP" suffix.
 * Non-Cyrillic chars are left as-is.
 */
export function transliterate(s: string): string {
  if (!s) return '';
  let out = String(s);
  // SP suffix override (common in BG product names)
  out = out.replace(/СП/g, 'SP').replace(/сп/g, 'sp');
  return out.split('').map(c => CYR_TO_LAT[c] ?? c).join('');
}

/**
 * Normalizes a string for search: transliterate + lowercase.
 * This lets Latin input match Cyrillic data (and vice-versa).
 */
export function normalizeForSearch(s: string): string {
  return transliterate(s).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Macedonian geo normalisation — mirror of scripts/lib/mk-translit.mjs.
// See that file's header for the full rationale and worked examples.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase Macedonian (plus stray Bulgarian/Serbian) Cyrillic → bare Latin.
 * Values are already digraph-free and diacritic-free, so the Latin folding
 * below is a no-op on anything this table produces.
 */
const MK_CYR_TO_LAT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','ѓ':'g','е':'e',
  'ж':'z','з':'z','ѕ':'d','и':'i','ј':'j','к':'k','л':'l',
  'љ':'l','м':'m','н':'n','њ':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','ќ':'k','у':'u','ф':'f','х':'h','ц':'c',
  'ч':'c','џ':'d','ш':'s',
  // Not Macedonian, but present in data inherited from the Bulgarian fork and
  // in Serbian spellings of border settlements.
  'й':'j','щ':'st','ъ':'a','ь':'j','ю':'u','я':'a',
  'ы':'i','э':'e','ё':'e','ђ':'d','ћ':'c','ѐ':'e','ѝ':'i',
};

// Unicode combining marks (U+0300..U+036F). Written as escapes on purpose:
// the literal characters are invisible in an editor and this repo has a
// history of escape-mangling in checked-in files.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Latin digraphs → the same single letters MK_CYR_TO_LAT produces.
 * Applied to EVERY input, Cyrillic-derived or not, so both sides of a
 * comparison go through an identical pipeline. Longest first: "dzh" would
 * otherwise be eaten by "dz".
 */
const LATIN_DIGRAPHS: Array<[string, string]> = [
  ['dzh','d'], ['zh','z'], ['sh','s'], ['ch','c'], ['dz','d'],
  ['dj','d'], ['gj','g'], ['kj','k'], ['lj','l'], ['nj','n'],
  ['ts','c'],
];

/**
 * Normalise a Macedonian place name to a comparison key. Returns '' for empty
 * input. Lossy by design — see the module header.
 *
 *   Штип · Stip · Štip            → "stip"
 *   Ѓорче Петров · Gjorce Petrov  → "gorcepetrov"
 *   Кичево · Kicevo · Kičevo      → "kicevo"
 */
export function normalizeMkGeo(s: string): string {
  if (!s) return '';
  let out = String(s).toLowerCase();

  out = out.split('').map(c => MK_CYR_TO_LAT[c] ?? c).join('');

  // Strip diacritics: č→c, š→s, ž→z, ć→c, ǵ→g, ḱ→k, ë→e.
  out = out.normalize('NFD').replace(COMBINING_MARKS, '');
  // These have no canonical decomposition, so NFD leaves them intact.
  out = out.replace(/ç/g, 'c').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ø/g, 'o');

  for (const [from, to] of LATIN_DIGRAPHS) out = out.split(from).join(to);

  return out.replace(/[^a-z0-9]/g, '');
}

/**
 * Split a raw MEX city_name into parent city + leaf neighbourhood.
 *
 *   "Skopje - Aerodrom" → { parent: 'skopje', leaf: 'aerodrom' }
 *   "Bitola"            → { parent: null,     leaf: 'bitola'   }
 */
export function splitMexCityName(raw: string): { parent: string | null; leaf: string } {
  const s = String(raw || '').trim();
  const m = s.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (!m) return { parent: null, leaf: normalizeMkGeo(s) };
  return { parent: normalizeMkGeo(m[1]), leaf: normalizeMkGeo(m[2]) };
}
