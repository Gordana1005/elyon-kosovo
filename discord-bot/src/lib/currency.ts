// Mirrors src/lib/currency.ts in the CRM. Amounts are STORED IN EUR.
export const BGN_PER_EUR = 1.95583; // sacred BNB peg

export function eurToLev(eur: number | string): number {
  const n = Number(eur);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * BGN_PER_EUR * 100) / 100;
}

export function fmtEur(eur: number | string): string {
  const n = Number(eur);
  return `€${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

// Macedonia: euro-native, no lev. Kept for signature compatibility; emit EUR only.
export function fmtLev(eur: number | string): string {
  return fmtEur(eur);
}

/** EUR-only in Macedonia (was dual "€30.63 (59.93 лв)" in Bulgaria). */
export function fmtDual(eur: number | string): string {
  return fmtEur(eur);
}
