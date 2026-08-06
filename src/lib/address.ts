// Shared Macedonian-address helpers for the delivery prefill.
//
// The composer emits Macedonian markers (бр. / згр. / влез / кат / стан) — that
// line is printed on the parcel and read by the MEX driver. The PARSER still
// understands the Bulgarian ones (№ / бл. / вх. / ет. / ап. / ж.к. / обл.)
// because it is the fallback for the 80.388 orders inherited from the Bulgarian
// fork. Add markers here; never remove one.
//
// Historical orders stored addresses inconsistently — streets in the city
// field, Econt/Speedy office strings in "home" orders, etc. These helpers let
// the order modals recognise courier orders and avoid bleeding office text
// into the Home Address fields. Display-time only (no DB mutation) — the agent
// confirms and a clean structured record is written on save.

import type { DeliveryType, DeliveryValue, HomeCourier } from '@/components/DeliveryMethodPicker';

/** The granular home-address parts, in any source shape (order row, profile,
 *  or live DeliveryValue). All optional so callers can pass a raw record. */
export interface HomeAddressParts {
  quarter?: string | null;
  street?: string | null;
  street_number?: string | null;
  block?: string | null;
  entry?: string | null;
  floor?: string | null;
  apartment?: string | null;
}

/**
 * The canonical single-line Bulgarian home address used everywhere (warehouse
 * CSV, legacy customer_address, search/profile display). Print/warehouse order:
 *   quarter, street № number, бл. block, вх. entry, ет. floor, ап. apartment
 * Empty parts are omitted, so quarter leads only when present and the string
 * stays clean for partial addresses. City + postal_code live in their own
 * fields/columns and are never folded in here.
 */
export function composeHomeAddress(a: HomeAddressParts): string {
  const streetNo = [a.street, a.street_number && `бр. ${a.street_number}`].filter(Boolean).join(' ');
  return [
    a.quarter,
    streetNo,
    a.block && `згр. ${a.block}`,
    a.entry && `влез ${a.entry}`,
    a.floor && `кат ${a.floor}`,
    a.apartment && `стан ${a.apartment}`,
  ].filter(Boolean).join(', ');
}

/** The granular parts produced by parsing a single-line address blob. */
export interface ParsedHomeAddress {
  quarter: string;
  street: string;
  street_number: string;
  block: string;
  entry: string;
  floor: string;
  apartment: string;
  city: string;
  postal_code: string;
}

