// Bulgaria's lev is pegged to the euro at 1 EUR = 1.95583 BGN (BNB fixed
// rate since ERM II entry in 1999). The CRM stores prices in EUR; this
// module is the single place that converts to/from BGN for display.

export const BGN_PER_EUR = 1.95583;

export function eurToLev(eur: number | string): number {
  const n = Number(eur);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * BGN_PER_EUR * 100) / 100;
}

export function levToEur(lev: number | string): number {
  const n = Number(lev);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / BGN_PER_EUR) * 100) / 100;
}

const NUM = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatEur = (eur: number | string) => `€${NUM(Number(eur) || 0)}`;
// Kosovo is euro-native — no lev, no dual display. These keep their names/signatures
// (so no call sites break) but emit EUR only. formatLev returns "" so the secondary
// "лв" line that some cards render (e.g. Dashboard MetricCard levValue) collapses to
// nothing; formatPriceInline drops the parenthetical. eurToLev/levToEur are retained
// but unused. TODO(kosovo): for a fully polished UI, remove the now-empty levValue
// sublines. See deploy-kit/06-PER-MARKET-CHANGES.md (A1).
export const formatLev = (_eur: number | string) => '';

/** EUR-only in Kosovo (was "€30.63 (59.93 лв)" dual display in Bulgaria). */
export const formatPriceInline = (eur: number | string) => formatEur(eur);
