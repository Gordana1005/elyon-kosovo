/**
 * Cyrillic ↔ Latin transliteration for search (BG).
 *
 * MUST stay in sync with:
 * - scripts/import-cpa-xlsx.mjs
 * - scripts/import-outbound-xlsx.mjs
 * - scripts/scrape-courier-offices.mjs
 * - supabase/functions/api/index.ts (CYR_TO_LAT + qNorm)
 *
 * Used for client-side search (e.g. helpers pane) so that typing
 * "diabetol", "диабетол", "Diabetol", "ДИАБЕТОЛ" etc. all match.
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