const cleanAddr = (s?: string | null): string =>
  (s || '').replace(/[«»"„""]/g, '').replace(/\s+/g, ' ').replace(/^[\s,;.-]+|[\s,;.-]+$/g, '').trim();

// A trailing house number (optionally marked No/№/номер), e.g. "Гоце Делчев 18".
const TRAILING_NUMBER = /(?:№|No|бр|број|номер)?\.?\s*(\d+[А-Яа-яЀ-ӿA-Za-z]?)\s*$/i;

/**
 * Move a trailing house number out of the `street` field into `street_number`,
 * e.g. { street: "Гоце Делчев 18" } → { street: "Гоце Делчев", street_number: "18" }.
 * No-op when `street_number` is already set, when `street` is empty, or when the
 * number is the entire street value (the index > 0 guard keeps a bare-number or
 * leading-number name like "ул. 3-ти март" intact).
 *
 * This is what lets the warehouse CSV emit the "№ <n>" marker even when an agent
 * typed the number into Street — without it, BigArena can't parse the house
 * number and the delivery fails. Used by `parseHomeAddress`, `effectiveHomeParts`
 * (export), and the order form's Street field.
 */
export function splitTrailingHouseNumber<T extends HomeAddressParts>(parts: T): T {
  const street = (parts.street || '').trim();
  if (!street || (parts.street_number || '').trim()) return parts;
  const nm = street.match(TRAILING_NUMBER);
  if (nm && nm.index !== undefined && nm.index > 0) {
    return { ...parts, street: cleanAddr(street.slice(0, nm.index)), street_number: nm[1] };
  }
  return parts;
}

// Markers that end a street / quarter / city run. Mirrors the conservative
// patterns proven in scripts/fix-home-addresses.mjs.
const PART_BOUNDARY =
  String.raw`(?=[,;]|\s+(?:с\.|село|гр\.|град|кв\.|ж\.?\s?к|квартал|нас\.|населба|н\.м\.|бл\.|блок|згр\.|зграда|ет\.|ап\.|вх\.|кат|стан|влез|вл\.|бр\.|број|общ\.|општ\.|општина|обл\.|\d{4})|$)`;

/**
 * Reverse of `composeHomeAddress` — splits a legacy single-line address blob
 * (e.g. "ул. Шипка 6  с. Ловско обл. Разград 7291") into the granular fields so
 * each part lands in its own input instead of everything being dumped into
 * Street. Display/prefill only — non-destructive; the agent confirms and a clean
 * structured record is written on save.
 *
 * - Region ("обл. …") is stripped (derived, not a stored field).
 * - Village ("с. …") / town ("гр. …") → the single City/Village field.
 * - A courier-office blob is NOT parsed (returns empty) — the courier tab owns it.
 * - `city` (when a clean, non-courier value is passed) wins over a value mined
 *   from the blob.
 */
export function parseHomeAddress(blob?: string | null, city?: string | null): ParsedHomeAddress {
  const out: ParsedHomeAddress = {
    quarter: '', street: '', street_number: '', block: '', entry: '',
    floor: '', apartment: '', city: '', postal_code: '',
  };
  const providedCity = looksLikeCourier(city) ? '' : cleanAddr(city);
  if (providedCity) out.city = providedCity;

  const raw = cleanAddr(blob);
  if (!raw || looksLikeCourier(raw)) return out;

  // Work on a padded copy so `(?:^|[\s,])` anchors match the first token too.
  let residue = ` ${raw} `;
  const grab = (re: RegExp, set: (m: RegExpMatchArray) => void): void => {
    const m = residue.match(re);
    if (m) { set(m); residue = residue.replace(m[0], ' '); }
  };

  // Region — strip, never stored.
  grab(/(?:^|[\s,])обл(?:аст)?\.?\s*[А-Яа-яA-Za-z. '-]+/i, () => {});
  // Family-name tail ("сем. Колеви" / "семейство …") — not an address part.
  grab(/(?:^|[\s,])сем(?:ейство)?\.?\s+[А-Яа-я][А-Яа-я-]+/i, () => {});
  // Postal — a standalone 4-digit BG code.
  grab(/(?<!\d)\d{4}(?!\d)/, (m) => { out.postal_code = m[0].trim(); });
  // Building parts.
  grab(/(?:^|[\s,(])бл\.?\s*(\d[0-9A-Za-zА-Яа-я]*)/i, (m) => { out.block = m[1]; });
  grab(/(?:^|[\s,(])вх\.?\s*(?:од)?\s*([0-9A-Za-zА-Яа-я]+)/i, (m) => { out.entry = m[1]; });
  grab(/(?:^|[\s,(])ет\.?\s*(?:аж)?\s*(\d+)/i, (m) => { out.floor = m[1]; });
  grab(/(?:^|[\s,(])ап\.?\s*(?:артамент)?\s*(\d+)/i, (m) => { out.apartment = m[1]; });
  // Quarter / complex.
  grab(new RegExp(String.raw`(?:^|[\s,])((?:кв\.|ж\.?\s?к\.?|квартал)\s*[А-Яа-яA-Za-z0-9 .'-]+?)` + PART_BOUNDARY, 'i'),
    (m) => { out.quarter = cleanAddr(m[1]); });
  // Village / town → City field (only when not already provided).
  if (!out.city) {
    grab(new RegExp(String.raw`(?:^|[\s,])(с\.\s*[А-Яа-яA-Za-z .'-]+?)` + PART_BOUNDARY, 'i'),
      (m) => { out.city = cleanAddr(m[1]); });
    if (!out.city) {
      grab(new RegExp(String.raw`(?:^|[\s,])(гр\.\s*[А-Яа-яA-Za-z .'-]+?)` + PART_BOUNDARY, 'i'),
        (m) => { out.city = cleanAddr(m[1]); });
    }
  } else {
    // Drop any settlement token from the residue so it can't become the street.
    grab(new RegExp(String.raw`(?:^|[\s,])(?:с\.|гр\.)\s*[А-Яа-яA-Za-z .'-]+?` + PART_BOUNDARY, 'i'), () => {});
  }
  // Street — explicit ул./бул./пл. marker first (digits allowed so numeric names
  // like "ул. 3-ти март" survive), else whatever text remains.
  grab(new RegExp(String.raw`((?:ул\.?|бул\.?|пл\.)\s*[А-Яа-яA-Za-z0-9 .№#'-]+?)` + PART_BOUNDARY, 'i'),
    (m) => { out.street = cleanAddr(m[1]); });
  if (!out.street) {
    const rem = cleanAddr(residue);
    if (rem && /[А-Яа-яA-Za-z]/.test(rem)) out.street = rem;
  }
  // Split a trailing house number (with optional No/№/номер marker) into the № field.
  return splitTrailingHouseNumber(out);
}

/**
 * The home-address parts that should actually ship, resolved from a stored order
 * (or merged profile+order) row — the single source of truth shared by the
 * warehouse CSV and the pre-export validator, so they always agree.
 *
 * - Structured columns win, with a stray house number split out of Street.
 * - A legacy blob-only row (no structured columns) is parsed apart instead.
 */
export function effectiveHomeParts(o: {
  street?: string | null; street_number?: string | null; quarter?: string | null;
  block?: string | null; entry?: string | null; floor?: string | null; apartment?: string | null;
  customer_address?: string | null; customer_city?: string | null; postal_code?: string | null;
}): ParsedHomeAddress {
  const hasStructured = !!(o.street || o.quarter || o.street_number || o.block);
  if (hasStructured) {
    const s = splitTrailingHouseNumber({
      street: o.street || '', street_number: o.street_number || '', quarter: o.quarter || '',
      block: o.block || '', entry: o.entry || '', floor: o.floor || '', apartment: o.apartment || '',
    });
    return {
      quarter: s.quarter || '', street: s.street || '', street_number: s.street_number || '',
      block: s.block || '', entry: s.entry || '', floor: s.floor || '', apartment: s.apartment || '',
      city: o.customer_city || '', postal_code: o.postal_code || '',
    };
  }
  return parseHomeAddress(o.customer_address, o.customer_city);
}

/** Detect a courier from free text. Returns the matching office delivery type. */
export function detectCourierType(...texts: (string | null | undefined)[]): DeliveryType | null {
  const blob = texts.filter(Boolean).join(' ');
  if (!blob) return null;
  if (/еконт|econt/i.test(blob)) return 'econt_office';
  if (/спиди|speedy/i.test(blob)) return 'speedy_office';
  if (/мекс|mex/i.test(blob)) return 'mex_office';
  return null;
}

/** True if the text looks like a courier-office reference rather than a city. */
export function looksLikeCourier(text?: string | null): boolean {
  return !!text && /(еконт|econt|спиди|speedy|мекс|mex|офис|автомат)/i.test(text);
}

/** True if the text carries granular address detail (street/quarter/building),
 *  i.e. it's a packed address blob rather than a plain settlement name. Used to
 *  decide whether a value sitting in the City field is actually a whole address
 *  that should be parsed apart (e.g. "жк Тракия, бл 183, вх Г, ет. 4, ап 12"). */
export function looksLikeStructuredDetail(text?: string | null): boolean {
  return !!text && /(?:ул\.|бул\.|пл\.|кв\.|нас\.|н\.м\.|ж\.?\s?к|бл[\s.]|згр[\s.]|вх[\s.]|ет[\s.]|ап[\s.]|кат\s|стан\s|влез\s|бр[\s.])/i.test(text);
}

interface PrefillSource {
  delivery_type?: string | null;
  customer_city?: string | null;
  customer_address?: string | null;
  street?: string | null;
  street_number?: string | null;
  quarter?: string | null;
  apartment?: string | null;
  floor?: string | null;
  block?: string | null;
  entry?: string | null;
  postal_code?: string | null;
  home_courier?: string | null;
  courier_office_code?: string | null;
  courier_office_name?: string | null;
  courier_office_city?: string | null;
}

/**
 * Build a clean DeliveryValue from a stored order (or merged profile+order).
 * - Courier orders (structured type OR free-text courier name) → courier tab,
 *   with the office prefilled when the structured code exists. Home fields stay
 *   empty so office text never shows under Home Address.
 * - Home orders → keep clean structured fields; drop a city value that's
 *   actually courier text.
 */
export function resolveDeliveryPrefill(src: PrefillSource): DeliveryValue {
  const structured = src.delivery_type;
  const blob = `${src.customer_address || ''} ${src.customer_city || ''} ${src.street || ''}`;
  const type: DeliveryType =
    (structured === 'speedy_office' || structured === 'econt_office' || structured === 'mex_office')
      ? structured
      : (detectCourierType(blob) || 'home');

  // MEX is the only Macedonian carrier, so an order with nothing stored is a
  // MEX order. A stored speedy/econt is preserved verbatim — those 80.388
  // historical rows must keep showing the courier that actually carried them.
  const homeCourier: HomeCourier =
    (src.home_courier === 'speedy' || src.home_courier === 'econt' || src.home_courier === 'mex')
      ? src.home_courier
      : 'mex';

  if (type !== 'home') {
    return {
      delivery_type: type,
      street: '', street_number: '', quarter: '', apartment: '', floor: '', block: '', entry: '', city: '',
      postal_code: src.postal_code || '',
      home_courier: homeCourier,
      courier_office_code: src.courier_office_code || '',
      courier_office_name: src.courier_office_name || '',
      courier_office_city: src.courier_office_city || '',
    };
  }

  const cityRaw = src.customer_city || '';
  const cleanCity = looksLikeCourier(cityRaw) ? '' : cityRaw;
  const addrRaw = src.customer_address || '';
  // Legacy rows stored the whole address as one blob with empty structured
  // columns. When that's the case, parse the blob so each part lands in its own
  // field instead of dumping everything into Street.
  const parsed = (!src.street && addrRaw && !looksLikeCourier(addrRaw))
    ? parseHomeAddress(addrRaw, cleanCity)
    : null;

  return {
    delivery_type: 'home',
    street: src.street || parsed?.street || '',
    street_number: src.street_number || parsed?.street_number || '',
    quarter: src.quarter || parsed?.quarter || '',
    apartment: src.apartment || parsed?.apartment || '',
    floor: src.floor || parsed?.floor || '',
    block: src.block || parsed?.block || '',
    entry: src.entry || parsed?.entry || '',
    city: cleanCity || parsed?.city || '',
    postal_code: src.postal_code || parsed?.postal_code || '',
    home_courier: homeCourier,
    courier_office_code: '', courier_office_name: '', courier_office_city: '',
  };
}
