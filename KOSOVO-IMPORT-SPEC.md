# Kosovo CRM — Data Import Spec (what to collect from the Kosovo team)

This is the shopping list of CSV files to request from the people who already run the
Kosovo selling operation, plus the exact columns each file needs. Hand the **"Ask the
Kosovo team"** sections to them directly.

> **How import works here:**
> - **Orders** have a built-in admin screen: **Import Orders** (sidebar → Sales, admins only).
>   Upload the CSV/Excel, review the preview, click import. It handles phone → `+383`, EUR,
>   date parsing, product matching, de-duplication (by order number), and optionally saves
>   customer profiles. Re-uploading the same file is safe.
> - **Products** and **customers** are still loaded by an admin script (`scripts/import-*.mjs`,
>   run with `--commit`) — give Mile the CSVs and he runs them.
>
> Either way, the only thing that matters is that the **column headers and values match what's
> below**. Anything optional can be left blank.

## Global rules (tell the Kosovo team once)
- **File format:** CSV, UTF-8 encoding, first row = column headers (use the exact header names below).
- **One row = one record.** For orders, one row = one order line (see Orders notes for multi-product orders).
- **Currency: EUR only.** Prices as plain numbers with a dot decimal: `12.50`, not `12,50 €`.
- **Dates: `YYYY-MM-DD`** (e.g. `2026-03-14`). If they only have day/month/year in another
  format, that's fine — just tell me which format so the script parses it right.
- **Phone:** any format is OK (`044 123 456`, `+383 44 123 456`, `0038344123456`). The system
  normalizes everything to `+383…` and matches customers by the **last 8 digits**, so consistency
  matters more than format.
- **Names:** the system stores **one full-name field**. If their data has first/last in separate
  columns, that's fine — give both columns and the script joins them into `customer_name`.
- **Empty is fine.** Only the columns marked **REQUIRED** must be filled. Leave the rest blank if unknown.

---

# 1) PRODUCTS — `products.csv`

The product catalogue. This must come first, because orders reference products by name/SKU.

| Column | Required? | Meaning / what to ask for | Example |
|---|---|---|---|
| `name` | ✅ **REQUIRED** | Product display name | `Natura Detox Tea` |
| `price` | ✅ recommended | Selling price to customer, **EUR** | `19.90` |
| `cost_price` | optional | What it costs us to buy (for margin reports; admin-only) | `6.50` |
| `sku` | optional | Internal product code. Auto-generated if blank | `DETOX-01` |
| `category` | optional | Grouping (e.g. Tea, Capsules, Cream) | `Tea` |
| `stock_quantity` | optional | Units currently in the warehouse | `120` |
| `barcode` | optional | EAN/UPC barcode (if they use a fulfilment/warehouse system) | `5901234123457` |
| `days_of_supply_per_unit` | optional | How many days one pack lasts a customer (drives reorder reminders). 30-pack ≈ `15`, 4-pack ≈ `60` | `30` |
| `description` | optional | Extra detail / sales notes | `30-day herbal cleanse` |

**Ask the Kosovo team for:** *"A list of every product you sell — product name, selling price in
euros, and (if you have them) your internal code, category, current stock count, and barcode.
If you know how many days one package lasts a customer, include that too."*

> Note: ~67 products were already seeded into the Kosovo system. If this list replaces or
> extends that, tell me — I'll update existing rows by SKU/name rather than create duplicates.

---

# 2) CUSTOMERS — `customers.csv`

The client master list. **Optional** — if the Orders file (below) already contains each customer's
name + phone + address, I can build the customer list automatically from it. But if they have a
clean contact list (e.g. exported from their old system / phone / spreadsheet), it's worth having,
because it pre-fills name and address when an agent calls that number.

