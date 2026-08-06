/**
 * AlterCPA vocabulary and fetch contract — Deno port of scripts/lib/altercpa.mjs
 * and the window logic in scripts/export-altercpa-mk.mjs.
 *
 * This is a PORT, not a rewrite. Everything here was derived from the LIVE API
 * during the 2026-08 history import, not from the published docs — the docs list
 * cancel reasons 1-15 while the data also carries 16-19, and they describe an
 * `items` map that is empty on every real order (the product actually lives in
 * `goods`). Keep the two files in step: the scripts are how a human inspects the
 * same data offline, and a divergence means the preview stops matching what the
 * bridge will actually store.
 *
 * The script version cannot simply be imported — it uses node:fs and ships in a
 * Node-only toolchain.
 */

/** AlterCPA `phase` — the reliable outcome field. `status` (1-12) is noisier. */
export const PHASE: Record<number, string> = {
  1: "processing", 2: "hold", 3: "approved", 4: "cancelled", 5: "trash",
};

/** phase → Elyon order_status. Approved counts as paid per the 2026-08-05 decision. */
export const PHASE_TO_STATUS: Record<number, string> = {
  1: "pending", 2: "pending", 3: "paid", 4: "cancelled", 5: "trashed",
};

/**
 * AlterCPA cancel reasons. 1-15 are documented; 16-19 are this account's own
 * custom codes and the API exposes no lookup for them. Their meaning was
 * recovered from the comments operators left alongside them.
 */
export const REASON: Record<number, string> = {
  0: "—", 1: "incorrect phone", 2: "changed mind", 3: "did not order",
  4: "requires certificate", 5: "wrong geo", 6: "errors/fakes", 7: "duplicate",
  8: "ordered elsewhere", 9: "expensive", 10: "unhappy with delivery",
  11: "could not reach", 12: "possible fraud", 13: "different language",
  14: "product didn't fit", 15: "offer disabled",
  16: "само консултација",   // rang for advice, not to buy
  17: "недостапен",          // phone off / never answered
  18: "враќа нарачки",       // known parcel returner; a do-not-ship flag
  19: "custom-19",
};

/**
 * MKD_PER_EUR is FROZEN at 61.5 — see src/lib/currency.ts. Never "update" it:
 * the denar is a managed NBRM peg, and changing the constant silently re-prices
 * every historical order. Re-price the catalogue in EUR instead.
 */
export const MKD_PER_EUR = 61.5;

/**
 * Per-currency divisor to EUR. Only rates we can defend belong here.
 *
 * A currency that is absent yields NULL, and the lead is mirrored WITHOUT a EUR
 * figure rather than with a guessed one — once a fabricated number is in a
 * report there is nothing to distinguish it from a real one. As the bridge takes
 * on more geos this table is the thing to extend, deliberately, per currency.
 */
export const FX_TO_EUR: Record<string, number> = {
  eur: 1,
  mkd: MKD_PER_EUR,
  bgn: 1.95583,   // fixed BNB peg — legally fixed, exact
  bam: 1.95583,   // Bosnian convertible mark — pegged to EUR at the old DEM rate, exact
  all: 100,       // Albanian lek, approximate
  rsd: 117,       // Serbian dinar, approximate
  ron: 4.97,      // Romanian leu, approximate
  huf: 395,       // Hungarian forint, approximate
  pln: 4.3,       // Polish złoty, approximate
  czk: 25.3,      // Czech koruna, approximate
  uah: 45,        // Ukrainian hryvnia, approximate
  try: 38,        // Turkish lira, approximate — moves fast, treat as indicative only
};
/** Legally fixed or hard-pegged: these convert exactly, the rest are indicative. */
export const EXACT_FX = new Set(["eur", "mkd", "bgn", "bam"]);

export function toEur(price: unknown, currency: unknown): number | null {
  const cur = String(currency || "mkd").toLowerCase();
  const div = FX_TO_EUR[cur];
  if (!div) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / div) * 100) / 100;
}

