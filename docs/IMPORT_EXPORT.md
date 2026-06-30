# Importing & exporting — the scripts toolbox

> Everything in [../scripts/](../scripts/) is a Node 22 ESM CLI run as
> `node --env-file=.env scripts/<name>.mjs`. They use the **service‑role key** from `.env`, so they bypass
> RLS — treat them as admin tools. **Most write‑scripts are dry‑run by default; pass `--commit` to write.**
> The big historical imports are the exception: they are **not idempotent** (re‑running duplicates).

There are two other "import/export" paths that are **not** scripts: the **Daily Fulfilment CSV** export
(client‑side in the Orders page → [PRODUCTS_STOCK_WAREHOUSE.md](PRODUCTS_STOCK_WAREHOUSE.md)) and the
**inbound webhooks / OpenCart bridge** (→ [WEBSITES_WEBHOOKS.md](WEBSITES_WEBHOOKS.md)).

---

## 1. Historical order imports (one‑shot, NOT idempotent)

| Script | Source | Loads | Notes |
|---|---|---|---|
| `import-cpa-xlsx.mjs` | `IN,CPA and OUT.xlsx` (CPA + INBOUND sheets) | ~7,390 orders | Contains the canonical `transliterate()` (keep in sync with the Edge Function `CYR_TO_LAT`). Provenance written into notes. |
| `import-outbound-xlsx.mjs` | same workbook (OUTBOUND sheet) | ~6,792 orders | Bulgarian month‑year header rows segment the sheet (`find-outbound-section-headers.mjs`). |
| `rollback-cpa-import.mjs` | the per‑run log files | — | **Emergency undo**: deletes the orders listed in a `cpa-import-*.txt` log. |

> These were used once to seed the ~14k legacy orders. **Don't re‑run on production** — there's no dedupe.
> Their analysis siblings (`analyze-cpa-*`, `analyze-outbound-*`, `test-raw-read`, `find-outbound-section-headers`)
> were scoping aids and can be ignored/removed.

The source workbook `IN,CPA and OUT.xlsx` and per‑run logs are **git‑ignored** (customer data).

---

## 2. Products & pricing

| Script | Idempotent | What it does |
|---|---|---|
| `import-products-bigarena.mjs` | ✅ | Upsert products from the BigArena fulfilment‑panel XLSX by SKU→name; merge duplicate barcodes (sum stock); stock>10 inserts / ≤10 updates; logs `inventory_logs reason=bigarena_import`. |
| `reconcile-panel-pdf.mjs` | read‑only | Reconcile catalogue vs a fresh BigArena panel **PDF**. |
| `import-natura-costs.mjs` | ✅ | Load Natura Therapy factory **cost** prices → `products.cost_price`. |
| `import-natura-retail.mjs` | ✅ | Load Natura Therapy **website retail** prices → `products.price` (the agent default). |
| `gen-natura-prices.mjs` | output files | Take the factory price sheet, reduce every price by a % → HTML/PDF (`NaturaTherapy_prices_minus33.*`). |
| `gen-natura-price-update.mjs` | output files | Full catalogue price sheet (Old vs New price) → HTML/PDF (`NaturaTherapy_PriceUpdate.*`). |
| `export-products-csv.mjs` | export | Dump all products to CSV (`products-export-YYYY-MM-DD.csv`) for hand price edits. |
| `merge-duplicate-products.mjs` | ✅ (`--commit`) | Merge legacy duplicate products into the real catalogue row. |
| `fix-product-skus.mjs` / `fix-skus-to-nt.mjs` | ✅ (`--commit`) | SKU corrections; **`fix-skus-to-nt.mjs` is the FINAL one** (2026‑05‑22): `sku` = internal panel SKU `NT…`. |
| `analyze-bigarena-skus.mjs` / `audit-products.mjs` / `audit-product-merge.mjs` | read‑only | Inspect/verify catalogue + merges. |

---

## 3. Reference data scrapers / fetchers

