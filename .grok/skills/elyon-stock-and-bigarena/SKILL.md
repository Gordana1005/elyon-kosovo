---
name: elyon-stock-and-bigarena
description: Use for any stock movement, BigArena imports, reconciliation, inventory logs, or rules around when stock decrements or is restored. Includes the very specific historical rules the operator has set for product imports, SKU vs barcode handling, and what must never be touched.
---

# Elyon Stock & BigArena Reconciliation Skill

Stock is real money and real warehouse capacity. Mistakes here have physical consequences.

## Core Stock Rules

- Stock **only** changes on `shipped` (decrement) and `returned` (increment).
- It is **never** changed on order creation or confirmation.
- It only fires when `order_items.product_id IS NOT NULL`. Legacy imported orders (product_id = null) are intentionally skipped — they are historical.

This logic lives in four places in the backend (PATCH status + bulk-status-update, for both shipped and returned). Touching any of them requires touching all of them or extracting a helper.

## BigArena Import Rules (Historical Operator Decisions — Treat as Law)

When reconciling `stock.xlsx` (positive stock rows) against live CRM products, the operator has given very precise instructions in the past:

1. **Duplicates**: If it's a true duplicate we don't need, skip it.
2. **SKU updates**: When the file has a different (correct) SKU for a product we already have, prefer the file's SKU.
3. **No SKU in file**: Use the barcode as the SKU.
4. **Collagen example**: Specific products had exact update rules (e.g., update Collagen to NT0108 SKU).
5. **Osteo Fix**: Leave exactly as-is.
6. **Snail Complex 30+30**: Explicitly do **not** add.

These rules were battle-tested during a major reconciliation. Any new import or reconciliation script **must** embed or reference these decisions.

## Inventory Logs

Every stock change must write to `inventory_logs` with proper `reason`:
- `order_deduction`
- `order_return`
- `bigarena_import`
- `manual`
- `restock`
- etc.

Never mutate stock without an accompanying log row.

## When This Skill Applies

- Running or modifying BigArena import scripts
- Any stock reconciliation
- Changing decrement/restore logic
- Building reports that include stock value or movements
- Adding new products that will have stock

## Sacred References

- Import script: `scripts/import-products-bigarena.mjs`
- Reconciliation work and exact rules: historical sessions around May 2026 involving stock.xlsx vs live products
- Stock logic blocks: `supabase/functions/api/index.ts` (the four places)
- `PRODUCTS_STOCK_WAREHOUSE.md` in the docs folder

## Warning

The operator has been extremely specific about certain products and import behaviors multiple times. If you are doing anything with stock imports or bulk changes, read this skill and the relevant docs section first. Do not "improve" the rules without explicit confirmation.

This area has low tolerance for creative interpretation.