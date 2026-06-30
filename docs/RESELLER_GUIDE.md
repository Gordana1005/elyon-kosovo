# Reseller & multi‑tenant guide

> How to stand Elyon CRM up for **another business or country**, onboard a client's existing customers from
> a CSV, white‑label it, and pitch it. Use this for sales decks and for actually delivering a new tenant.

---

## 1. What you're selling (the one‑liner)

> **A web‑based call‑centre CRM for COD (cash‑on‑delivery) tele‑sales.** Import a lead list, distribute to
> agents, call from the browser, confirm orders, hand a daily CSV to the warehouse/courier, and watch
> revenue, conversion, returns and per‑agent performance in real time — with automatic re‑marketing lists
> that re‑surface past buyers at the right time.

It's purpose‑built for the **cross‑border tele‑sales** model (agents in a low‑cost country calling
customers in a target country on local numbers), but it works for any single‑country COD operation too.

---

## 2. What's reusable vs. what's country‑specific

| Reusable as‑is (the product) | Bulgaria‑specific (swap per tenant) |
|---|---|
| Order lifecycle & state machine | Currency peg `1 EUR = 1.95583 BGN` ([../src/lib/currency.ts](../src/lib/currency.ts)) |
| Calls workspace, queue, outcomes, telemetry | Phone normalisation to `+359` (`normalizeBgPhone`) |
| Roles/permissions, shifts, audit log | Cyrillic↔Latin transliteration (`CYR_TO_LAT`) |
| Prediction lists (27 rule‑driven segments) | Couriers: Speedy/Econt scrapers + office picker |
| Analytics (dashboard, insights, performance) | Address autocomplete: Econt BG settlements/streets |
| Inbound webhooks + OpenCart/WooCommerce bridge pattern | Fulfilment CSV column spec (per warehouse) |
| Stock/inventory, products, suppliers, restock | Telephony carrier (A1 Business Voice) + DIDs |
| Import scripts (XLSX/CSV), audits | Default language/labels (English UI, BG data) |

**Architecture is single‑tenant per deployment.** There is no `tenant_id` column; each client gets their
own Supabase project + Vercel project + (optional) PBX. That's the cleanest isolation for data residency and
billing, and it matches how this one is built. (A true multi‑tenant SaaS would need a `tenant_id` on every
table + RLS by tenant — a larger refactor; see §7.)

---

## 3. Stand up a new tenant (the repeatable playbook)

This is the DR/clone flow from [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) §9, framed for delivery.

1. **Supabase project** — create it; note ref / URL / anon key / service‑role key / DB password.
2. **Schema** — `supabase link --project-ref <ref>` → `npx supabase db push` (rebuilds every table, RLS,
   function, trigger, the 27 segment rules) → `npx supabase functions deploy api`.
3. **Secrets** — `supabase secrets set WEBHOOK_SECRET=<new>`; ensure `SUPABASE_ANON_KEY` set on the function.
4. **Frontend** — new Vercel project; set `VITE_SUPABASE_*`; point the client's domain at it; **add that
   domain to `ALLOWED_ORIGINS` and redeploy the function**.
5. **Admin users** — `node scripts/create-admin-users.mjs` (then rotate passwords).
6. **Localise** (§4) — currency, phone, couriers, language.
7. **Reference data** — settlements + courier offices for the target country; product catalogue import;
   `create-webhooks-for-products` for landing‑page intake.
8. **Telephony** (optional) — own PBX + the client's carrier SIP trunk ([CALLING_PLAN_SIP.md](CALLING_PLAN_SIP.md)),
   or start in mock/manual mode and add the softphone later.
9. **Onboard the client's customers** (§5).

Day‑1 without telephony is fine — agents can run the whole CRM and call manually while the trunk is arranged.

---

## 4. Localising for a new country

| Concern | Where | What to change |
|---|---|---|
| **Currency** | `src/lib/currency.ts` | Set the peg or switch to single‑currency display; relabel лв. Storage stays in the base currency. |
| **Phone** | `normalizeBgPhone` (Edge Function) + last‑8 matching | Change the country code (`+359` → target) and the national‑format conversion in the fulfilment CSV. |
| **Transliteration** | `CYR_TO_LAT` (Edge Function) + importer | Replace/extend for the target script (or drop if Latin‑only). |
| **Couriers** | `scripts/scrape-courier-offices.mjs`, `DeliveryMethodPicker`, `courier_offices` | Replace with the country's couriers + office source; or switch to home‑only delivery. |
| **Addresses** | `bg_settlements`, `getEcontStreetsAndQuarters` | Swap the settlement/street data source (or use free‑text). |
| **Fulfilment CSV** | `Orders.tsx` CSV columns | Match the new warehouse/courier importer's exact spec (delimiter, BOM, columns, currency). |
| **Language** | UI strings (English today) | Add i18n or translate labels; data stays in the customer's language. |
| **Carrier** | PBX trunk config | The client's SIP provider; per [CALLING_PLAN_SIP.md](CALLING_PLAN_SIP.md). |

Most of these are isolated; the currency/phone/transliteration are small constant swaps, couriers/addresses
are the biggest effort.

---

## 5. Onboarding a client's existing customers (CSV import)

The fastest "wow": load the client's customer/lead history so agents have a full dossier from day one.

