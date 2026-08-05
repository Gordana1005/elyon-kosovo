# AlterCPA → catalogue mapping — review

81,657 orders · 66 AlterCPA names · **39 canonical products**

- **18** map onto products already in the catalogue — 32,467 orders (39.8%)
- **21** need creating — 49,190 orders (60.2%)

Nothing below is written to the catalogue until this file is signed off and the script
is re-run with `--commit`.

## Maps onto an existing product

| canonical | orders | AlterCPA names collapsed | → catalogue |
|---|---:|---|---|
| Curcumactiv | 7,621 | Curcumactiv · Curcumactiv gastrointestinal tract | `Curcumactiv (500ml)` |
| Prostatol Complex | 7,313 | Prostatol Complex · Prostatol Complex RS [Full Price] | `Простатол Комплекс` |
| Uro Protect | 5,490 | Uro Protect · Uro Protect FP · Uro Protect [CF27] · Uro Protect [CF40] | `Uro Protect` |
| Snail Complex | 4,651 | Snail Complex | `Snail Complex` |
| Diabetol Forte | 3,550 | Diabetol Forte · Diabetol Forte LP | `Диабетол Форте` |
| Hyaluron & Aloe vera cream 45+ | 1,367 | Hyaluron & Aloe vera cream 45+ | `ELIXY DNEVNA & HYALURONIC +45  50 ml` |
| Collagen Peptides | 796 | Collagen Peptides · Collagen Peptides MK [ARK27] | `Колаген Пептид со ВАНИЛА 200 гр` |
| Hyaluron & Aloe vera cream 55+ | 681 | Hyaluron & Aloe vera cream 55+ | `ELIXY DNEVNA & HYALURONIC +55  50 ml` |
| Dr. Slim | 464 | Dr. Slim | `DR.SLIM 90cps` |
| Hyaluron & Aloe vera cream 35+ | 362 | Hyaluron & Aloe vera cream 35+ | `ELIXY DNEVNA & HYALURONIC +35  50 ml` |
| Slim Complex + Slim Fiber | 163 | Slim Complex + Slim Fiber | `SLIM Complex` |
| Hemoro Forte | 3 | Hemoro Forte | `Hemoro Forte` |
| Brain Activ | 1 | Brain Activ | `Brain active (30cps)` |
| Hepatol Forte | 1 | Hepatol Forte | `Hepatol` |
| Calm | 1 | Calm | `CALM` |
| Sambucus Nigra | 1 | Sambucus Nigra | `САМБУКУС сирoп 250 мл` |
| Snail Repair Night Cream | 1 | Snail Repair Night Cream | `ELIXY-Ноќен крем снаил 50ml` |
| Broncho Protect | 1 | Broncho Protect | `Broncho Complex` |

## To be created

Prices are the shelf price we would sell at today, from the clean-denar bands in
`reprice-2026-08.json`, chosen from each product's dominant historical price point.
They do **not** touch imported orders, which keep the price the customer actually paid.

| canonical | orders | AlterCPA names collapsed | proposed price | stored EUR | commission tier |
|---|---:|---|---:|---:|---|
| ArthroFix | 5,810 | ArthroFix · ArthroFix Low Price · Arthrofix Neuropathy | 1,490 ден | €24.23 | 1 (€1) |
| ProstaFix | 5,713 | ProstaFix · Prostafix LP | 2,490 ден | €40.49 | 3 (€3) |
| GlucoFix | 4,970 | GlucoFix · GlucoFix LP | 2,490 ден | €40.49 | 3 (€3) |
| Slim Fit | 4,841 | Slim Fit LP · SlimFit | 1,490 ден | €24.23 | 1 (€1) |
| Urofix | 4,116 | Urofix LP · Urofix FP | 1,490 ден | €24.23 | 1 (€1) |
| Neurofix | 4,059 | Neurofix LP · Neurofix FP | 1,490 ден | €24.23 | 1 (€1) |
| Parafix | 3,909 | Parafix LP · Parafix FP | 1,490 ден | €24.23 | 1 (€1) |
| Cardiofix | 3,515 | Cardiofix Low Price · Cardiofix Hyperpotency · Cardiofix Full price | 1,490 ден | €24.23 | 1 (€1) |
| Adenofrin | 3,243 | Adenofrin · Adenofrin LP · Adenofrin + | 1,890 ден | €30.73 | 2 (€2) |
| Alpha Male | 3,208 | Alpha Male LP · AlphaMale BioNatural | 1,490 ден | €24.23 | 1 (€1) |
| ParaDetox | 2,086 | ParaDetox | 1,290 ден | €20.98 | 1 (€1) |
| Diet Shake | 1,317 | Diet Shake · DietShake [OFR] | 1,490 ден | €24.23 | 1 (€1) |
| Hemorofix | 917 | Hemorofix LP · Hemorofix FP · Hemorofix varicose vains LP · Hemorofix varicose vains FP | 1,490 ден | €24.23 | 1 (€1) |
| Gastro Aloe | 735 | Gastro Aloe | 1,290 ден | €20.98 | 1 (€1) |
| R&R Melem | 411 | R&R Melem | 1,490 ден | €24.23 | 1 (€1) |
| BrainFix | 167 | BrainFix · BrainFix LP | 2,490 ден | €40.49 | 3 (€3) |
| Veno Gel | 148 | Veno Gel | 1,490 ден | €24.23 | 1 (€1) |
| Arthro Blue | 11 | Arthro Blue | 1,290 ден | €20.98 | 1 (€1) |
| Liverfix | 9 | Liverfix LP · Liverfix FP | 1,490 ден | €24.23 | 1 (€1) |
| Calmifix | 4 | Calmifix LP · Calmifix FP | 1,490 ден | €24.23 | 1 (€1) |
| Gastro Protect | 1 | Gastro Protect | 1,290 ден | €20.98 | 1 (€1) |

## Judgement calls to confirm

- **ProstaFix** — The catalogue has 'Prosta Flow 30 капсули'. Different name, kept separate.
- **Neurofix** — The catalogue already has 'НЕВРО АКТИВ - 60капсули'. Different brand name, so kept separate — merge if they are the same product.
- **Diet Shake** — The catalogue has three flavoured Diet shakes at EUR 40.49; AlterCPA sold an unflavoured 'Diet Shake' at 1.490 den. Created as its own row because the flavour is unknown and the price point differs.
- **Gastro Aloe** — The catalogue has 'Aloe Vera 500ml' (a drink). Gastro Aloe is sold at a different price point, so kept separate.
- **BrainFix** — Kept separate from 'Brain active (30cps)' — AlterCPA sells both names, so they are different products.
- **Slim Complex + Slim Fiber** — A two-item bundle. The import stores one product per order, so it lands on SLIM Complex and the Slim Fiber half is invisible. 163 orders.
- **Arthro Blue** — Kept separate from ArthroFix — different name, 11 orders. Merge if it is the same SKU.
- **Liverfix** — The catalogue has 'Hepatol'. AlterCPA sells 'Hepatol Forte' separately, so Liverfix is treated as a different product.
- **Calmifix** — The catalogue has 'CALM'. AlterCPA sells 'Calm' separately, so Calmifix is treated as a different product.
- **Broncho Protect** — Name differs (Protect vs Complex); assumed the same product. 1 order.
- **Gastro Protect** — 1 order.

## Unit costs

Every created product starts at `cost_price = 0`. Profit and margin reports will read
100% margin on 49,190 orders until real costs are loaded — the same gap the 29
existing zero-cost products already have. Costs are a separate, deliberate step.
