# Data import spec — existing clients & orders (Macedonia)

Hand this page to whoever is exporting the historical data.

**One file of ORDERS is all we need.** Customers, their history and every
prediction list are derived from it automatically — do not prepare a separate
customer file.

---

## Why orders, not customers

The prediction lists (who to call, and when) are **not** imported. They are
*computed* from order history by the segment engine, which runs nightly and on
demand. Per phone number it decides:

- how long since that customer last **paid** → recency band (21d / 57d / 4-6m / 6-12m / 1-2yr / 2yr+)
- how many paid orders they have → frequency band (1-3 / 3+ / 5+ / 7+)
- what their last paid order was worth → value band
- whether their newest order was a cancel, a return or a trash → holding-pen lists

So the quality of your calling lists depends almost entirely on **`phone`,
`status`, `price` and `date`** being right. Everything else is convenience.

Rows with status `paid` are what build a customer's value. Rows that are
`cancelled` / `returned` / `trashed` matter too — they route people into the
Current Cancels, Current Returns and Trash List pens instead of the calling bands.

---

## File format

- **CSV or Excel** (`.csv`, `.xlsx`, `.xls`). First sheet only.
- **UTF-8** if CSV, so Cyrillic survives.
- **One row per order line.** An order with three products is three rows sharing
  the same order number.
- First row must be the header row.
- No size limit to worry about — it uploads in batches of 200.

## Columns

Only **two** are required: `phone` and `product`. The rest improve the result but
will not block the import.

| Column | Required | Notes |
|---|---|---|
| `order number` | strongly recommended | Your original ID. **This is what makes re-uploading the same file safe** — rows de-duplicate on it. Without it, a second upload creates duplicates. |
| `date` | recommended | Order date. Without it the import time is used, which would put every historical customer in the wrong recency band. |
| `name` | recommended | Full name in one column. Separate first/last columns also work. |
| `phone` | **REQUIRED** | Any format — see below. |
| `product` | **REQUIRED** | Product name. Matched to the catalogue by name, then SKU. |
| `quantity` | optional | Defaults to 1. |
| `price` | recommended | See the currency note below. |
| `status` | recommended | Defaults to `paid`. Values listed below. |
| `city` | optional | |
| `address` | optional | One column is fine — do **not** split into street/number/floor. |
| `postal code` | optional | |
| `note` | optional | Free text. |

**Header names are flexible.** English, Macedonian (Cyrillic *and* Latin
transliteration) and Albanian are all recognised, case-insensitively. For the
phone column any of these work: `phone`, `telephone`, `телефон`, `мобилен`,
`telefon`, `numri`, `telefoni`. Likewise `нарачка`, `датум`, `име`, `производ`,
`количина`, `цена`, `статус`, `град`, `адреса`, `поштенски код`, `забелешка`.
An unrecognised header is simply ignored, and the preview shows you that before
anything is written.

## Values

**Phone** — any format. `070123456`, `70 123 456`, `+389 70 123 456` and
`0038970123456` all normalise to `+38970123456`. Matching uses the **last 8
digits**, so inconsistent formatting in the source is harmless.

> ⚠️ Make sure the export does not mangle phones into scientific notation
> (`7.01235E+8`). Format the column as **Text** before exporting. The importer
> rejects rows that look like this rather than silently storing a wrong number.

**Date** — `YYYY-MM-DD` preferred. `DD.MM.YYYY`, `DD/MM/YYYY` and `DD-MM-YYYY`
also work; 2-digit years become 20xx.

**Price** — the **total for that line**, in **EUR**, as a plain number
(`34.90`, not `34,90 €`).

> **If your data is in denars, tell us — do not convert it yourself.** The CRM
> stores EUR internally and derives the denar shown on screen from a fixed 61.5
> rate. Converting by hand at a different rate would make every imported order
> display a price that differs from what the customer actually paid. Either send
> denars and say so, or divide by exactly 61.5.

**Status** — one of:

`pending`, `confirmed`, `shipped`, `delivered`, `paid`, `cancelled`, `returned`, `trashed`, `call_again`

Anything unrecognised falls back to `paid` and the preview flags it. If the source
system uses its own words, either map them before sending or send us the list of
values and we will map them.

---

## Example

```csv
order number,date,name,phone,product,quantity,price,status,city,address
10231,2026-03-14,Ана Стоева,070111222,Диабетол Форте,1,34.90,paid,Скопје,ул. Партизанска 12
10232,2026-03-15,Бојан Илиев,071333444,Уро Протект,2,59.80,paid,Битола,ул. Широк Сокак 4
10233,2026-03-16,Ана Стоева,070111222,Колаген Пептид,1,29.90,cancelled,Скопје,ул. Партизанска 12
```

The same header row in Macedonian works identically:

```csv
нарачка,датум,име,телефон,производ,количина,цена,статус,град,адреса
```

---

## How it gets imported

1. Admin → **Import Orders** in the sidebar (`/import-orders`).
2. Drop the file in. You get a **preview** with a per-row error/warning list
   *before* anything is written — missing/invalid phone is an error (row skipped);
   unknown product, bad date or odd status are warnings (row still imports).
3. Set a **source label** (e.g. `legacy-2026`) so imported rows can always be told
   apart from orders taken by agents.
4. Import. Re-uploading the same file is safe — de-duplication is on your order
   number.
5. Prediction lists rebuild on the nightly recompute, or immediately when
   triggered from the admin UI.

## Before sending the real file

Send **20–30 sample rows first**. Running those through the preview is the
cheapest way to confirm the header mapping and status vocabulary are right before
committing the full history.

---

## Products

Only needed if you are selling items that are not in the CRM catalogue yet.
Unknown products still import (the order is created, just without a catalogue
link) and the preview lists every unmatched name, so the usual order is: import
orders, read the unmatched list, add those products, re-import.

If you do want to load a catalogue up front: `name`, `sku`, `price` (EUR),
`cost_price` (EUR), `stock`, `barcode`.