| Column | Required? | Meaning / what to ask for | Example |
|---|---|---|---|
| `phone` | ✅ **REQUIRED** | Customer phone (the unique key — one profile per phone) | `044 123 456` |
| `customer_name` | recommended | Full name. (Or give `first_name` + `last_name` and I'll join) | `Arben Krasniqi` |
| `city` | recommended | City / town | `Prishtinë` |
| `address` | recommended | Full street address as one line | `Rr. Agim Ramadani 12` |
| `postal_code` | optional | Postal code | `10000` |
| `birthday` | optional | `YYYY-MM-DD` | `1985-07-02` |
| `notes` | optional | Any free-text note about the customer | `Prefers calls after 17:00` |
| `delivery_instructions` | optional | Standing delivery note | `Ring twice` |

**Ask the Kosovo team for:** *"Your customer/contact list — phone number, full name, city, and
street address for each person. Postal code and birthday if you have them."*

> Kosovo doesn't use the Bulgarian block/entry/floor address breakdown — a **single full address
> line + city + postal code** is exactly right. Don't worry about splitting the street.

---

# 3) ORDERS (historical) — `orders.csv`

The order history. This is the big one — it's where dates, products, prices, and who-bought-what live.

**One row per order.** If an order had multiple different products, see the multi-product note below.

| Column | Required? | Meaning / what to ask for | Example |
|---|---|---|---|
| `external_order_id` | ✅ **REQUIRED** | Their original order number (used to avoid importing the same order twice) | `KS-10231` |
| `order_date` | ✅ **REQUIRED** | When the order was placed, `YYYY-MM-DD` | `2026-03-14` |
| `customer_name` | ✅ **REQUIRED** | Full name (or `first_name`+`last_name`) | `Arben Krasniqi` |
| `customer_phone` | ✅ **REQUIRED** | Phone (links the order to a customer) | `044 123 456` |
| `product_name` | ✅ **REQUIRED** | Product ordered (must match a name/SKU in products.csv) | `Natura Detox Tea` |
| `quantity` | ✅ recommended | How many units | `2` |
| `price` | ✅ recommended | **Total** paid for the order, EUR | `39.80` |
| `status` | recommended | Outcome — see status list below | `delivered` |
| `city` | recommended | Delivery city | `Prishtinë` |
| `address` | recommended | Full delivery street address (one line) | `Rr. Agim Ramadani 12` |
| `postal_code` | optional | Postal code | `10000` |
| `delivered_date` | optional | When delivered, `YYYY-MM-DD` | `2026-03-17` |
| `note` | optional | Any note on the order | `Gift wrap` |

### `status` — use one of these words (map their wording to ours):
- `delivered` — reached the customer
- `paid` — delivered **and** paid (the completed sale)
- `cancelled` — customer cancelled before shipping
- `returned` — came back after delivery
- `shipped` — sent but outcome unknown
- (blank) — I'll default it to `paid` for historical completed sales, or tell me what fits

**Ask the Kosovo team for:** *"An export of all past orders, one row each: their order number,
the date, customer name + phone, what product and how many, the total price in euros, the
delivery city + address, and whether it was delivered/paid/cancelled/returned. Delivered date
if they have it."*

### Multi-product orders
If a single order contained **several different products**, the cleanest option is **one row per
product line**, repeating the same `external_order_id` on each row (and putting that line's product,
quantity, and that line's price on each row). I'll group rows by `external_order_id` into one order
with multiple line items. Tell the team which they can produce and I'll adapt the script.

---

## What I (the system) generate automatically — they do NOT need to provide
- Internal IDs (`id`), display order numbers (`ORD-…`), created/updated timestamps
- Phone normalization to `+383`, last-8 matching, customer↔order linking
- SKU auto-generation if blank
- All prediction/segmentation/lifecycle data (computed by the engine)
- Agent assignment, confirmation, cancellation-reason enums, etc.

## Still TODO before orders flow live (not blocking the import)
- **Kosovo cities & couriers:** order city is stored as **free text**, so historical import works
  today. But the live courier picker + city autocomplete still use Bulgarian data (Speedy/Econt +
  `bg_settlements`). Replacing those with Kosovo carriers/cities is a separate task.
- **Phone length rules:** `+383` prefix is set; verify the digit-length thresholds against real
  Kosovo numbers once we have a sample.

---

## Quick recap — the 3 files to request
1. **`products.csv`** — what you sell (name + EUR price, ideally SKU/category/stock/barcode).
2. **`customers.csv`** — who your clients are (phone + name + city + address). *Optional if orders.csv has it.*
3. **`orders.csv`** — order history (order #, date, customer, phone, product, qty, total €, status, address).

The single most important columns to insist on: **phone**, **product name**, **price (€)**,
**date**, and **their order number**. Everything else improves quality but isn't blocking.
