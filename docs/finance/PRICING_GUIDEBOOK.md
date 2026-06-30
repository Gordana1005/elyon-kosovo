# Elyon — Pricing & Promotion Guidebook
### The rules that keep every package profitable

Companion to **[MONTH_ANALYSIS_2026-06.md](MONTH_ANALYSIS_2026-06.md)**. The analysis proved the
problem (you net €5.55/package, below your €7–8 goal, because bundles price the
big orders too cheaply). This is the fix: the formula, the prices, the offers,
and the rules. All figures EUR (peg 1.95583); commission tiers, courier rates
and VAT are the live business rules from the CRM, not assumptions.

---

## 1. The one formula behind everything

A package collects a gross price **P**. Out of it: VAT takes **P ⁄ 6** (20 % baked in),
then product cost **c**, the order's delivery split across its packages **d**, and
agent commission **m** (€1 under €25/pkg). What you keep:

```
net per package = P − P/6 − c − d − m
```

Turn it around to get the **floor price** that guarantees a target profit **T** per package:

> ## **Floor P = 1.2 × ( T + c + d + m )**

The `1.2 ×` is just "add back the VAT" — because after VAT you only keep `P ⁄ 1.2`,
so to walk away with `T + costs` you must charge `1.2 ×` that.

**Your targets:** `T = €7` (floor) and `T = €8` (stretch). Commission `m = €1`
as long as the package price stays **under €25** — so everything in the €14–€24
band keeps your commission cost at its cheapest. That's the sweet spot: price
there freely without raising what you pay agents.

---

## 2. The delivery split is why bundle SIZE changes the floor

Delivery is **one charge per order (~€3.45 blended)**, shared across all packages in it.
So `d = €3.45 ⁄ N` for an N‑package order — **bigger bundle, smaller share, lower floor.**
That's the *good* side of bundling, and it's why a deep bundle can still be healthy
if the per‑package price respects the size‑adjusted floor below.

**Floor price per package, by product cost and bundle size (target = €7 net, m = €1):**

| Product COGS | 2‑pack | 3‑pack | 4‑pack | 6‑pack | 8‑pack |
|---|--:|--:|--:|--:|--:|
| €2.00 (Простатол, Uro, Broncho, Enduro, SAW) | €13.87 | €13.38 | €13.03 | €12.69 | €12.52 |
| €3.00 (Snail) | €15.07 | €14.58 | €14.23 | €13.89 | €13.72 |
| €6.30 (Curcumactiv) | €19.23 | €18.74 | €18.19 | €17.85 | €17.68 |
| €7.50 (Diet shakes) | €20.67 | €20.18 | €19.83 | €19.49 | €19.32 |

For **T = €8**, add **€1.20** to any cell. Read it as: *"a low‑cost product in a
6‑pack must price at least €12.69/package; the same in a 2‑pack needs €13.87."*

---

## 3. Standard price list — what each package should sell for

Round, defensible per‑package prices that clear the €7 floor across normal bundle
sizes. Bundles are built **around** these, never below them.

| Product | Today €/pkg | **Set €/pkg to** | Why |
|---|--:|--:|---|
| Простатол Комплекс | €11.73 | **€14** | hero, low cost — small lift, big total (+€330 cash) |
| Диабетол Форте | €10.44 | **€14** | most underpriced big seller (+€369 cash) |
| Uro Protect | €11.57 | **€14** | (+€204 cash) |
| Snail Complex | €12.20 | **€15** | higher cost band |
| Brain active | €14.91 | **€15** | already healthy — hold |
| Broncho Complex | €22.20 | **€22** | premium, leave it — it works |
| Enduro Max / SAW Palmetto | €12.25 / €11.01 | **€14** | small nudge |
| Hepatol | €6.04 | **€13** | absurdly underpriced today |
| Aloe Vera 500ml | €3.98 | **€13 or drop** | sold below cost — stop using as a free filler |
| **Curcumactiv (500ml)** | €12.69 | **€19** *or cut COGS* | €6.30 cost is the real issue — see §5 |
| Колаген ВАНИЛА / Холестол / Magnesium / OSTEOfix | — | **enter cost first** | margins unknown until costed |

This list alone, applied to existing volume, is the "per‑product floor" row in the analysis: **+€1,317/month profit (+38 %)** (on +€1,581 extra cash) — landing you at **€7.67 net/package, 51.9 % margin**.

---

## 4. Promotional bundle blueprints (offers that still feel like a deal)

Each shows the full per‑order economics. ✅ = clears €7/package. The point: you can
keep the "more for less" psychology *and* stay above the floor — by choosing the
right pack size and price, not by giving units away.

### Простатол / Uro / Enduro (low cost ≈ €2.00)
| Offer | Customer pays | €/pkg | Net/order | **Net/pkg** | |
|---|--:|--:|--:|--:|:--|
| "6 опаковки за **84 €**" | €84 | €14.00 | €48.67 | **€8.11** | ✅ best everyday offer |
| "4 + 2 подарък = 6 за **90 €**" | €90 | €15.00 | €53.67 | **€8.95** | ✅ keeps the "bonus" feel, honestly priced |
| "8 за **100 €**" (current style) | €100 | €12.50 | €56.04 | **€7.01** | ✅ works *only* because cost is rock‑bottom |
| "5 за **65 €**" | €65 | €13.00 | €35.82 | **€7.16** | ✅ small‑order option |

