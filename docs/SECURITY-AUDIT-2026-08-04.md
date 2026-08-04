# Security audit — Elyon CRM Macedonia — 2026-08-04

Scope: the Macedonian instance only (Supabase `bmfxhgznttcnnlqloqzp`, Vercel `elyon-natura`).
Method: read of every migration, the edge function, the frontend auth/permission layer and the
deploy config, plus live read-only probes against the running project.

**Headline:** three HIGH-severity issues were live and are now fixed. The most serious was a
one-call privilege escalation from `manager` to `admin`; the most surprising was that public
self-registration was enabled on a CRM that has no self-service signup.

Secret hygiene was and remains clean — no key has ever been committed to this repo
(`git log --all -S` over the JWT prefix returns nothing), `.env` and `docs/VAULT.md` are
gitignored, and only public `VITE_*` values reach the client bundle.

---

## How security works today

```
Browser ── publishable key + user JWT ──► PostgREST (RLS)          auth, get_my_permissions, a few direct reads
Browser ── user JWT ──► edge fn `api` ── service role ──► DB       ~everything else; the fn re-checks roles itself
Internet ── HMAC-SHA256 ──► edge fn webhooks ── service role ──► DB  leads, PBX, recordings, OpenCart
Partner  ── affiliates.api_key ──► /api/cpa/lead                    CPA intake (no HMAC, by design)
TV       ── ?key=<token> ──► /api/leaderboard                       token-gated public aggregate
pg_cron  ── x-postback-secret ──► /api/cpa/postbacks/process        postback drain
Operator ── service_role in .env ──► DB                             scripts/ (full admin)
```

- **Authentication** is Supabase email/password only. There is no signup path in the app. Sessions
  persist in `localStorage` with auto-refresh. The login form appends the placeholder domain
  `elyon-mk.local` only when the typed value contains no `@`.
- **Roles** live in the `user_roles` table (many-to-many), read server-side with the service role —
  not from JWT claims, so a forged token cannot grant a role. The `app_role` enum has nine values:
  `admin, manager, agent, pending_agent, prediction_agent, inbound_agent, warehouse, ads_admin,
  affiliate`. There is **no `superadmin`** — that is the UI's label for `admin`.
- **Authorization** has four layers: the affiliate hard wall (an affiliate-only login is refused
  everything outside `affiliate/*`), module permissions from `role_permissions` enforced
  server-side, PII redaction driven by `role_privacy`, and RLS as the PostgREST backstop keyed on
  the `SECURITY DEFINER` helpers `has_role()`, `is_admin_or_manager()` and `is_internal_staff()`.
  Frontend route gating is UX only; the function does not trust it.
- **Webhooks** verify HMAC-SHA256 over the raw body with a timing-safe compare and **fail closed**
  when the secret is unset.
- **Audit** writes to an append-only `audit_log` whose UPDATE/DELETE triggers block even the
  service role, plus `order_history` for orders.

---

## Findings

Severity is about impact on this deployment, not theoretical CVSS.

