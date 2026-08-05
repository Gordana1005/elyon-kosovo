# AlterCPA Macedonia export — analysis

Generated 2026-08-05 18:16 UTC from `81,657` orders.

## 1. Coverage

| month | orders | approved | cancelled | trash |
|---|---:|---:|---:|---:|
| 2025-04 | 17 | 5 | 2 | 10 |
| 2025-05 | 2,179 | 740 | 622 | 817 |
| 2025-06 | 2,990 | 1136 | 649 | 1205 |
| 2025-07 | 4,017 | 1320 | 306 | 2391 |
| 2025-08 | 3,259 | 913 | 256 | 2090 |
| 2025-09 | 2,037 | 596 | 231 | 1210 |
| 2025-10 | 8,286 | 2561 | 3143 | 2582 |
| 2025-11 | 9,070 | 2662 | 4762 | 1646 |
| 2025-12 | 10,028 | 2970 | 5979 | 1079 |
| 2026-01 | 6,765 | 2104 | 4327 | 334 |
| 2026-02 | 2,345 | 729 | 1408 | 208 |
| 2026-03 | 6,399 | 1833 | 3643 | 923 |
| 2026-04 | 6,062 | 1809 | 3245 | 1008 |
| 2026-05 | 5,335 | 1601 | 2642 | 1092 |
| 2026-06 | 6,043 | 1838 | 3078 | 1127 |
| 2026-07 | 5,824 | 1682 | 2969 | 1173 |
| 2026-08 | 1,001 | 267 | 503 | 187 |

## 2. Outcome

| AlterCPA phase | orders | share | → Elyon status |
|---|---:|---:|---|
| cancelled | 37,765 | 46.2% | `cancelled` |
| approved | 24,766 | 30.3% | `paid` |
| trash | 19,082 | 23.4% | `trashed` |
| processing | 44 | 0.1% | `pending` |

Cancel/trash reasons:

| reason | orders |
|---|---:|
| changed mind | 35,507 |
| did not order | 13,080 |
| incorrect phone | 4,260 |
| expensive | 1,077 |
| duplicate | 920 |
| custom-18 | 767 |
| errors/fakes | 695 |
| custom-16 | 356 |
| wrong geo | 67 |
| requires certificate | 38 |
| ordered elsewhere | 16 |
| — | 13 |
| custom-17 | 12 |
| offer disabled | 12 |
| different language | 7 |
| product didn't fit | 6 |
| unhappy with delivery | 6 |
| possible fraud | 5 |
| could not reach | 2 |
| custom-19 | 1 |

> `paid` is 0 on **all 81,657** orders — AlterCPA carries no payment truth.
> That is what the collabBox correction pass exists to fix.

## 3. Phones

`normalizeMkPhone` (the exact function the import endpoint uses) would **drop 983 rows** (1.2%).

| raw digit count | orders |
|---:|---:|
| 1 | 8 |
| 3 | 13 |
| 6 | 51 |
| 7 | 196 |
| 8 | 22,293 |
| 9 | 426 |
| 10 | 171 |
| 11 | 56,748 |
| 12 | 1,652 |
| 13 | 60 |
| 14 | 23 |
| 15 | 12 |
| 17 | 2 |
| 19 | 2 |

Normalised E.164 length (a correct MK mobile is 12 chars, `+389` + 8):

- `12` chars — 79,335
- `13` chars — 541  ⚠️ not a standard MK number
- `14` chars — 142  ⚠️ not a standard MK number
- `15` chars — 514  ⚠️ not a standard MK number
- `16` chars — 77  ⚠️ not a standard MK number
- `17` chars — 36  ⚠️ not a standard MK number
- `18` chars — 17  ⚠️ not a standard MK number
- `19` chars — 8  ⚠️ not a standard MK number
- `21` chars — 2  ⚠️ not a standard MK number
- `23` chars — 2  ⚠️ not a standard MK number

**Distinct customers after normalisation: 47,498** (from 81,657 orders).

Dropped examples: `554988: "389115225"`, `624412: "389"`, `683879: "3897460392"`, `711189: "7828448"`, `713750: "7132817"`, `715734: "2466106"`, `721275: "7037200"`, `721577: "1761895"`, `731444: "7024388"`, `731998: "38907540748"`

