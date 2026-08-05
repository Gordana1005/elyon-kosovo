/**
 * Shared vocabulary for the AlterCPA → Elyon MK import.
 *
 * Everything here is derived from the LIVE API response, not from the published
 * docs — the docs list cancel reasons 1-15 but the data also carries 16-19, and
 * they describe an `items` map that is empty on every real order (the product
 * actually lives in `goods`).
 */
import { readFileSync } from 'node:fs';

/** AlterCPA `phase` — the reliable outcome field. `status` (1-12) is noisier. */
export const PHASE = { 1: 'processing', 2: 'hold', 3: 'approved', 4: 'cancelled', 5: 'trash' };

/** phase → Elyon order_status. Approved counts as paid per the 2026-08-05 decision. */
export const PHASE_TO_STATUS = {
  1: 'pending',
  2: 'pending',
  3: 'paid',
  4: 'cancelled',
  5: 'trashed',
};

/** AlterCPA cancel reasons. 16-19 are custom and undocumented; labelled as seen. */
export const REASON = {
  0: '—', 1: 'incorrect phone', 2: 'changed mind', 3: 'did not order',
  4: 'requires certificate', 5: 'wrong geo', 6: 'errors/fakes', 7: 'duplicate',
  8: 'ordered elsewhere', 9: 'expensive', 10: 'unhappy with delivery',
  11: 'could not reach', 12: 'possible fraud', 13: 'different language',
  14: "product didn't fit", 15: 'offer disabled',
  16: 'custom-16', 17: 'custom-17', 18: 'custom-18', 19: 'custom-19',
};

/**
 * MKD_PER_EUR is FROZEN at 61.5 — see src/lib/currency.ts. Never "update" it:
 * the denar is a managed NBRM peg, and changing the constant silently re-prices
 * every historical order. Re-price the catalogue in EUR instead.
 */
export const MKD_PER_EUR = 61.5;

/**
 * Per-currency divisor to EUR. 99.6% of MK orders are denar; the handful in
 * other currencies are converted at published rates and flagged in the note so
 * the approximation stays visible.
 */
export const FX_TO_EUR = {
  eur: 1,
  mkd: MKD_PER_EUR,
  bgn: 1.95583,   // fixed BNB peg
  all: 100,       // Albanian lek, approximate
  rsd: 117,       // Serbian dinar, approximate
};
export const EXACT_FX = new Set(['eur', 'mkd', 'bgn']);

export function toEur(price, currency) {
  const cur = String(currency || 'mkd').toLowerCase();
  const div = FX_TO_EUR[cur];
  if (!div) return null;
  return Math.round((Number(price) / div) * 100) / 100;
}

/**
 * Mirrors normalizeMkPhone in supabase/functions/api/index.ts:14372 so the
 * preview here matches exactly what the import endpoint will store. Returns ''
 * for anything the endpoint would reject (which makes the row skip).
 */
export function normalizeMkPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('389')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  digits = digits.replace(/^0+/, '');
  if (digits.length < 8) return '';
  return '+389' + digits;
}

/**
 * AlterCPA and its affiliates smoke-test the funnel against the live account:
 * 314 MK orders are named "Пробный_Заказ", "Test Ninja", "Test Add Lead" and so
 * on, some from localhost or a Russian office IP, with cities like
 * St Petersburg and Helsinki. Every one is cancelled or trash, so excluding
 * them costs no revenue — but importing them would invent 314 customers who do
 * not exist and park them in the Trash List forever.
 *
 * The pattern is deliberately narrow — anchored at the start of the name, so a
 * real surname containing those letters is never caught. `probn` covers the
 * Latin-transliterated "Probniy_Zakaz"/"Probny_Zakaz" variants that the
 * Cyrillic "проб" misses; both only ever appear with a Russian city attached.
 */
const TEST_NAME = /^\s*(test\b|тест|проб|probn)/i;
export const isTestOrder = (o) => TEST_NAME.test(String(o.name ?? ''));

/** The product name for an order: goods[0] wins, then the offer name. */
export function productNameOf(o) {
  const g = (o.goods || [])[0];
  const fromGoods = String(g?.name ?? '').trim();
  if (fromGoods) return fromGoods;
  return String(o.offername ?? '').trim();
}

export function quantityOf(o) {
  const g = (o.goods || [])[0];
  const q = Number(g?.count ?? o.count ?? 1);
  return Number.isFinite(q) && q >= 1 ? Math.floor(q) : 1;
}

export const isoDay = (epochSec) => new Date(epochSec * 1000).toISOString().slice(0, 10);

/** Streams the raw export without holding the whole 70 MB string twice. */
export function readOrders(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

// ── name folding, used to join collabBox documents to AlterCPA orders ──────
// Macedonian look-alikes get folded because operator-typed names and web-form
// names disagree constantly: Стефановски/Стефаноски, Јурковски/Јурукоски.
const FOLD = { 'ќ': 'к', 'ѓ': 'г', 'џ': 'ц', 'љ': 'л', 'њ': 'н', 'ш': 'с', 'ч': 'ц', 'ж': 'з', 'ѕ': 'з' };

export const normName = (s) =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const foldName = (s) =>
  normName(s).split('').map((c) => FOLD[c] || c).join('');

/** Tokens ≥2 chars, so initials and stray letters don't create false matches. */
export const nameTokens = (s) => foldName(s).split(' ').filter((t) => t.length > 1);

/** Order-independent identity key: "петар илиев" === "илиев петар". */
export const nameKey = (s) => nameTokens(s).sort().join(' ');

/** Bounded Levenshtein — returns 9 as soon as the answer can't be ≤2. */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