1. **Get their export** — any CSV/XLSX with name, phone, city/address, product, price/date if available.
2. **Map to one of two shapes:**
   - **Leads to call** → `prediction_leads` (via a `prediction_lists` "list"). Use the
     `import-cpa-xlsx.mjs` / `import-outbound-xlsx.mjs` pattern as a template: read rows, normalise phones
     to E.164, transliterate city/name for search, insert in batches, write provenance into notes.
   - **Historical orders** (so analytics + segments are populated) → `orders` (+ `order_items`). Set
     `status` to the right historical value (`paid` for delivered history), `created_at` to the order date,
     and `source_type='import'`. Leave `product_id` null if you can't match the catalogue (legacy‑safe).
3. **Run on the new project** with its service‑role key in `.env`. Keep it **dry‑run first**, then `--commit`.
4. **Recompute segments** — `POST /segments/recompute` (or `recompute_all_segments()`); the 27 lists fill
   automatically from the imported paid/cancelled/returned history.
5. **Verify** — `check-segment-counts.mjs`, `check-customer-intelligence.mjs <phone>`, spot‑check the
   Dashboard.

> Write a tiny per‑client importer (copy an existing one, change the column map + the country constants).
> Phones and transliteration are the two things to get right or search/dedup breaks.

A clean **CSV template** to ask clients for: `first_name, last_name, phone, city, address, postal_code,
product, quantity, price, order_date, status`.

---

## 6. White‑labelling
- **Name/branding:** `index.html` (title/favicon), `package.json` name, logo/colours via the Tailwind
  tokens in `src/index.css` / `tailwind.config.ts`, sidebar header in `AppSidebar.tsx`.
- **Domain:** the client's own (Vercel) + their PBX subdomain.
- **No "Elyon" strings are load‑bearing** — it's a normal React app; rebrand is cosmetic.
- **Data isolation:** separate Supabase project per client = separate DB, separate backups, separate billing.

---

## 7. Selling it as SaaS (if you go multi‑tenant later)
Current model = **one deployment per client** (simplest, best isolation, easy to bill). To run many clients
on one stack you'd add:
- a `tenants` table + `tenant_id` on every table, with RLS scoped by tenant;
- tenant resolution from the JWT/subdomain in the Edge Function;
- per‑tenant config (currency, couriers, carrier) moved from constants into a `tenant_settings` row;
- a billing/usage meter.
That's a real project — quote it separately. For 1–10 clients, **clone‑per‑tenant is faster and safer.**

---

## 8. The pitch (deck outline)

1. **Problem** — COD tele‑sales teams run on spreadsheets + a separate dialer + manual courier files;
   leads leak, agents aren't measured, repeat buyers aren't re‑marketed.
2. **Solution** — one screen per agent: customer + history + product + dialer + outcome; one CSV to the
   warehouse; live analytics for the owner.
3. **Differentiators** —
   - **In‑browser softphone** on the agent's own queue (no app‑switching), with call recording.
   - **Automatic re‑marketing**: 27 rule‑driven lists resurface past buyers by recency/value/behaviour.
   - **COD‑correct analytics** (revenue on a SOLD basis, not just collected cash) so "today" isn't empty.
   - **Cross‑border ready**: agents abroad, local caller‑ID via a country SIP trunk.
   - **Inbound automation**: landing pages + e‑commerce (OpenCart/WooCommerce) push orders straight to the
     pending queue over signed webhooks.
4. **Proof** — live demo (§9) on the real Bulgarian deployment.
5. **Pricing model** — setup (stand‑up + localisation + import) + monthly (hosting ~€10–25 infra +
   carrier pass‑through, e.g. A1 €160/mo for 4 lines/10 DIDs/5000 min) + per‑seat. Margins are in the
   localisation + carrier setup expertise.
6. **Timeline** — CRM live in **days** (clone + import); telephony in ~1–2 weeks once the carrier issues a trunk.

## 9. Demo script (10 minutes)
1. Show the **Assigner** → bulk‑assign a batch of pendings to "Agent A".
2. Log in as the agent → **Calls** page auto‑picks the queue → open a customer → show the dossier (orders,
   calls, lifetime value, quality badge) → **Dial** → pick **Confirmed** → fill the order modal.
3. Back as admin → **Orders** → **Daily Fulfilment CSV** → show "Ready to ship by" + "Mark as shipped" →
   download → show stock auto‑decrement on a product.
4. **Insights** → revenue/AOV/funnel/returns/agent ranking; **Operations** → who's online now.
5. **Prediction Lists** → show how a paid order just moved that customer into a re‑marketing list.
6. **Inbound** → POST a test webhook (or place a test order on the demo store) → watch it appear in
   Pendings within seconds.

---

## 10. Delivery checklist (per new client)
- [ ] Supabase project + `db push` + `functions deploy`
- [ ] `WEBHOOK_SECRET` + anon key set on the function
- [ ] Vercel project + domain + `VITE_*` + `ALLOWED_ORIGINS` updated + redeploy
- [ ] Localised: currency, phone code, couriers/addresses, CSV spec, language
- [ ] Reference data: settlements + courier offices + product catalogue + webhooks
- [ ] Admin users created + passwords rotated; roles/permissions reviewed in `/settings`
- [ ] Customer/lead CSV imported (dry‑run → commit) + segments recomputed + verified
- [ ] Telephony: trunk + extensions (or documented manual‑calling interim)
- [ ] New tenant's secrets recorded in their own VAULT (never reuse another client's)