### Fixed in this bundle

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| **H1** | HIGH | **Manager → admin escalation.** `user_roles` carried `CREATE POLICY … FOR ALL USING has_role(uid,'manager')` with no `WITH CHECK` and no predicate on the target row. Postgres reuses `USING` as the check and `USING` never inspects `NEW.role`, so despite its name any manager could `POST /rest/v1/user_roles {user_id:<self>, role:'admin'}` directly to PostgREST with the publishable key that ships in the bundle. `trg_admin_grant_all_roles` then granted every remaining role. The edge function's guard was app-layer only and entirely bypassed. | Policy dropped (`20260909000000`). All role mutations already go through the edge function on the service role, which restricts managers to `pending_agent`/`prediction_agent`. Verified: a real manager JWT now gets `42501` on that insert. |
| **H3** | HIGH | **Customer PII readable by any login.** `personal_list_holds` (holding `customer_phone` NOT NULL, `customer_name`) had `USING (auth.uid() IS NOT NULL AND status='active' …)` — the exact shape the 2026-07-11 and 2026-07-22 lockdown sweeps existed to remove, missed by both. Any authenticated account, including an external affiliate, could page the active-hold book. | All three policies now require `is_internal_staff(auth.uid())` (`20260909000000`). No staff impact — the predicate is true for every non-affiliate role, so the agent queue still reads it. |
| **H4** | HIGH | **Public signup was enabled.** Live `GET /auth/v1/settings` returned `"disable_signup": false`. With the publishable key in the client bundle, anyone could self-register into `authenticated` — precisely the trust level H3 and L2 hand data to. This is dashboard state, not repo state, which is why nobody saw it: `docs/SECURITY.md` documents the **Bulgarian** project's auth config, not this one. | `disable_signup: true` via the Management API, scripted as `scripts/disable-signup-mk.mjs` so it is repeatable and reviewable. Admin-API user creation is unaffected. |
| **M1** | MED | **Managers could read `affiliates.api_key`.** The edge function masks the key for non-admins, but RLS grants managers `FOR ALL` on the table and RLS cannot hide a column. A manager could `GET /rest/v1/affiliates?select=code,api_key` and collect every partner's key. | Table-level `SELECT` revoked from `anon`/`authenticated` and re-granted as an explicit column list excluding `api_key`. (`REVOKE SELECT(col)` cannot carve a column out of a table grant — the grant has to be replaced.) Safe because no `src/` code reads the table directly; all reads go through the function on the service role. |
| **M2** | MED | **CORS allowlist was wrong in both directions.** The legacy alias `elyon-macedonia.vercel.app` — documented in CLAUDE.md as still in use — was absent, so anyone on that URL got every API call CORS-blocked with no error surfaced. Meanwhile `elyon-mk.com` and its `www` were listed but **we do not own that domain**: whoever registered it would gain a credentialed cross-origin channel. | Legacy alias added, placeholders removed. |
| **M8** | MED | **Admin and manager logins were never recorded.** `check-login` returns `bypass:true` for them and the client only writes `shift_login_logs` on the non-bypass branch — so agents had a full login trail and the highest-privilege accounts had none. `audit_log` has no `auth.*` actions either. | New `admin_login_logs` table (`20260909000100`), written server-side in the bypass branch so it cannot be skipped by calling the auth endpoint directly. Admin-read-only; a separate table because `shift_login_logs` requires a shift, which an admin login has no concept of. |
| **L1** | LOW | **Webhook slug enumeration oracle.** The `webhooks` row was fetched and 404/403 returned *before* signature verification, letting an unauthenticated caller distinguish valid / disabled / nonexistent slugs by status code and so map the product catalogue and live landing pages. | Signature verified first; every unauthenticated request now gets an identical 401. |
| **L6** | LOW | Service-role-only tables (`affiliate_postbacks`, `leaderboard_*`, `call_recordings`, `prediction_segment_members_shadow`) relied on RLS-with-no-policies alone and still carried PostgREST grants — so any future `CREATE POLICY` would silently re-open them. This is how the anon-readable backup-table incident happened. | `REVOKE ALL … FROM PUBLIC, anon, authenticated`, matching the belt-and-braces pattern already used by `order_unpaid_alerts`. |
| **M6** | MED | **No HTTP security headers.** `vercel.json` set only `Cache-Control`. No CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. The app was framable (clickjacking), and because the Supabase session lives in `localStorage`, any XSS or hostile npm dependency yielded a full refreshable token. | Full header block added to `vercel.json` — see the CSP notes below. |
| **M10** | MED | The webhook skill documented **fail-open** behaviour ("if the secret is unset the function logs a warning and accepts unsigned requests") when the code fails **closed**. A maintainer trusting the doc would "fix" a bug that does not exist, plausibly by reintroducing fail-open. | Skill corrected. |

### CSP notes (why the policy looks the way it does)

