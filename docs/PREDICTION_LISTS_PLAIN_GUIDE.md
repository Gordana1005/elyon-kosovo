# Prediction Lists — The Plain-Words Guide

*For everyone: agents, managers, new people. No technical knowledge needed.*
*This describes the live system since 10 June 2026. The technical version is in [HOW_PREDICTION_SEGMENTS_WORK_NOW.md](HOW_PREDICTION_SEGMENTS_WORK_NOW.md).*

---

## What prediction lists are

Prediction lists are how we decide **which past customer to call, and when**. The system looks at every customer's real order history and sorts them into the one list that best describes them right now — for example *"4-6m 26+ (3+ orders)"* means: *last bought 4–6 months ago, last order was over €26, has 3–4 paid orders in total*. Agents then work through these lists to bring customers back.

## The three golden rules

1. **One customer = one list.** Nobody ever appears in two calling lists at the same time, so two agents can never call the same person from different lists.
2. **The name on the list is always true.** If the list says "(3+ orders)", every single person inside has at least 3 paid orders. If it says "26+", their last order really was over €26. No exceptions.
3. **The system re-sorts itself.** Every night at 03:00 it re-checks everyone, and during the day it reacts instantly the moment any order changes. You do not have to press anything for it to stay correct.

---

## How a customer gets sorted — three simple questions

The system asks three questions about each customer's **paid** orders (only real, completed-and-paid orders count — pending, cancelled or trashed ones do not):

**Question 1 — When did they last pay?**

