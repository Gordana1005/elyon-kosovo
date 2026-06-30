# Elyon — Realized Per‑Package Money Analysis
### Window: 2026‑05‑25 → 2026‑06‑25 (the Insights "1 month" view) · paid orders only

> Every number below is reproduced from the live database by
> `scripts/finance/analyze-packages.mjs` and **reconciles to the cent** with the
> Insights → Pure Profit screen (cash €7,605.66, VAT €1,267.61, COGS €1,614.29,
> delivery €647.88, returns €121.18, commission €509.00, clear €3,445.70, 160
> orders, 621 packages). The full per‑package dump is in
> `packages-realized-2026-05-25_to_2026-06-25.xlsx`.
>
> Currency peg 1.95583. EUR is primary; лв in parentheses for the headline lines.

---

## 1. TL;DR — the five facts and the one move

1. **You net €5.55 per package** today (€3,445.70 ÷ 621). That's **45.3 %** of cash collected — actually *healthy* for COD, but below your €7–8/package goal.
2. **The customer pays €12.25 per package on average** (median €11.90). Not €24.99, not the catalogue price — €12.25. The list price in Products is irrelevant; the bundles set the real price.
3. **100 % of orders are multi‑pack bundles.** There is not a single one‑package sale in the month. *Pricing strategy = bundle strategy.* Nothing else.
4. **Your most common bundle size (4–5 packages) is your cheapest per package (€11.14).** You discount hardest exactly where the volume is. That's the leak.
5. **17 packages were sold at a real loss** — giveaway/"free" units priced €0.20–€1.00 that still cost product + €3–4 shipping share + €1 agent commission.

**The one move:** a hard rule **"no package leaves below €14"**. Holding volume flat, that alone is **+€1,392/month profit (+40 %)**, lifting you to **€7.79 net per package at 52 % margin** — your target, hit. A €15 floor → **+€1,813/month (+53 %), €8.47/package**. (Math + how to roll it out without killing conversion in §9 and the [Pricing Guidebook](PRICING_GUIDEBOOK.md).)

---

## 2. Where every euro of a package goes (average package = €12.25)

| Slice | €/package | Share of price | Month total |
|---|--:|--:|--:|
| VAT (20 %, baked into price) | €2.04 | 16.7 % | €1,267.61 |
| Product cost (COGS) | €2.60 | 21.2 % | €1,614.29 |
| Delivery (outbound share) | €1.04 | 8.5 % | €647.88 |
| Return loss (round‑trip) | €0.20 | 1.6 % | €121.18 |
| Agent commission | €0.82 | 6.7 % | €509.00 |
| **Net profit you keep** | **€5.55** | **45.3 %** | **€3,445.70** |

Read it this way: on a €12.25 package, **€6.70 is cost and €5.55 is yours.** To make the kept slice €7–8, the package has to sell for ~€14–15 (costs barely move when you raise price — only VAT scales with it).

---

## 3. The realized price per package — the truth you didn't have

Distribution across all **621 packages** (what customers actually paid, per package):

| Min | p10 | p25 | Median | Mean | p75 | p90 | Max |
|--:|--:|--:|--:|--:|--:|--:|--:|
| €0.20 | €8.92 | €10.00 | €11.90 | €12.25 | €13.00 | €16.67 | €40.00 |

Two things jump out:

- **Prices cluster at bundle math, not at a strategy.** They pile up at €10.00, €12.50, €13.33, €16.67 — i.e. "X packages for a round number." Half your packages sit at **€10–€13**. There is no deliberate floor; the floor is wherever the bundle arithmetic landed.
- **The long cheap tail is giveaways.** The €0.20–€1.00 packages are "free/bonus" units recorded at near‑zero price. They drag the average down *and* cost you money (see §6).

---

## 4. The bundle problem — you discount hardest where the volume is

Realized €/package by how many packages were in the order:

| Order size | Packages | Mean €/pkg | Median | What it means |
|---|--:|--:|--:|---|
| 2–3 pkgs | 158 | **€14.99** | €13.33 | Small orders are healthily priced |
| **4–5 pkgs** | **333** | **€11.14** | €10.00 | **Your bulk volume — and your worst price** |
| 6–7 pkgs | 67 | €10.33 | €10.00 | Even cheaper |
| 8+ pkgs | 63 | €13.29 | €12.50 | Mixed (some premium products) |

