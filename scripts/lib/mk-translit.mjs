// Macedonian geo-name normalisation — the join key between three spellings of
// the same place.
//
// The problem this solves: MEX Poshta's get_cities.php returns 149 Latin-only
// zone names with no consistent transliteration of its own. Their list contains
// "Kicevo" next to "Kočani", "Štip" AND "Stip" as two separate rows, "Skopje -
// Keramidnica" AND "SKOPJE-KERAMIDNICA", "Zhelino" next to "Vrapčište". Our
// agents type Macedonian Cyrillic. OSM gives us Cyrillic plus a Latin name:en.
// Nothing lines up.
//
// normalizeMkGeo() collapses all of it onto one aggressively lossy key:
//   Штип · Stip · Štip                    → "stip"
//   Ѓорче Петров · Gjorce Petrov          → "gorcepetrov"
//   Џепчиште · Dzepciste · Џепчиште       → "depciste"
//   Кичево · Kicevo · Kičevo              → "kicevo"
//
// It is lossy ON PURPOSE — ж/з both become "z", ц/ч both become "c", ш/с both
// become "s". A false collision is caught by the human review step in
// map-settlements-to-mex.mjs (which reports every key claimed by more than one
// settlement); a missed match is silent and leaves a settlement unroutable. We
// optimise for recall and let a person adjudicate.
//
// This is NOT a replacement for src/lib/transliterate.ts `normalizeForSearch`,
// which stays Bulgarian and keeps serving product/office search. This one is
// only ever used for Macedonian place names.
//
// ── SYNC CONTRACT ──────────────────────────────────────────────────────────
// Mirrored in src/lib/transliterate.ts (the browser needs it too, and importing
// a .mjs from outside src/ into the Vite graph is not worth the build risk).
// src/lib/transliterate.test.ts imports BOTH and asserts they agree over a
// corpus — if you edit one and not the other, that test fails.

/**
 * Lowercase Macedonian (plus stray Bulgarian/Serbian) Cyrillic → bare Latin.
 * Values are already digraph-free and diacritic-free, so the Latin folding
 * below is a no-op on anything this table produces.
 */
const MK_CYR_TO_LAT = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ѓ': 'g', 'е': 'e',
  'ж': 'z', 'з': 'z', 'ѕ': 'd', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l',
  'љ': 'l', 'м': 'm', 'н': 'n', 'њ': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'ќ': 'k', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c',
  'ч': 'c', 'џ': 'd', 'ш': 's',
  // Not Macedonian, but present in data inherited from the Bulgarian fork and
  // in Serbian spellings of border settlements. Mapped so they never survive
  // into a key as raw Cyrillic.
  'й': 'j', 'щ': 'st', 'ъ': 'a', 'ь': 'j', 'ю': 'u', 'я': 'a',
  'ы': 'i', 'э': 'e', 'ё': 'e', 'ђ': 'd', 'ћ': 'c', 'ѐ': 'e', 'ѝ': 'i',
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
const LATIN_DIGRAPHS = [
  ['dzh', 'd'], ['zh', 'z'], ['sh', 's'], ['ch', 'c'], ['dz', 'd'],
  ['dj', 'd'], ['gj', 'g'], ['kj', 'k'], ['lj', 'l'], ['nj', 'n'],
  ['ts', 'c'],
];

/**
 * Normalise a Macedonian place name (city, village, municipality, street) to a
 * comparison key. Returns '' for empty input.
 *
 * Pipeline: lowercase → Cyrillic to Latin → strip diacritics → fold digraphs →
 * drop everything that isn't a-z0-9.
 */
export function normalizeMkGeo(s) {
  if (!s) return '';
  let out = String(s).toLowerCase();

  // Cyrillic → Latin.
  out = out.split('').map(c => MK_CYR_TO_LAT[c] ?? c).join('');

  // Strip diacritics: č→c, š→s, ž→z, ć→c, ǵ→g, ḱ→k, ë→e. NFD decomposes the
  // letter into base + combining mark; the range below drops the marks.
  out = out.normalize('NFD').replace(COMBINING_MARKS, '');
  // These have no canonical decomposition, so NFD leaves them intact.
  out = out.replace(/ç/g, 'c').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ø/g, 'o');

  for (const [from, to] of LATIN_DIGRAPHS) out = out.split(from).join(to);

  return out.replace(/[^a-z0-9]/g, '');
}

/**
 * MEX explodes Skopje and Tetovo into prefixed zones — "Skopje - Aerodrom",
 * "SKOPJE-DUCANDZIK", "Tetovo - Zhelino". Split a raw MEX city_name into its
 * parent city and leaf neighbourhood so the leaf can be matched against a
 * `city_district` settlement instead of failing outright.
 *
 * Returns { parent, leaf } as normalised keys, or { parent: null, leaf } when
 * the name carries no prefix.
 *
 *   "Skopje - Aerodrom"  → { parent: 'skopje', leaf: 'aerodrom' }
 *   "SKOPJE-DUCANDZIK"   → { parent: 'skopje', leaf: 'ducandik' }
 *   "Bitola"             → { parent: null,     leaf: 'bitola'   }
 */
export function splitMexCityName(raw) {
  const s = String(raw || '').trim();
  // Separator is " - " or a bare "-"; only the FIRST one splits, so
  // "Tetovo - Lesnica dolna" keeps its two-word leaf intact.
  const m = s.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (!m) return { parent: null, leaf: normalizeMkGeo(s) };
  return { parent: normalizeMkGeo(m[1]), leaf: normalizeMkGeo(m[2]) };
}