/**
 * AlterCPA and its affiliates smoke-test the funnel against the live account:
 * 314 MK orders were named "Пробный_Заказ", "Test Ninja", "Test Add Lead" and so
 * on, some from localhost or a Russian office IP, with cities like St Petersburg
 * and Helsinki. Every one was cancelled or trash, so excluding them costs no
 * revenue — but importing them invents customers who do not exist and parks them
 * in the Trash List forever.
 *
 * The pattern is deliberately narrow — anchored at the start of the name, so a
 * real surname containing those letters is never caught.
 */
const TEST_NAME = /^\s*(test\b|тест|проб|probn)/i;
export const isTestOrder = (o: AlterCpaOrder) => TEST_NAME.test(String(o?.name ?? ""));

/** The product name for an order: goods[0] wins, then the offer name. */
export function productNameOf(o: AlterCpaOrder): string {
  const g = (o.goods || [])[0];
  const fromGoods = String(g?.name ?? "").trim();
  if (fromGoods) return fromGoods;
  return String(o.offername ?? "").trim();
}

export function quantityOf(o: AlterCpaOrder): number {
  const g = (o.goods || [])[0];
  const q = Number(g?.count ?? o.count ?? 1);
  return Number.isFinite(q) && q >= 1 ? Math.floor(q) : 1;
}

/**
 * Country calling codes, by ISO-3166 alpha-2.
 *
 * This exists so a foreign lead shows ITS OWN real number. The api function's
 * normalizeMkPhone is a REWRITER, not a validator: it strips any country code it
 * does not recognise and prefixes +389 regardless, so a Romanian
 * +40 721 234 567 comes back as +38940721234567 — a number that does not exist,
 * stored, dialled and matched as if it did. Nothing here may ever do that.
 *
 * Calling codes are facts, not guesses (Romania IS +40), so covering the geos an
 * affiliate network actually runs is safe. Add a country the moment traffic
 * appears from it — an absent geo yields null, never a wrong number.
 */
const DIAL_CODES: Record<string, string> = {
  // Balkans / SEE
  MK: "389", AL: "355", RS: "381", BA: "387", ME: "382", XK: "383",
  BG: "359", RO: "40", GR: "30", HR: "385", SI: "386", HU: "36",
  // Central & Eastern Europe
  PL: "48", CZ: "420", SK: "421", LT: "370", LV: "371", EE: "372",
  UA: "380", MD: "373", BY: "375", RU: "7", KZ: "7", GE: "995", AM: "374", AZ: "994",
  // Western & Northern Europe
  DE: "49", AT: "43", CH: "41", IT: "39", ES: "34", PT: "351", FR: "33",
  BE: "32", NL: "31", LU: "352", GB: "44", IE: "353", DK: "45", SE: "46",
  NO: "47", FI: "358", IS: "354", MT: "356", CY: "357",
  // Others that show up in CPA traffic
  TR: "90", IL: "972", AE: "971", SA: "966", EG: "20", MA: "212", TN: "216", DZ: "213",
  US: "1", CA: "1", MX: "52", BR: "55", CL: "56", CO: "57", PE: "51", AR: "54",
  IN: "91", PH: "63", MY: "60", TH: "66", VN: "84", ID: "62",
};

/**
 * Minimum national-significant digits, where the default of 8 is wrong. Used
 * only to reject obvious junk, never to reshape a number.
 */
const MIN_NSN: Record<string, number> = { US: 10, CA: 10, RU: 10, KZ: 10, IN: 10, BR: 10 };

/**
 * Normalize a phone to true E.164 for its OWN country.
 *
 *   ("38923294286", "MK") → "+38923294286"
 *   ("0721234567",  "RO") → "+40721234567"     ← never +389…
 *   ("+40721234567","RO") → "+40721234567"
 *   ("0721234567",  "??") → null               ← unknown geo, never guess
 *
 * For MK input this is byte-identical to normalizeMkPhone, so mirrored
 * Macedonian orders still match the 81.657 already in the table.
 */
