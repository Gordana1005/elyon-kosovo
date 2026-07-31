import { format as dfFormat, formatDistanceToNow as dfFormatDistanceToNow } from 'date-fns';
import { bg, sq, mk } from 'date-fns/locale';
import i18n from './index';

// Locale-aware date formatting for USER-VISIBLE dates (word-bearing patterns
// like 'MMM d', 'PPP', formatDistanceToNow). Machine formats — 'yyyy-MM-dd'
// API payloads and the fulfilment CSV timestamp — must keep importing
// date-fns directly so they never localize.

const LOCALES = { bg, sq, mk } as const; // en = date-fns default (undefined)

const localeFor = () => LOCALES[i18n.language as keyof typeof LOCALES];

export function formatDate(date: Date | number | string, fmt: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return dfFormat(d, fmt, { locale: localeFor() });
}

export function formatDistanceToNow(
  date: Date | number | string,
  options?: { addSuffix?: boolean; includeSeconds?: boolean },
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return dfFormatDistanceToNow(d, { ...options, locale: localeFor() });
}

/** Pass to react-day-picker (ui/calendar.tsx) so pickers localize month/weekday names. */
export const dayPickerLocale = localeFor;
