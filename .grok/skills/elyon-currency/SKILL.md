---
name: elyon-currency
description: Use when dealing with any prices, money, totals, stock value, revenue, or financial calculations in the Kosovo Elyon CRM. Kosovo is euro-native — display EUR only. There is NO lev, NO 1.95583 peg, and NO dual EUR/LEV display (that was the Bulgarian system). Critical for warehouse, orders, dashboard, and any user-facing money.
---

# Elyon Currency Skill — KOSOVO (euro-native)

**Kosovo uses the euro natively. Money is shown in EUR only.**

> This is the Kosovo fork. The Bulgarian rule (a fixed `BGN_PER_EUR = 1.95583` peg with dual
> EUR/LEV display) **does NOT apply here.** There is no lev. Never display "лв", never apply a
> peg, never fetch FX. If you see lev/BGN/1.95583 anywhere user-facing, it's a leftover from the
> BG fork — remove it.

## Storage vs Display
- **Database storage:** EUR (cent precision), as in Bulgaria.
- **Display to users:** EUR only — `€30.63`. No second currency.
- Helpers (from `src/lib/currency.ts`, already neutralized for Kosovo):
  - `formatEur(eur)` → `€30.63` ✅ use this everywhere
  - `formatLev(eur)` → returns `''` (no-op; kept only so old call sites don't break)
  - `formatPriceInline(eur)` → `€30.63` (EUR only; was dual in BG)

## Rules
1. **Any money shown to a human** → `formatEur`. EUR only.
2. **Calculations** → do math in EUR; there is nothing to convert.
3. **New money UI** → import `formatEur`. Never hand-format with a currency symbol, never add a
   second currency line.
4. **Polish TODO:** some dashboard cards still render an (now-empty) `levValue` subline left over
   from the dual display — safe to remove for a cleaner UI.

## Red flags (stop and correct)
- Any `лв`, `BGN`, `1.95583`, `eurToLev`, or a second currency shown to users.
- Re-introducing a peg or live FX.
- Storing a non-EUR amount in a price column.

## Exact file references
- Constant & helpers: `src/lib/currency.ts` (Kosovo: `formatLev`→`''`, `formatPriceInline`→EUR-only).
- Used in: Dashboard, Orders, WarehousePage, Products, Insights, CreateOrderModal, OrderModal, etc.

**If the user asks about the lev or a peg → that's the Bulgarian system; this is Kosovo (EUR only).**