**53 % of all packages live in the 4–5 bucket at €11.14** — below the €14 break‑even for a €7 net. The "buy more, pay less per unit" instinct is fine, but right now the bigger bundles fall *under* the cost‑plus‑target line. The fix isn't "stop bundling" — it's "price the bundle so each package still clears the floor" (Guidebook §3).

---

## 5. Per‑product margin & the floor price each one needs

Net profit **per package today** vs the **floor price** needed to net €7 (and €8). Sorted by volume. `↑%` = how far today's realized price must rise to reach the €7 floor.

| Product | Pkgs | COGS/u | Realized €/pkg | Net €/pkg now | Floor €7 | ↑% | Floor €8 | Status |
|---|--:|--:|--:|--:|--:|--:|--:|:--|
| Простатол Комплекс | 177 | €1.98 | €11.73 | €5.86 | **€13.08** | +11 % | €14.28 | below |
| Диабетол Форте | 123 | €2.34 | €10.44 | €4.56 | **€13.36** | +28 % | €14.56 | below |
| Uro Protect | 76 | €2.48 | €11.57 | €5.26 | **€13.65** | +18 % | €14.85 | below |
| Curcumactiv (500ml) | 63 | **€6.30** | €12.69 | **€2.44** | **€18.16** | +43 % | €19.36 | ⚠ high COGS |
| Brain active (30cps) | 58 | €2.85 | €14.91 | €7.79 | €13.97 | — | €15.17 | ✅ clears €7 |
| Snail Complex | 28 | €3.00 | €12.20 | €5.18 | €14.38 | +18 % | €15.58 | below |
| Колаген Пептид ВАНИЛА | 24 | *unknown* | €14.55 | (€9.85)* | — | — | — | ⚠ no cost |
| Broncho Complex | 20 | €1.97 | €22.20 | €14.27 | €13.06 | — | €14.26 | ✅ premium |
| Aloe Vera 500ml | 9 | €1.99 | **€3.98** | **−€0.22** | €12.64 | +217 % | €13.84 | ❌ loses money |
| Enduro Max | 8 | €1.80 | €12.25 | €6.53 | €12.82 | +5 % | €14.02 | below |
| SAW Palmetto | 7 | €1.60 | €11.01 | €5.56 | €12.73 | +16 % | €13.93 | below |
| Hepatol | 5 | €1.34 | €6.04 | €2.42 | €11.53 | +91 % | €12.73 | below |

\* margin shown with €0 cost because no cost price is on file — treat as unknown, not as profit.

**The three stories in this table:**
- **The big three (Простатол, Диабетол, Uro = 376 pkgs, 60 % of volume) all sit €11–13 and just need a +11–28 % nudge to €13–14** to clear €7. This is most of the win, and it's a small price move.
- **Curcumactiv is the problem child:** COGS €6.30 (2–3× everything else) means it nets only €2.44/pkg. It needs €18+ *or* a cheaper supplier — never deep‑bundle it.
- **Aloe Vera is sold below cost** (€3.98 vs €1.99 cost + €0.55 shipping + €1 commission + VAT). Stop selling it as a near‑free filler.

---

## 6. Loss‑makers & the hidden cost of "free"

