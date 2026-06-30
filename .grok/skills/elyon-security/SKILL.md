---
name: elyon-security
description: Use when working on authentication, authorization, RLS policies, webhook security, audit logging, permission systems, secret handling, CORS, rate limiting, or any security-related changes. Critical for protecting customer data, financial information, and operational integrity.
---

# Elyon Security Skill

Security in this CRM is not theoretical — it protects real customer data (names, phones, addresses), financial information, and the operational integrity of a live call centre + warehouse business.

## Core Security Layers

### 1. Row Level Security (RLS)
- RLS is enabled on **almost every table**.
- Agents are heavily restricted by RLS.
- Service role (`adminClient`) bypasses RLS — this is why most backend reads use `adminClient`.
- Key helper functions in the database: `is_admin_or_manager(uid)`, `has_role(uid, 'role')`.

**Never** assume that just because a user is authenticated they can see a row. Always respect RLS in queries.

### 2. Webhook Security (Very Important)
- All inbound webhooks are protected by **HMAC-SHA256**, timing-safe compare.
- Header: `x-webhook-signature` = `hex(HMAC_SHA256(rawBody, WEBHOOK_SECRET))`.
- Secret: `WEBHOOK_SECRET` (stored only in Supabase Secrets — never in code or browser).
- **FAIL-CLOSED (2026-06-11):** if `WEBHOOK_SECRET` is unset the function now **rejects** all webhooks (it used to accept unsigned requests with a warning). Consequence: a blank/missing secret stops inbound leads entirely rather than opening the pipeline — that's intentional. Restore the secret to restore flow.
- Rate limiting per slug + per IP (100/60s); both PBX webhooks (`missed-call`, `missed-call-vm`) are now per-IP limited too.
- **No replay protection yet** (HMAC has no timestamp/nonce) — a captured signed `/webhook/leads` or `/webhook/:slug` call can be replayed to create duplicate leads. Deferred; opencart/missed-call dedupe mitigates their cases.

**Rule**: Any new landing page integration must go through a properly signed webhook. Never weaken the fail-closed check.

### 3. Role-Based Access Control
There is a layered permission system:

- **Roles**: `admin`, `manager`, `agent`, `warehouse`
- **Module permissions** (e.g. `segments`, `performance`, `financial_visibility`)
- **Financial visibility** flag (controls whether cost_price, revenue, etc. are shown)

Admins and managers get broad access. Agents are restricted both by RLS and by the permission system.

Recent change (2026-05-19): Admins automatically receive all non-admin roles via migration + trigger.

### 4. Audit Log
- There is an append-only `audit_log` table.
- Important actions (especially anything touching money, assignments, or customer data) should be logged.
- Never delete or modify audit records.

### 5. CORS & Edge Function Security
- `ALLOWED_ORIGINS` in `supabase/functions/api/index.ts` is the single source of truth for CORS.
- Adding a new domain (e.g. a new landing page domain) requires updating this array **and redeploying the function**.
- Frontend-only changes are not enough.

## Common Security Gotchas in This Project

- Using `supabase` client instead of `adminClient` in the Edge Function when you need cross-user data.
- Forgetting to redeploy the Edge Function after changing `ALLOWED_ORIGINS` or webhook logic.
- Leaving `WEBHOOK_SECRET` unset in production — webhooks now **fail closed** (reject), so this silently stops all inbound leads. Always set the secret before relying on webhooks.
- Re-enabling public signup (`disable_signup` must stay `true`; users are admin-created only). HIBP leaked-password check + session timeouts are Pro-plan — enable on upgrade.
- Assuming an agent can only see their own data without checking RLS.
- Exposing cost prices or revenue to non-financial users.
- Storing secrets in `.env` that gets committed (use the proper Supabase secrets + local `.env` that is gitignored).

## When This Skill Applies

- Adding or modifying any permission check
- Working with webhooks or inbound leads
- Changing RLS policies or database functions related to auth
- Building new admin-only features
- Reviewing any PR that touches authentication, data access, or secrets
- Setting up a new environment or reseller instance

## Key Files & References

- `SECURITY.md` (in docs/)
- `USERS_ROLES_PERMISSIONS.md` (detailed permission matrix)
- `supabase/functions/api/index.ts` — especially the webhook verification function and `ALLOWED_ORIGINS`
- RLS policies are defined in the migrations (search for `CREATE POLICY`)
- Permission checks in the frontend use `useAuth()` and `PermissionsContext`

## Decision Table

| Situation                              | Correct Approach                                      | Dangerous / Wrong Approach                     |
|----------------------------------------|-------------------------------------------------------|------------------------------------------------|
| Reading orders/leads in Edge Function  | Use `adminClient` when crossing user boundaries      | Using regular `supabase` client for admin data |
| Adding new domain                      | Update `ALLOWED_ORIGINS` + redeploy function         | Only updating frontend                         |
| New webhook                            | Create via script, enforce HMAC, set secret          | Accepting unsigned requests                    |
| Showing financial data                 | Check `financial_visibility` permission              | Showing to all logged-in users                 |
| Agent trying to see all data           | Let RLS + permission system restrict them            | Bypassing restrictions in the UI               |

## Golden Rules

1. **Least privilege** is the default. Start restrictive.
2. The Edge Function is the security boundary — never trust the frontend.
3. If you're unsure whether something should be visible to an agent, assume it should **not** be.
4. Always think about auditability for anything that changes money, assignments, or customer records.

This system has real financial and privacy implications. Treat security changes with the same seriousness as stock or payment logic. When in doubt, ask before implementing.