| Time since last paid order | They go into… |
|---|---|
| Less than 21 days | **NEWCOMERS** (resting — just bought, don't push them) |
| 21 to 57 days | **21d** lists |
| 57 days to 4 months | **57d** lists |
| 4 to 6 months | **4-6m** lists |
| 6 to 12 months | **6-12m** lists |
| 1 to 2 years | **1-2yr** lists |
| Over 2 years | **2yr+** lists |

**Question 2 — How much was their last paid order?**

- **≤26** → it was €26 or less
- **26+** → it was over €26

**Question 3 — How many paid orders do they have in total (ever)?**

| Total paid orders | Label |
|---|---|
| 1 or 2 | **(1-3 orders)** |
| 3 or 4 | **(3+ orders)** |
| 5 or 6 | **(5+ orders)** |
| 7 or more | **(7+ orders)** |

The answers are glued together into the list name. Example: a customer who last paid **5 months ago**, whose last order was **€35**, and who has **3 paid orders** in total → list **"4-6m 26+ (3+ orders)"**.

> Note: someone with exactly 3 orders fits both "1-3" and "3+", and the system always uses the **strongest true label** — so they go to "(3+ orders)". That's why "(1-3 orders)" lists in practice hold people with 1–2 orders.

---

## The special rooms (people who are NOT in the normal lists)

- **Order in progress, never bought before** — someone whose first order is still pending / being confirmed / shipped is **in no calling list at all**. They are handled in the Pendings section. The moment the order finishes (paid or cancelled), the system sorts them instantly.
- **NEWCOMERS** — paid less than 21 days ago. They exist as lists so you can see them, but the idea is: they just bought, let them rest 21 days before any re-marketing call. **They are never handed to an agent automatically — only you assign them.** After 21 days the system moves them into their normal band list on its own (and if you had assigned them, that agent goes with them).
- **Current Cancels** — anyone whose **latest action was a cancellation** (within the last 14 days). They are parked here, **assigned to nobody**, so they don't get a sales call right after saying no. After 14 days the system automatically returns them to their normal list.
- **Current Returns** — anyone whose **most recent order was returned**. This is an **extra** list just for tracking returns — **assigned to nobody**. If the customer has bought before, they **also** stay in their normal calling list (they show in both places); if they never had a successful purchase, they show **only** here. They drop off automatically the moment they place a new order. The list shows the returned order's date.
- **Never-Converted Recent / Old** — people who never bought anything. "Recent" = their last cancellation was within 6 months; "Old" = older than that, or no real history (including junk/unreachable numbers). Lowest priority calling material.
- **FULL MONAD LIST** — the imported Monadon customers. They are **only** here, never in our normal lists, and their old purchases never count as ours.
- **Cancelled Pendings** — a hand-made list (old leads kept with name + product for callback). The system never touches hand-made lists.

---

## One customer's journey (example)

1. **Maria orders for the first time today** → her order is pending → she is in **no list** (the Pendings team handles her).
2. **She pays** → instantly moved to **NEWCOMERS (1-3 orders)** → rests for 21 days.
3. **Day 21** → that night the system moves her to **"21d ≤26 (1-3 orders)"** (her order was €22). She's now callable.
4. **An agent calls her, she buys again (€31)** → instantly back to **NEWCOMERS** for a new 21-day rest, **unassigned again** (NEWCOMERS never auto-holds an agent — you re-assign her if you want her called early). Her stats now: 2 paid orders, last order over €26.
5. **She ages through the bands**: 21d 26+ (1-3) → 57d 26+ (1-3) → 4-6m 26+ (1-3) … moving automatically each night as time passes — until somebody calls her and she buys again.
6. **One day she orders but then cancels** → instantly parked in **Current Cancels** for 14 days, nobody calls her → after 14 days she quietly returns to her normal band list.

---

## What the columns on a list page mean

| Column | Meaning |
|---|---|
| **Last order** | Price and date of their most recent paid order (for cancel lists: the cancelled order) |
| **Total orders** | How many paid orders they have ever had |
| **Avg / pkg** | Average money per order (total ÷ orders), shown in € and лв |
| **Total spend** | Everything they have ever paid us |
| **Assigned** | Which agent owns this customer right now |
| **Last call** | When we last called them and what happened |

## What happens to agent work when someone moves lists

When a customer moves from one list to another (for example ages from 21d into 57d), **the agent assignment and the call history move with them** — work is never lost. Two sensible exceptions:

- When a customer **buys again**, their "done" mark is cleared — they're a fresh opportunity again (after the 21-day rest).
- When a customer enters **Current Cancels**, the assignment is removed on purpose — nobody should call them there.
- When a customer enters a **NEWCOMERS** list, any inherited assignment is removed on purpose — fresh buyers are handed to an agent only when **you** assign them. (Once you do, that agent stays with them when they later age out of NEWCOMERS.)

---

## How to know it's all working

- The **Prediction Lists page** shows a green line: *"Engine data as of {time} · auto-recompute nightly 03:00"*. If that time is from last night or later — the system is alive and current.
- Want hard proof? Run: `node scripts/audit-segments-integrity.mjs` — it prints 10 checks (one list per person, labels true, everyone in the right time band, no Monadon pollution, nightly job alive, …). All must say **PASS**.
- The **"Recompute all"** button on the Prediction Lists page forces a full re-sort right now. Safe to press any time; it does the same thing the nightly job does.

## If something looks wrong

1. Press **Recompute all** and look again.
2. Run the audit script above — it will tell you exactly which rule is broken.
3. **Never** paste old SQL files into the Supabase dashboard — that is exactly what broke the system in June 2026. All changes go through new migration files only.

---

*Built and verified 10 June 2026 (engine v3). If the rules ever change, update this guide, the technical doc, and the `elyon-segments-and-prediction` skill together.*

---

## New: editing the lists yourself (Settings → Prediction Engine)

Soon you won't need a developer to change how the lists are built. There's a new **Prediction Engine** screen in Settings where you can move the day-bands, change the €26 split, rename tiers, and add or remove lists — all yourself.

It's being rolled out carefully: for now your edits build a **preview** (a shadow copy) next to the real lists, so you can see exactly what would change before anything goes live. When you're happy, we flip one switch.

It also adds a **"Due to Reorder"** list: it works out, from how many packages each customer bought, roughly when they'll run out — and calls them a few days before. (Most packs = 15 days; a 4-pack = 60.) Set each product's days-of-supply on the Products screen.