- `script-src 'self'` with no `'unsafe-inline'` and no hashes: the one inline script — the pre-paint
  theme switch — was moved to `public/theme-init.js`. **Do not reintroduce inline `<script>`
  blocks**; the build otherwise produces none.
- `style-src` needs `'unsafe-inline'`: Radix/shadcn inject element styles at runtime. This is the
  standard concession for this stack and is far lower risk than relaxing `script-src`.
- `fonts.googleapis.com` serves the `@import` in `src/index.css`; the font files come from
  `fonts.gstatic.com`.
- `connect-src` lists the Supabase host over **both** `https:` and `wss:` — Realtime uses a
  websocket. `blob:` appears in `img-src`/`media-src`/`worker-src` for CSV and recording downloads.
- **If a custom production domain or a second Supabase project is ever added, `connect-src` must be
  updated** or every API call will fail silently in the browser.

### Accepted risk (operator decision, 2026-08-04)

| ID | Sev | Finding |
|----|-----|---------|
| **H2** | HIGH | **Live admin password committed to git.** `scripts/create-superadmin-mile.mjs` carries `mile@elyon.com`'s password as a plaintext constant, and because the script resets the password on every run, that constant *is* the current credential. `scripts/create-admin-users.mjs`, `create-agents-2026-05.mjs` and `create-test-agent.mjs` carry the bootstrap password `12345678`, which is repeated in `RESUME.md`, `deploy-kit/04-SEED-AND-BOOTSTRAP.md`, `docs/IMPORT_EXPORT.md`, `docs/SECURITY.md` and `docs/AUDIT_FINDINGS.md`. The operator has chosen to leave this as-is for now. **Recommended when convenient:** rotate the affected logins, then change the scripts to read passwords from an argument or environment variable (`scripts/create-user-mk.mjs`, added today, already does). Note that rotation alone does not remove the old values from git history. |

The two accounts created today (`hedi@`, `dragana@`) use the operator-supplied password `12345678`.
It satisfies both gates (GoTrue's minimum of 6, the API's zod minimum of 8) but is weak; rotating it
after first login is advisable, especially as `naturatherapy.mk` is a real domain, so password-reset
mail would genuinely be delivered.

### Deferred — known, not yet addressed