export function normalizePhoneForGeo(raw: unknown, geo: string): string | null {
  const cc = DIAL_CODES[String(geo || "").toUpperCase()];
  if (!cc) return null;                        // unknown geo → never invent one
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2);          // 0049… → 49…
  if (digits.startsWith(cc)) digits = digits.slice(cc.length);    // already international

  // Strip the national trunk zero LAST and unconditionally. Sources write the
  // same number both ways — "387603531647" and "3870603531647" are one Bosnian
  // subscriber — and stripping only in the non-international branch produced two
  // different E.164 values for one person, which silently breaks dedupe and
  // double-calls them. This also matches normalizeMkPhone's unconditional
  // ^0+ strip, so mirrored MK orders stay byte-identical to the 80.360 already
  // in the table.
  digits = digits.replace(/^0+/, "");

  const min = MIN_NSN[String(geo).toUpperCase()] ?? 8;
  if (digits.length < min) return null;
  // Guard against a number so long it cannot be E.164 (max 15 incl. the code).
  if (cc.length + digits.length > 15) return null;
  return "+" + cc + digits;
}

/** The shape we actually receive. Only the fields the bridge reads are typed. */
export interface AlterCpaOrder {
  id: number | string;
  ext?: string;
  offer?: number | string;
  offername?: string;
  wm?: number | string;
  status?: number;
  reason?: number;
  phase?: number;
  time?: number;          // creation, epoch seconds
  done?: number;
  paid?: number;
  name?: string;
  phone?: string;
  email?: string;
  country?: string;
  index?: string;
  addr?: string;
  area?: string;
  city?: string;
  street?: string;
  comment?: string;
  count?: number;
  currency?: string;
  price?: number;
  goods?: Array<{ id?: number; name?: string; short?: string; count?: number; price?: number }>;
  [k: string]: unknown;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one window, splitting it if the API chokes.
 *
 * Two contracts inherited from the export script, both load-bearing:
 *
 *  1. An ERROR comes back as an OBJECT ({"status":"error",...}), not an array.
 *     Treating that as end-of-stream is exactly how a sync silently truncates
 *     while reporting success, so a non-array body is a HARD failure.
 *  2. The API has no page cap but 500s on very large windows (94k records came
 *     back fine; ~150k died). A whole-range request is therefore not "one page"
 *     — it is an error. Any window that still fails is halved until it fits.
 *
 * `from`/`to` are epoch SECONDS.
 */
export async function fetchWindow(
  apiBase: string,
  token: string,
  from: number,
  to: number,
  depth = 0,
  onSplit?: (msg: string) => void,
): Promise<AlterCpaOrder[]> {
  const base = apiBase.replace(/\/+$/, "");
  const url = `${base}/comp/list.json?id=${encodeURIComponent(token)}&from=${from}&to=${to}`;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch {
        throw new Error(`unparseable body (${text.slice(0, 120)})`);
      }
      if (!Array.isArray(body)) {
        throw new Error(`non-array body: ${JSON.stringify(body).slice(0, 200)}`);
      }
      return body as AlterCpaOrder[];
    } catch (e) {
      lastErr = e as Error;
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }

  if (depth < 4 && to - from > 86400) {
    onSplit?.(`window ${from}..${to} too large (${lastErr?.message}) — splitting`);
    const mid = Math.floor((from + to) / 2);
    const a = await fetchWindow(apiBase, token, from, mid, depth + 1, onSplit);
    const b = await fetchWindow(apiBase, token, mid + 1, to, depth + 1, onSplit);
    return a.concat(b);
  }
  throw new Error(`window ${from}..${to} failed after retries and ${depth} splits: ${lastErr?.message}`);
}