- **17 packages were sold at a loss this month.** Every one is a near‑zero‑priced "bonus/free" unit: Snail, Uro, Aloe, Hepatol, SAW packages recorded at €0.20–€1.00.
- A "free" package is **not free to you**: it still costs its COGS (€2–6), still adds to the courier's parcel, and **still pays the agent €1 commission** (the bonus tier pays €1 even on a €0 package). Worst single example: `ORD‑31297`, a "free" Snail Complex unit that cost you **−€4.26**.
- Only **4 lines / 6 packages** are recorded as explicit free units — so most giveaways are *baked into a low per‑unit price* instead (that's why the €10/pkg cluster exists). Either way, the giveaway is real and it is the cheapest‑priced tail of §3.

**Rule:** a bonus package must be costed like a paid one. If "+1 free" drops the order's effective €/package below the floor, the promo is losing money — replace it with a smaller, honestly‑priced bundle (Guidebook §3).

---

## 7. By agent — your biggest untapped lever

| Agent | Pkgs sold | Mean €/pkg | Read |
|---|--:|--:|---|
| **elenabelovska** | **289** | **€11.04** | 47 % of all volume — at the **lowest** price |
| tinadimitrieva | 88 | €11.59 | high volume, low price |
| Miki Mitrov | 81 | €12.37 | (super‑admin — earns €0 bonus) |
| Mile Stoev | 39 | €11.41 | (you) |
| Ljopce Stefchova | 34 | €13.65 | healthier |
| NikolaJovanov | 30 | €16.00 | strong |
| **Boris Projkov** | **28** | **€21.61** | sells nearly **2×** the price per package |

Same products, wildly different realized prices. **Boris gets €21.61/package; Elena gets €11.04.** Elena drives the volume but at the bottom of the price range. If her average moved from €11 to just €14 (the floor), that's **+€2.96 × 289 × 0.83 (after VAT) ≈ +€695/month from one agent**, before touching anyone else. This is a coaching + script + allowed‑bundle problem, not a demand problem — Boris proves the prices hold.

---

## 8. By courier — small, steady savings

| Courier / service | Delivered | Returned | Deliver €/order | Return €/order |
|---|--:|--:|--:|--:|
| Econt — door | 46 | 7 | €4.56 | €7.36 |
| Speedy — door | 67 | 7 | €3.21 | €5.70 |
| Econt — office | 65 | 4 | €3.05 | €5.32 |
| Speedy — office | 10 | 2 | €2.48 | €4.24 |

- **Return rate ≈ 9.6 %** (20 returns of 208 shipments), costing **€121.18**. Each return is pure loss — the product comes back but both shipping legs are gone.
- **Office delivery is ~€1.50–2.00 cheaper per order than door.** Steering willing customers to office pickup (esp. Speedy office at €2.48) is free margin. Door is fine where the customer needs it — just don't default to the expensive leg.

---

## 9. What happens if you raise prices (volume held flat)

A hard per‑package floor, applied to the same 621 packages (no demand change):

| Rule | Pkgs lifted | Extra cash | New clear profit | Δ profit | Net €/pkg | Margin |
|---|--:|--:|--:|--:|--:|--:|
| **No package < €13** | 74 % | +€1,179 | €4,428 (8,665 лв) | **+29 %** | €7.13 | 50.4 % |
| **No package < €14** | 81 % | +€1,670 | **€4,837 (9,461 лв)** | **+40 %** | **€7.79** | 52.2 % |
| No package < €15 | 81 % | +€2,175 | €5,258 (10,284 лв) | +53 % | €8.47 | 53.8 % |
| No package < €16 | 86 % | +€2,710 | €5,704 (11,156 лв) | +66 % | €9.18 | 55.3 % |
| Per‑product €7 floor (§5) | — | +€1,581 | €4,763 (9,316 лв) | +38 % | €7.67 | 51.9 % |
| Per‑product €8 floor (§5) | — | +€2,192 | €5,272 (10,312 лв) | +53 % | €8.49 | 53.8 % |

**Safety check on demand:** at the €14 floor you'd earn €7.79/package vs €5.55 today. Even if the price rise scared off customers, **you could lose up to ~29 % of all volume and still make today's profit** (€4,837 ÷ €7.79 ≈ 442 packages = the break‑even; you're at 621). The price increase is +14 % on average; losing more than a quarter of buyers to a 14 % rise on a COD health product is unlikely. The risk is asymmetric in your favour.

---

## 10. Data quality — fix these to make the numbers exact

Four sold products have **no cost price on file**, so their COGS counts as €0 and their margins above are overstated:

| Product | Packages sold (month) |
|---|--:|
| Колаген Пептид со ВАНИЛА 200 гр | 24 |
| ХОЛЕСТОЛ КОМПЛЕКС 30 cps | 6 |
| MAGNESIUM CITRAT 325mg | 4 |
| OSTEOfix | 1 |

Cost coverage is **94.4 %** of sold packages. Enter these four costs in **Settings → Products** and every margin number tightens. (This is the same banner the Pure Profit screen shows.)

---

## 11. How to reproduce / re‑run

```bash
node --env-file=.env scripts/finance/analyze-packages.mjs              # default = last 1 month
node --env-file=.env scripts/finance/analyze-packages.mjs --from 2026-05-01 --to 2026-05-31
node --env-file=.env scripts/finance/analyze-packages.mjs --target 8   # change the net‑profit floor
```

Read‑only. Writes the Excel workbook and prints the reconciliation + every table above. The same engine is being built into the CRM as the **Margin Lab** tab so you never have to run a script again.

➡ **Next:** the forward plan — exact new prices, bundle blueprints, and operating rules — is in **[PRICING_GUIDEBOOK.md](PRICING_GUIDEBOOK.md)**.
