import { describe, it, expect } from 'vitest';
import { normalizeForSearch, normalizeMkGeo, splitMexCityName, transliterate } from './transliterate';
// The .mjs copy the ingest scripts use. Importing it here is what turns the
// "keep these in sync" comment into an actual gate.
import {
  normalizeMkGeo as mjsNormalizeMkGeo,
  splitMexCityName as mjsSplitMexCityName,
} from '../../scripts/lib/mk-translit.mjs';

// Real rows from MEX's get_cities.php (country_id=157) paired with the
// Macedonian Cyrillic our agents actually type. Every pair MUST collapse to one
// key or the settlement→zone mapper silently leaves the place unroutable.
const CYRILLIC_LATIN_PAIRS: Array<[string, string]> = [
  ['Штип', 'Stip'],
  ['Штип', 'Štip'],
  ['Кичево', 'Kicevo'],
  ['Кичево', 'Kičevo'],
  ['Кочани', 'Kočani'],
  ['Ѓорче Петров', 'Gjorce Petrov'],
  ['Џепчиште', 'Dzepciste'],
  ['Шипковица', 'Shipkovica'],
  ['Желино', 'Zhelino'],
  ['Врапчиште', 'Vrapčište'],
  ['Карпош', 'Karpoš'],
  ['Цегране', 'Cegrane'],
  ['Скопје', 'Skopje'],
  ['Свети Николе', 'Sveti Nikole'],
  ['Боговиње', 'Bogovinje'],
  ['Јегуновце', 'Jegunovce'],
  ['Македонски Брод', 'Makedonski Brod'],
  ['Крива Паланка', 'Kriva Palanka'],
  ['Демир Хисар', 'Demir Hisar'],
  ['Вевчани', 'Vevčani'],
  ['Битола', 'Bitola'],
  ['Куманово', 'Kumanovo'],
  ['Тетово', 'Tetovo'],
  ['Гостивар', 'Gostivar'],
  ['Охрид', 'Ohrid'],
  ['Струмица', 'Strumica'],
  ['Прилеп', 'Prilep'],
  ['Дебар', 'Debar'],
];

describe('normalizeMkGeo', () => {
  it.each(CYRILLIC_LATIN_PAIRS)('collapses %s and %s onto one key', (cyr, lat) => {
    expect(normalizeMkGeo(cyr)).toBe(normalizeMkGeo(lat));
    expect(normalizeMkGeo(cyr)).not.toBe('');
  });

  // MEX ships these as two separate city_id rows for the same town. The mapper
  // relies on them colliding so it can pick one canonical id.
  it('collapses MEX\'s own duplicate rows', () => {
    expect(normalizeMkGeo('Štip')).toBe(normalizeMkGeo('Stip'));
    expect(normalizeMkGeo('Skopje - Keramidnica')).toBe(normalizeMkGeo('SKOPJE-KERAMIDNICA'));
  });

  // Different names for the same place must NOT auto-collapse — that is the
  // alias table's job, with a human deciding. Guessing here would route parcels
  // to the wrong town, and MEX has no cancellation endpoint.
  it('does not guess that differently-named places are the same', () => {
    expect(normalizeMkGeo('Aracinovo Haracine')).not.toBe(normalizeMkGeo('Haracine'));
    expect(normalizeMkGeo('Kërçovë')).not.toBe(normalizeMkGeo('Кичево'));
  });

  it('is empty-safe', () => {
    expect(normalizeMkGeo('')).toBe('');
    expect(normalizeMkGeo(null as unknown as string)).toBe('');
  });

  it('strips punctuation, case and spacing', () => {
    expect(normalizeMkGeo('  SVETI   NIKOLE  ')).toBe(normalizeMkGeo('Sveti Nikole'));
  });
});

describe('splitMexCityName', () => {
  it('splits MEX\'s prefixed Skopje and Tetovo zones', () => {
    expect(splitMexCityName('Skopje - Aerodrom')).toEqual({ parent: 'skopje', leaf: 'aerodrom' });
    expect(splitMexCityName('SKOPJE-DUCANDZIK').parent).toBe('skopje');
    expect(splitMexCityName('Gostivar - Vrapčište')).toEqual({ parent: 'gostivar', leaf: 'vrapciste' });
  });

  it('keeps a multi-word leaf intact', () => {
    expect(splitMexCityName('Tetovo - Lesnica dolna')).toEqual({ parent: 'tetovo', leaf: 'lesnicadolna' });
  });

  it('returns a null parent for an unprefixed city', () => {
    expect(splitMexCityName('Bitola')).toEqual({ parent: null, leaf: 'bitola' });
  });
});

// If this fails, someone edited one copy and not the other. Fix the drift —
// do not delete the test. A mapper that keys settlements differently from the
// runtime lookup produces zones that never match anything.
describe('scripts/lib/mk-translit.mjs stays in sync with this file', () => {
  const CORPUS = [
    ...CYRILLIC_LATIN_PAIRS.flat(),
    'Skopje - Aerodrom', 'SKOPJE-DUCANDZIK', 'Skopje - Aracinovo Haraçine',
    'Tetovo - Lesnica dolna', 'Kërçovë', 'Ѕвездан', 'Љуботен', 'Њуделхи',
    'Ѓорѓи Пулевски', 'Ќурчиска', 'бул. Партизански одреди', '', '  ',
  ];

  it.each(CORPUS)('normalizeMkGeo agrees on %j', (input) => {
    expect(mjsNormalizeMkGeo(input)).toBe(normalizeMkGeo(input));
  });

  it.each(CORPUS)('splitMexCityName agrees on %j', (input) => {
    expect(mjsSplitMexCityName(input)).toEqual(splitMexCityName(input));
  });
});

describe('normalizeForSearch keeps its Bulgarian behaviour', () => {
  // Regression guard: the MK letters were added to CYR_TO_LAT, and these
  // Bulgarian cases must be byte-identical to before that change.
  it('still uses digraph style for Bulgarian letters', () => {
    expect(normalizeForSearch('Диабетол')).toBe('diabetol');
    expect(transliterate('Щастие')).toBe('Shtastie');
    expect(transliterate('Ъгъл')).toBe('Agal');
    expect(normalizeForSearch('Чучулига')).toBe('chuchuliga');
  });

  // The whole point of the addition: these used to leak raw Cyrillic.
  it('now transliterates Macedonian letters instead of passing them through', () => {
    expect(normalizeForSearch('Ѓорѓи')).toBe('gjorgji');
    expect(normalizeForSearch('Јован')).toBe('jovan');
    expect(normalizeForSearch('Љупчо')).toBe('ljupcho');
    expect(normalizeForSearch('Џабир')).toBe('dzhabir');
    expect(normalizeForSearch('Ѕвезда')).toBe('dzvezda');
    expect(normalizeForSearch('Ќерка')).toBe('kjerka');
    // No Cyrillic survives into the key.
    expect(normalizeForSearch('Ѓорѓи Њаки Џабир')).not.toMatch(/[Ѐ-ӿ]/);
  });
});
