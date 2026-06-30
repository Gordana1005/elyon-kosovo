---
name: elyon-fulfilment-csv
description: Use whenever generating, modifying, or explaining the Daily Fulfilment CSV for the warehouse. Enforce the exact format (comma-delimited, NO BOM, specific columns, status transition rules, ship_after_date filtering). This is the hand-off artifact between the CRM and the physical warehouse. Extremely high operational impact.
---

# Elyon Fulfilment CSV Skill — The Warehouse Hand-off Contract

This is one of the most operationally critical artifacts in the entire system. The warehouse team imports this CSV to pick, pack, and ship. Getting the format wrong has real-world consequences (wrong orders shipped, stock errors, angry warehouse staff).

## The Non-Negotiable Format Rules

- **Delimiter**: Comma (`,`)
- **Encoding**: UTF-8 **without BOM**
- **Quote handling**: Proper CSV quoting for fields containing commas or quotes
- **Tool**: Must use the project's `toCsv(..., ',', false)` helper (the third parameter `false` disables BOM)

**Critical warning from history**: The generic `toCsv` default in the codebase uses semicolon + UTF-8 BOM. The fulfilment export deliberately overrides this. Never "fix" it back to the default.

## Core Business Rules Encoded in the Export

1. **Status flip on export** (optional but powerful):
   - When "Mark as shipped on export" is checked, confirmed orders become `shipped`.
   - This triggers automatic stock decrement via the bulk-status-update endpoint.
   - Only admin/manager/warehouse roles can do this.

2. **ship_after_date filtering**:
   - Default "Ready to ship by" = today + 2 days.
   - Orders with `ship_after_date` in the future beyond this cutoff are excluded from today's CSV.
   - This implements the business rule: "1–2 days postpone is fine to ship now, 3+ days waits until its day."

3. **What goes into the CSV**:
   - Only orders in `confirmed` (or `shipped` in some views) that are ready.
   - Multi-item support via `order_items`.
   - Full customer address + delivery instructions.
   - Agent attribution for traceability.

## Exact Columns (Current Contract with Warehouse)

Typical headers include (verify current implementation in Orders.tsx):
- Order_ID, Customer_Name, Phone, Product_List, Quantity_Total, Total_Price, Status, Agent, Source, Address, City, Postal_Code, Created_At, etc.

The warehouse importer is sensitive to this contract. Changing columns without coordination is dangerous.

## When to Use This Skill

- Generating the Daily Fulfilment CSV popover in Orders page
- Any bulk export for warehouse
- Debugging "why is this order not in today's CSV?"
- Explaining status transitions to new team members
- Modifying the export logic

## Red Lines

- Never change the delimiter or add a BOM without explicit warehouse approval.
- Never include orders that have `ship_after_date` beyond the cutoff unless the user explicitly changes the filter.
- Never bypass the stock decrement logic when flipping to shipped on export.
- Always preserve the "Original product" information for legacy cancelled records when relevant.

## Sacred Code Locations

- Export logic: `src/pages/Orders.tsx` (the Fulfilment CSV popover and `toCsv` call)
- Backend bulk status + stock: `supabase/functions/api/index.ts` (bulk-status-update and the four stock decrement blocks)
- UI filter: "Ready to ship by" date control + ship_after_date handling
- `src/lib/csv.ts` (the toCsv helper)

## Operational Reality

This CSV is the physical bridge between the digital CRM and the warehouse in Bulgaria. The call centre in Skopje depends on the warehouse receiving clean, correct data every day.

If you are asked to "improve" or "change" the fulfilment export, you **must** first read this skill and the relevant sections of `PRODUCTS_STOCK_WAREHOUSE.md` and `ORDERS_AND_CLIENTS.md`.

This is not a normal export. It is a live operational contract. Treat it with the respect it deserves.