## 4. Money

| currency | orders | conversion |
|---|---:|---|
| mkd | 81,339 | ÷ 61.5 (fixed peg) |
| all | 224 | ÷ 100 (approximate — flagged in the note) |
| bgn | 50 | ÷ 1.95583 (fixed peg) |
| eur | 42 | as-is |
| rsd | 2 | ÷ 117 (approximate — flagged in the note) |

- Orders with price 0: **3,960** (4.8%) — imported honestly at €0.
- Orders with no usable rate: **0**
- Total value, all orders: **€1,926,667**
- Total value, approved only: **€604,365**

Top denar price points (and what they become in stored EUR):

| ден | orders | → EUR | round-trips back to |
|---:|---:|---:|---:|
| 1,490 | 27,231 | €24.23 | 1,490 ден ✓ |
| 1,200 | 20,950 | €19.51 | 1,200 ден ✓ |
| 895 | 16,832 | €14.55 | 895 ден ✓ |
| 2,450 | 5,681 | €39.84 | 2,450 ден ✓ |
| 0 | 3,958 | €0.00 | 0 ден ✓ |
| 3,000 | 2,834 | €48.78 | 3,000 ден ✓ |
| 1,990 | 1,655 | €32.36 | 1,990 ден ✓ |
| 4,000 | 545 | €65.04 | 4,000 ден ✓ |
| 2,500 | 255 | €40.65 | 2,500 ден ✓ |
| 1,800 | 223 | €29.27 | 1,800 ден ✓ |
| 1,290 | 202 | €20.98 | 1,290 ден ✓ |
| 4,500 | 199 | €73.17 | 4,500 ден ✓ |
| 2,000 | 127 | €32.52 | 2,000 ден ✓ |
| 2,200 | 93 | €35.77 | 2,200 ден ✓ |
| 4,800 | 77 | €78.05 | 4,800 ден ✓ |

## 5. Products

**66 distinct names.** 0 orders have neither `goods[]` nor an offer name — those import as `"—"`.

`goods` array length: 0 → 2,111, 1 → 79,546 — **never more than one product per order.**

