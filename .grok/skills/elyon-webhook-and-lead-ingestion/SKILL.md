---
name: elyon-webhook-and-lead-ingestion
description: Use for anything involving inbound webhooks, landing page leads, HMAC signature verification, per-product webhook slugs, rate limiting, or how external forms create pending orders in the CRM. Critical for the inbound pipeline and any new website integrations.
---

# Elyon Webhook & Lead Ingestion Skill

## Architecture Overview

New "pendings" arrive via **HMAC-signed webhooks**. There is **one webhook per active product**.

- The URL the landing page POSTs to encodes which product the lead is interested in.
- The form only needs to send `{ name, phone, source? }`.
- The CRM automatically creates an `inbound_lead` + a `pending` order with the correct `product_name`.

This design means the landing page itself stays simple.

## Security Model (Non-Negotiable)

- Every POST **must** include `x-webhook-signature: <hex(HMAC_SHA256(rawBody, WEBHOOK_SECRET))>`
- If the signature is missing or wrong → 401
- The secret (`WEBHOOK_SECRET`) lives only on the Supabase Edge Function (never in browser code).
- If the secret is unset in production, the function logs a warning and falls back to accepting unsigned requests — **this is dangerous**. Never leave it unset.

## Slug → Product Mapping

- Slugs are created by `scripts/create-webhooks-for-products.mjs`
- Slug = transliterated lowercase product name (Cyrillic-aware)
- **Never rename a slug** without updating every landing page that uses the old URL. 404s are silent failures for leads.

## Data Flow

1. Landing page POST → `/functions/v1/api/webhook/:slug`
2. HMAC verification + rate limiting (per slug + per IP)
3. INSERT into `inbound_leads`
4. INSERT into `orders` (status=pending, source_type='inbound_lead', inbound_lead_id=...)
5. The order becomes visible in /inbound-leads (admin) and the normal Pending queue (agents)

## When to Use This Skill

- Adding a new product and needing its webhook
- Debugging missing leads from a website
- Changing webhook behavior or rate limits
- Working on the `/webhooks` admin UI
- Any OpenCart or external form integration

## Important Files

- Backend handler: `supabase/functions/api/index.ts` (webhook routes, signature verification at the end of the file)
- Admin UI: `/webhooks` page
- Seeding script: `scripts/create-webhooks-for-products.mjs`
- Schema: `inbound_leads`, `webhooks` tables

## Common Pitfalls

- Putting the `WEBHOOK_SECRET` in frontend JavaScript (never do this).
- Forgetting to re-run the seeding script after adding new products.
- Changing slugs instead of deleting + recreating (breaks live landing pages).
- Assuming unsigned requests will be rejected in production (they won't if the secret is missing).

This pipeline is the primary source of new real customer leads. Treat the security and mapping rules as sacred.