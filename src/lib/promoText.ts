import i18n from '@/i18n';
import { BASE_SCRIPT_LANG } from '@/lib/callScripts';

export type PromoCustomText = Record<string, { short?: string; full?: string }>;
export type PromoTokenValues = { product: string; price: string; bonus: string };

/** A rendered piece of promo text: plain words, or a substituted value to bold. */
export type PromoPart = { text: string; bold: boolean };

const hasText = (v?: string | null): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * The operator's own wording for the viewer's language, if they wrote any.
 * Falls back to the Macedonian base entry (same rule as the call scripts), then
 * to undefined — at which point the caller uses the built-in translated default.
 */
export function resolveCustomText(
  custom: PromoCustomText | undefined,
  variant: 'short' | 'full',
  lang?: string,
): string | undefined {
  if (!custom) return undefined;
  const code = (lang || i18n.language || BASE_SCRIPT_LANG).split('-')[0];
  const mine = custom[code]?.[variant];
  if (hasText(mine)) return mine.trim();
  const base = custom[BASE_SCRIPT_LANG]?.[variant];
  return hasText(base) ? base.trim() : undefined;
}

/**
 * Split custom text on the {{product}} / {{price}} / {{bonus}} tokens, replacing
 * each with its live value and marking it bold — so hand-written wording gets the
 * same emphasis on the numbers as the built-in copy, without the operator having
 * to type any markup. Unknown tokens are left verbatim so a typo is visible
 * rather than silently swallowed.
 */
export function renderPromoText(text: string, values: PromoTokenValues): PromoPart[] {
  const parts: PromoPart[] = [];
  const re = /\{\{\s*(product|price|bonus)\s*\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false });
    parts.push({ text: values[m[1] as keyof PromoTokenValues], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

/**
 * Drop blank fields and empty languages — the same normalisation the API does,
 * applied before saving so the saved copy and the server's copy are identical
 * (otherwise the form would look permanently "unsaved" after a save).
 */
export function cleanCustomText(custom: PromoCustomText | undefined): PromoCustomText {
  const out: PromoCustomText = {};
  for (const [lang, entry] of Object.entries(custom || {})) {
    const short = (entry?.short || '').trim();
    const full = (entry?.full || '').trim();
    if (short || full) out[lang] = { ...(short ? { short } : {}), ...(full ? { full } : {}) };
  }
  return out;
}

/** Plain-text version (for tooltips / titles). */
export function plainPromoText(text: string, values: PromoTokenValues): string {
  return renderPromoText(text, values).map(p => p.text).join('');
}