| product | orders | top denar price points |
|---|---:|---|
| Curcumactiv | 7,416 | 1,200×4620, 895×2657, 1,800×39 |
| Prostatol Complex | 7,312 | 895×4557, 0×1717, 1,200×758 |
| ArthroFix Low Price | 5,556 | 1,200×2694, 1,490×2610, 3,000×222 |
| Uro Protect FP | 4,837 | 1,200×2855, 895×1824, 2,500×78 |
| Slim Fit LP | 4,835 | 1,490×2514, 1,200×1871, 3,000×319 |
| Snail Complex | 4,651 | 895×4361, 1,800×58, 1,200×56 |
| Urofix LP | 4,114 | 1,490×3883, 3,000×211, 4,000×15 |
| Neurofix LP | 3,944 | 1,490×3359, 3,000×489, 4,000×76 |
| Parafix LP | 3,907 | 1,490×3663, 3,000×211, 4,000×29 |
| Diabetol Forte | 3,525 | 895×2858, 1,200×423, 2,000×83 |
| Cardiofix Low Price | 3,280 | 1,490×2180, 1,200×977, 3,000×111 |
| ProstaFix | 3,051 | 2,450×3005, 4,000×29, 4,999.98×6 |
| GlucoFix LP | 2,708 | 1,490×1946, 1,200×372, 3,000×328 |
| Prostafix LP | 2,662 | 1,200×1810, 1,490×788, 3,000×44 |
| Alpha Male LP | 2,394 | 0×2048, 1,490×242, 3,000×89 |
| GlucoFix | 2,262 | 2,450×2252, 4,800×4, 4,000.02×1 |
| ParaDetox | 2,086 | 1,200×2062, 1,840×7, 895×4 |
| Adenofrin LP | 1,985 | 1,490×1388, 3,000×386, 4,500×186 |
| Hyaluron & Aloe vera cream 45+ | 1,367 | 1,490×745, 1,200×621, 0×1 |
| Diet Shake | 1,305 | 1,490×1288, 2,000×4, 3,000×4 |
| Adenofrin | 1,160 | 1,990×1107, 3,999.9×22, 3,999.99×12 |
| AlphaMale BioNatural | 814 | 1,490×812, 1,043×1, 3,000×1 |
| Hemorofix varicose vains LP | 806 | 1,490×506, 3,000×169, 4,000×122 |
| Gastro Aloe | 735 | 1,200×443, 895×276, 2,500×9 |
| Hyaluron & Aloe vera cream 55+ | 681 | 1,200×619, 1,490×59, 0×3 |
| Uro Protect | 629 | 1,200×303, 895×295, 2,500×19 |
| Collagen Peptides MK [ARK27] | 582 | 1,490×557, 3,000×19, 2,980×3 |
| Dr. Slim | 464 | 1,990×464 |
| R&R Melem | 411 | 1,490×290, 3,000×117, 1,200×3 |
| Hyaluron & Aloe vera cream 35+ | 362 | 1,200×212, 0×99, 1,490×51 |
| Cardiofix Hyperpotency | 233 | 1,490×131, 3,000×57, 4,000×39 |
| Collagen Peptides | 214 | 1,290×202, 1,490×8, 3,000×2 |
| ArthroFix | 206 | 2,450×203, 4,800×1, 25×1 |
| Curcumactiv gastrointestinal tract | 205 | 1,200×205 |
| BrainFix | 163 | 2,450×105, 4,800×48, 3,999.9×6 |
| Slim Complex + Slim Fiber | 163 | 1,200×2 |
| Veno Gel | 148 | 0×62, 1,490×58, 3,000×24 |
| Neurofix FP | 115 | 2,450×85, 4,800×20, 3,999.9×2 |
| Adenofrin + | 98 | 1,990×83, 3,999.9×6, 4,000.02×5 |
| Hemorofix LP | 94 | 1,490×71, 3,000×17, 4,000×5 |
| Arthrofix Neuropathy | 48 | 1,490×35, 3,000×9, 4,000×4 |
| Diabetol Forte LP | 25 | 1,200×25 |
| Uro Protect [CF27] | 23 | 1,490×22, 3,000×1 |
| Hemorofix FP | 16 | 2,450×14, 12,000×1, 3,999.99×1 |
| DietShake [OFR] | 12 | 1,490×12 |
| Arthro Blue | 11 | 1,200×11 |
| SlimFit | 6 | 2,450×6 |
| Liverfix LP | 5 | 1,490×5 |
| BrainFix LP | 4 | 1,490×3, 1,200×1 |
| Liverfix FP | 4 | 0×3, 2,450×1 |
| Hemoro Forte | 3 | 1,845×1, 1,840×1, 1,200×1 |
| Urofix FP | 2 | 1,490×1, 2,450×1 |
| Cardiofix Full price | 2 | 2,450×2 |
| Parafix FP | 2 | 2,450×2 |
| Calmifix FP | 2 | 2,450×2 |
| Calmifix LP | 2 | 1,490×2 |
| Prostatol Complex RS [Full Price] | 1 |  |
| Uro Protect [CF40] | 1 | 2,450×1 |
| Calm | 1 | 1,200×1 |
| Hepatol Forte | 1 | 1,200×1 |
| Gastro Protect | 1 | 1,200×1 |
| Broncho Protect | 1 | 1,200×1 |
| Sambucus Nigra | 1 | 0×1 |
| Snail Repair Night Cream | 1 | 0×1 |
| Brain Activ | 1 |  |
| Hemorofix varicose vains FP | 1 | 2,450×1 |

## 6. Same phone + product + day

621 clusters hold more than one order, covering 655 extra rows.

These are **kept**. Each has its own AlterCPA id, so each imports as its own row —
a customer who ordered the same product twice in a day is a real (and valuable) signal,
and AlterCPA already routes true duplicates to reason 7 / trash.

## 7. Repeat customers

- orders per phone: 1→33,578, 2→7,636, 3→2,837, 4→1,319, 5+→2,128
- approved orders per phone: 1→16,018, 2→2,298, 3→566, 4→238, 5+→196

19,316 phones have at least one approved order — that is the population the
prediction engine will build its recency, frequency and value bands from.