| Script | Idempotent | What it does |
|---|---|---|
| `scrape-courier-offices.mjs` | ✅ (`--commit`) | Speedy (`searchOffices.php`+`getOfficeDetails.php`, concurrency 20) + Econt (`Nomenclatures.getOffices.json`) → `courier_offices` (~1888). |
| `backfill-office-postal-codes.mjs` | ✅ (`--commit`) | Set office‑order `postal_code` from the office's own `post_code`. |
| `fetch-bg-settlements.mjs` | ✅ | Populate `bg_settlements` (cities/villages) from Econt's Nomenclatures API. |
| `enrich-settlements-municipality.mjs` | ✅ | Fill `bg_settlements.municipality` (община) from the EKATTE classifier. |

---

## 4. Webhooks management

| Script | What it does |
|---|---|
| `create-webhooks-for-products.mjs` | **Idempotent.** One inbound webhook per active product; slug = transliterated lowercase name. Upserts by slug. **Re‑run after adding products.** (Seeded the 55.) |
| `audit-webhooks.mjs` | List webhooks whose slug no longer maps to an active product (= stale). |
| `delete-stale-webhooks.mjs` | Delete those stale webhooks (`--commit`). |

---

## 5. Data cleanup & fixes

| Script | What it does |
|---|---|
| `cleanup-polluted-phones.mjs` | Quarantine/repair scientific‑notation phones (`3.59886e+11`) from xlsx imports. |
| `trace-polluted-phones.mjs` | Find the original xlsx rows behind a polluted phone. |
| `verify-cleanup.mjs` | Confirm the phone cleanup worked. |
| `find-shared-phones.mjs` | Phones attached to many distinct names (data‑quality flag / merge candidates). |
| `fix-home-addresses.mjs` / `analyze-home-addresses.mjs` | Conservative home‑address restructuring (high‑confidence only) + its analysis. |
| `cancel-all-unassigned-pendings.mjs` | Cancel ALL unassigned pendings (clear stale queue). |
| `cancel-new-customer-pendings.mjs` | Park brand‑new‑customer pendings into the static "Cancelled Pendings" list. |

---

## 6. Users

| Script | What it does |
|---|---|
| `create-admin-users.mjs` | Create the 3 founding admins (bootstrap; placeholder `…@elyoncrm.local`, password `12345678` — rotate!). |
| `create-agents-2026-05.mjs` | One‑off: create 2 call agents (`pending_agent + prediction_agent`). |
| `create-test-agent.mjs` | A test agent to verify the agent permission flow. |
| `check-users.mjs` | List users + roles. |

---

## 7. Audits (read‑only — verify the app's numbers)

`check-dashboard-numbers.mjs` (dashboard vs DB), `check-insights-accuracy.mjs` (analytics rebuild),
`check-customer-intelligence.mjs <phone>` (dossier accuracy), `check-segment-counts.mjs` /
`verify-segments.mjs` (segment membership), `check-last-order-over-46.mjs` (a specific segment),
`verify-cpa-import.mjs` (post‑import sanity), `smoke-browser.mjs` (`npm run smoke` — real‑browser smoke
test of the deployed CRM via Playwright).

---

## 8. Patterns to follow when writing a new script
- Read service‑role creds from `.env` (`--env-file=.env`); never hardcode keys.
- **Dry‑run by default, `--commit` to write.** Print a clear summary (`would update N / updated N`).
- **Paginate** any full‑table read past 1000 rows (`.range(from, from+999)` loop) — see [DATABASE.md](DATABASE.md).
- Keep transliteration consistent with the Edge Function's `CYR_TO_LAT`.
- Treat phones with `normalizeBgPhone`‑equivalent logic (last‑8 matching) — never exact‑equality.
- Log to a timestamped file for anything destructive so there's a rollback trail (the CPA imports do this).

---

## 9. Common runbook

```bash
# Products
node --env-file=.env scripts/import-products-bigarena.mjs            # dry-run
node --env-file=.env scripts/import-products-bigarena.mjs --commit
node --env-file=.env scripts/export-products-csv.mjs

# Reference data
node --env-file=.env scripts/scrape-courier-offices.mjs --commit
node --env-file=.env scripts/fetch-bg-settlements.mjs --commit

# Webhooks (after adding products)
node --env-file=.env scripts/create-webhooks-for-products.mjs --commit
node --env-file=.env scripts/audit-webhooks.mjs

# Verify
node --env-file=.env scripts/check-insights-accuracy.mjs
node --env-file=.env scripts/check-segment-counts.mjs
npm run smoke
```