### Snail / mid‑cost (≈ €3.00)
| Offer | Customer pays | €/pkg | Net/order | **Net/pkg** | |
|---|--:|--:|--:|--:|:--|
| "5 за **75 €**" | €75 | €15.00 | €39.05 | **€7.81** | ✅ |
| "6 за **84 €**" | €84 | €14.00 | €42.55 | **€7.09** | ✅ floor‑hugging — don't go lower |

### Curcumactiv / high‑cost (≈ €6.30) — small bundles only
| Offer | Customer pays | €/pkg | Net/order | **Net/pkg** | |
|---|--:|--:|--:|--:|:--|
| "6 за **84 €**" (€14/pkg) | €84 | €14.00 | €22.75 | **€3.79** | ❌ bundling destroys it |
| "3 за **60 €**" (€20/pkg) | €60 | €20.00 | €24.65 | **€8.22** | ✅ the right shape |
| "2 за **40 €**" (€20/pkg) | €40 | €20.00 | €15.28 | **€7.64** | ✅ |

**Takeaway:** the *same product cost dictates the bundle shape.* Cheap products → big
generous bundles at €13–14/pkg. Expensive products → small bundles at €19–20/pkg.
A "+1 free" on a high‑cost product is one of the most expensive things you can do.

---

## 5. The Curcumactiv decision (and any future high‑cost product)

Curcumactiv sold 63 packages and netted **€2.44 each** — €154 total, where a
Простатол‑shaped product would have made ~€450. The cause is COGS **€6.30**, 2–3×
your other products. Two ways out:

1. **Reprice to €19–20/package** in small (2–3) bundles → ~€8/pkg net. Lower volume, real profit.
2. **Cut the cost** — renegotiate the supplier or change pack format. Every €1 off COGS is €1 straight to net. Getting €6.30 → €3.50 would let it live in normal €14 bundles.

Do **not** keep it in "8 for €100"‑style deals. Use this same test on every new
product before it gets a bundle: *run §1 with its real cost.*

---

## 6. Sensitivity — which levers actually move the needle

| Lever | Size of prize / month | Effort |
|---|--:|---|
| **Price floor €14 across the board** | **+€1,392 (+40 %)** | policy + agent scripts |
| Floor €15 | +€1,813 (+53 %) | policy |
| Lift Elena's avg €11 → €14 (one agent) | ≈ +€695 | coaching |
| Cut Curcumactiv COGS €6.30 → €3.50 | ≈ +€175 | supplier |
| Steer 40 door orders → office | ≈ +€60 | call script |
| Halve the return rate (9.6 % → 5 %) | ≈ +€60 | confirmation quality |

Pricing dwarfs everything. Returns and courier mix are real but small — chase
them *after* the floor is in. (Each percentage point of return rate is only ~€12/month.)

---

## 7. The operating rules (pin these)

1. **No package leaves below €14.** That is the €7‑net floor. Use €15 for the €8 goal. This is a hard rule, enforced — see the **Margin Lab** tab.
2. **Build bundles around the §3 standard price**, never below the size‑adjusted floor in §2. Bigger packs may price a little lower per unit — but only down to their floor cell, not to a round number.
3. **High‑cost products sell in small, pricier bundles.** Cheap products carry the big generous bundles. Match the bundle to the cost (§4).
4. **A "free/bonus" package is not free** — it costs its product cost + €1 commission + parcel space. If adding it drops the order's €/package below the floor, shrink the bundle instead.
5. **Stay in the €14–€24 band** to keep commission at €1/package; crossing €25 doubles your commission cost to €2.
6. **Steer willing customers to office delivery** (saves ~€1.50–2.00/order vs door).
7. **Every product must have a cost price** before it can be sold or bundled — no costing, no campaign.
8. **Coach to the floor.** Boris sells the same catalogue at €21.61/package; the prices hold. Bring the high‑volume/low‑price agents up to €14.

---

## 8. Rollout (low‑risk order of operations)

1. **Enter the 4 missing cost prices** (Settings → Products) — makes every number exact.
2. **Set the §3 standard prices** and rebuild the website/landing bundles to §4 shapes. Start with the big three (Простатол, Диабетол, Uro) — 60 % of volume, smallest price move.
3. **Turn on the €14 floor** in the Margin Lab and brief agents with the new bundle scripts.
4. **Watch one month** in Margin Lab: confirm net/package ≥ €7 and that volume held (you have ~29 % of volume to spare before the rise stops paying — see analysis §9).
5. **Then** tidy the small levers: Curcumactiv cost, office‑delivery steering, return quality.

The expected result, on flat volume: **profit from €3,446 → ~€4,840/month (+40 %),
€7.79 net per package, 52 % margin.** Your target, with room to spare.