| ID | Sev | Finding | Why deferred |
|----|-----|---------|--------------|
| M3 | MED | **No webhook replay protection.** The HMAC covers the body only — no timestamp, no nonce. A captured signed request replays forever, producing duplicate leads and orders. | Needs a coordinated change to every landing page, the OpenCart bridge and the PBX hooks. A project, not a quick win. |
| M4 | MED | **Rate limiting is in-memory per isolate** (`Map`), so it resets on cold start and does not coordinate across instances. There is no application-level login throttle beyond Supabase's own, and CAPTCHA is deliberately absent. | Needs a Postgres counter or Upstash. |
| M5 | MED | **SSRF guard is string matching only.** `isSafePostbackUrl` rejects literal `localhost`/RFC1918 prefixes but never resolves DNS, and misses IPv6 (`[::]`, `fc00::/7`), CGNAT `100.64.0.0/10`, decimal/octal IPv4 (`http://2130706433/`) and `*.internal`. Affiliates set their own `postback_url`, so an external partner controls a URL the function fetches from inside Supabase's network. | Worth doing soon; no affiliates exist yet (`affiliates = 0`), so exposure is currently nil. |
| M7 | MED | **Shift-hours restriction is client-side only.** `signIn()` completes and persists a JWT *first*; the shift check runs after and the browser calls `signOut()` on denial. Anyone who keeps the token, or calls `/auth/v1/token` directly, has a valid session outside their shift. `blocked_login_attempts` records the attempt but nothing is actually blocked. | Needs either a short-lived token exchange or a per-request shift re-check for agent roles. Cannot be fixed client-side. |
| M9 | MED | **Bulgarian infrastructure hardcoded — and it is NOT dormant.** `REC_HOST` and `HEALTH_HOST` both point at `pbx.elyoncall.com`, and the `+359` caller-ID defaults remain. **Confirmed live on 2026-08-04:** logging into the Macedonian CRM as an admin fires `GET /api/voip/health`, which calls out to the *Bulgarian* PBX and returns **HTTP 500** twice per login. So the MK deployment is already making runtime requests to Bulgarian infrastructure, contradicting "shares nothing at runtime with Bulgaria", and every admin sees a broken health widget. (The calls are outbound GETs to a PHP endpoint — they do not write to the Bulgarian database, so the golden rule is not breached.) | Not fixed here; it needs the MK telephony decision. Two options in the meantime: hide the widget while `VITE_USE_REAL_VOIP=false`, or make the host env-driven and unset it. Must be resolved before Phase 2 ships. |
| L2 | LOW | Any authenticated login can insert a `notifications` row addressed to itself. | Low impact; noted for the next RLS pass. |
| L3 | LOW | The leaderboard token travels in the query string (browser history, `Referer`, proxy logs) and the response contains agent full names. No expiry or rotation policy. | Needs a token-rotation story. |
| L4 | LOW | `PermissionsContext` hardcodes `calls`/`missed_calls` access for any role with ≥1 role, so `warehouse` and `ads_admin` see call surfaces never granted to them. The code comment says to remove it once the seed migration lands. | Remove together with seeding `module_settings`. |
| L5 | LOW | Several policies are `FOR ALL TO public`. Predicates gate on `has_role()` so `anon` is excluded in practice, but it is inconsistent with the stated "never `public`" rule. | Cosmetic; fold into the next sweep. |
| L7 | LOW | **No MFA anywhere**, and no re-authentication before privileged actions (user create/delete, role grant, key rotation, payout void). | Product decision — MFA is available on the project (`mfa_totp_enroll_enabled: true`) but unused. |
| L8 | LOW | CI runs build + tests but **no lint**; `docs/AUDIT_FINDINGS.md` records 643 outstanding lint errors. Not a vulnerability, but it is why type-level auth bugs survive review. | — |

### Recommended next project

**An RLS conformance test in CI.** Three separate lockdown sweeps (2026-05-06, 2026-07-11,
2026-07-22) each found tables the previous one missed, and this audit still found two more (H3, L2).
A job that connects as `anon`, as a synthetic `affiliate` and as a synthetic `agent`, then asserts a
denial on every table in `information_schema` not on an explicit allowlist, is the only thing that
stops this class of bug recurring. Everything else here is a point fix.

Also worth pinning: add a full `[auth]` block to `supabase/config.toml` (`enable_signup = false`,
`minimum_password_length`, MFA, session timeouts) so the posture is reviewable in a pull request
instead of living invisibly in dashboard state — which is exactly how H4 went unnoticed.

---

## Verification performed

All checks below were run against the live project after the fixes.

| Check | Result |
|---|---|
| Manager JWT → `POST /rest/v1/user_roles {role:'admin'}` | `403` / `42501` RLS violation |
| Manager JWT → `GET /affiliates?select=code,api_key` | `403` permission denied |
| Manager JWT → `GET /affiliates?select=code,name,status` | `200` (legitimate reads unaffected) |
| Manager JWT → `personal_list_holds`, `products` | `200` (internal staff still pass) |
| Manager JWT → all five L6 tables | `403` permission denied on each |
| `GET /auth/v1/settings` | `disable_signup: true` |
| OPTIONS from `elyon-natura` / `elyon-macedonia` | allowed |
| OPTIONS from `elyon-mk.com` / an unknown origin | no `Access-Control-Allow-Origin` |
| Unsigned `POST /webhook/<any slug>` | uniform `401`, real and fake slugs indistinguishable |
| Login as `mile@`, `hedi@`, `dragana@` | all succeed; `admin_login_logs` rows written |
| `node scripts/engine-fixture-mk.mjs` | segment engine ⇄ list-name contract intact |
