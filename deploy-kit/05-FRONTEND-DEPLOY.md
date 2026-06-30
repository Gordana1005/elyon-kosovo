# 05 — Frontend deploy (Vercel + domain)

Put the web app online and connect it to the new Kosovo backend.

Background: [../docs/FRONTEND.md](../docs/FRONTEND.md), build config in
[../vercel.json](../vercel.json).

---

## Step 1 — create the Vercel project

1. vercel.com → **Add New → Project** → import the `elyon-kosovo` GitHub repo.
2. Framework preset: **Vite** (auto-detected). The repo's [`../vercel.json`](../vercel.json)
   already sets build = `npm run build`, output = `dist/`, and the SPA rewrite — leave it.
3. If a Bulgarian `.vercel/` folder came along in the fork, delete it first so you don't link
   to the live project (see [02](02-FORK-THE-CODE.md)).

## Step 2 — set environment variables (Vercel → Project → Settings → Environment Variables)

These are the **new** Kosovo values (build-time; the anon key is public by design):

| Var | Value |
|---|---|
| `VITE_SUPABASE_PROJECT_ID` | `<NEW_KOSOVO_REF>` |
| `VITE_SUPABASE_URL` | `https://<NEW_KOSOVO_REF>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | new anon key |
| `VITE_USE_REAL_VOIP` | `false` *(Phase 1 — no dialer until telephony is set up)* |

Set them for **Production** (and Preview if you use it), then **Redeploy**.

## Step 3 — domain + DNS

1. Vercel → Project → **Domains** → add your Kosovo domain (e.g. `elyon-xk.com`).
2. At your registrar, point DNS to Vercel as instructed (A/CNAME records). TLS is automatic.

## Step 4 — CORS: let the backend accept the new domain

The backend only answers browsers from an **allow-list**. It currently lists the Bulgarian
domains at [`../supabase/functions/api/index.ts:547`](../supabase/functions/api/index.ts#L547):

```ts
"https://elyoncall.com",
"https://www.elyoncall.com",
```

In the fork, **replace those with the Kosovo domain(s)**:

```ts
"https://elyon-xk.com",
"https://www.elyon-xk.com",
```

Then redeploy the function (from [03](03-SUPABASE-FROM-ZERO.md)):

```bash
npx supabase functions deploy api --project-ref <NEW_KOSOVO_REF>
```

> If agents see network/CORS errors in the browser console after login, this list is almost
> always the cause.

## Step 5 — default language (optional but recommended for Kosovo)

New users with no saved preference currently default to English
([`../src/i18n/index.ts:32`](../src/i18n/index.ts#L32) returns `'en'`). For a Kosovo team you
may want **Albanian** as the out-of-box default — change that fallback to `'sq'`. Details in
[06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md).

---

## Step 6 — smoke test

1. Open the new domain → you should get the login page.
2. Log in as the admin from [04](04-SEED-AND-BOOTSTRAP.md).
3. You should see the dashboard, the imported products, and empty order lists.

✅ The CRM is live for Kosovo (minus telephony). Now make sure every market-specific value is
correct.

➡ Next: [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md)
