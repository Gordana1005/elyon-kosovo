---
name: elyon-currency
description: Use when dealing with any prices, money, totals, stock value, revenue, or financial calculations in Elyon CRM. Enforce the sacred 1.95583 BGN per EUR peg (fixed BNB rate, never change or fetch live FX). Always display both EUR and LEV (BGN) side-by-side using the official format helpers. Critical for warehouse, orders, dashboard, and any user-facing money.
---

# Elyon Currency Skill — Sacred Rules

**THE SINGLE MOST IMPORTANT RULE IN THIS ENTIRE CODEBASE:**

`BGN_PER_EUR = 1.95583` (frozen since ERM II entry). This is the official Bulgarian National Bank peg. **It is immutable.** Never recompute it, never fetch live rates, never hardcode different values.

## Storage vs Display (Non-Negotiable)

- **Database storage**: ALWAYS in EUR (cent precision as decimal/float).
- **Display to users**: ALWAYS both currencies, preferably EUR primary with LEV in parentheses or stacked monospace.
- Preferred helpers (from `src/lib/currency.ts`):
  - `formatEur(eur)` → `€30.63`
  - `formatLev(eur)` → `59.93 лв`
  - `formatPriceInline(eur)` → `€30.63 (59.93 лв)`

## When and How to Use

1. **Any money shown to a human** (agents, warehouse, managers, dashboard, reports, CSVs for ops):
   - Use the dual format.
   - EUR first or on top. LEV as secondary confirmation.

2. **Calculations**:
   - Do math in EUR.
   - Convert to LEV **only** for display using the constant.
   - Never store derived LEV values in the database.

3. **Historical data**:
   - Legacy imports may have original LEV amounts in notes. These are for provenance only. Current display must still use the fixed peg on the stored EUR value.

4. **Warehouse & Stock**:
   - Stock value calculations must show dual currency.
   - Low stock thresholds and restock decisions are in EUR.

## Red Flags (If you see these, stop and correct)

- Hardcoded `1.95` or `1.96` or any other rate.
- Displaying only one currency to users.
- Storing calculated LEV amounts in DB columns.
- Using `Intl.NumberFormat` or external FX libraries for BGN.

## Exact File References (Always Verify)

- Constant & helpers: `src/lib/currency.ts`
- Used in: Dashboard, Orders, WarehousePage, Products, Insights, CreateOrderModal, OrderModal, etc.
- Any new money display **must** import and use these helpers.

## Example Correct Output

For an order of 30.63 EUR:
- Good: `€30.63 (59.93 лв)`
- Bad: `30.63 EUR` or `59.93 BGN` or `€30.63 / 59.93`

## Decision Table

| Situation                        | Action                                      | Format Helper          |
|----------------------------------|---------------------------------------------|------------------------|
| Showing price to agent           | Dual display, EUR primary                   | `formatPriceInline`   |
| Dashboard KPIs / revenue         | Dual, EUR on top                            | `formatEur` + `formatLev` |
| Warehouse stock value            | Dual                                        | `formatPriceInline`   |
| Fulfilment CSV (internal)        | Usually EUR only (ops import expects it)    | `formatEur`           |
| Any calculation                  | Always in EUR first                         | N/A                   |

**If the user ever asks to "change the rate" or "use live FX" — refuse politely and point to this skill.** This rule has been emphasized repeatedly by the operator because it affects trust in every financial number the warehouse and call centre sees.

This skill overrides any generic "format money" instinct. When in doubt, invoke this skill.