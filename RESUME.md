# Resume Guide — finishing the Supabase + Vercel handoff

Everything that could be automated is done:

- ✅ Lovable references removed (`lovable-tagger`, README boilerplate, og images, `tailwind.config.lov.json`)
- ✅ Repo re-init'd with proper `.gitignore` (no more `.env` leaks, no more `tsbuildinfo` in git)
- ✅ Branding: `index.html`, `package.json`, `README.md`
- ✅ `vercel.json` with SPA rewrites for client-side routing
- ✅ Supabase CLI installed as a dev dep (`npx supabase ...` works)
- ✅ Pushed to GitHub: **https://github.com/Gordana1005/elyoncrm** (private)
- ✅ Helper script ready: `scripts/create-admin-users.mjs`

The three steps below need a browser at some point and your Supabase database password — that's why they aren't automated.

---

## Step 1 — Create the new Supabase project (5 min, browser)

1. Go to https://supabase.com/dashboard → **New project**.
2. Pick your **organization**, name the project (e.g. `elyoncrm-prod`), pick a region close to your users, set a strong **database password** — **save this password somewhere safe**, you'll need it for `pg_dump` later.
3. Wait ~2 minutes for the project to provision.
4. From the project dashboard, copy these four values into a notepad (you'll paste them in a moment):
   - **Project ref** — the slug from the URL or Settings → General → Reference ID, e.g. `abcdwxyz`
   - **Project URL** — Settings → API → Project URL, e.g. `https://abcdwxyz.supabase.co`
   - **anon public key** — Settings → API → `anon` `public`
   - **service_role key** — Settings → API → `service_role` `secret` ← **do not paste this anywhere except your local terminal**

---

## Step 2 — Apply schema + deploy edge function (PowerShell, ~3 min)

Open a fresh PowerShell in `c:\Users\Mile\Desktop\elyoncrm`. Then:

```powershell
# 2a. Login to Supabase CLI (opens browser, one-time)
npx supabase login

# 2b. Link this folder to the new project
#     (replace <PROJECT_REF> with your new ref, e.g. abcdwxyz)
npx supabase link --project-ref <PROJECT_REF>
# When prompted, paste the database password you saved in Step 1.

# 2c. Apply all 35 migrations to the new database
#     This rebuilds: every table, RLS policy, function, trigger, enum.
npx supabase db push

# 2d. Deploy the edge function
npx supabase functions deploy api --no-verify-jwt
```

If `db push` complains about migrations being "out of order" or already applied, run `npx supabase migration repair --status reverted <timestamp>` for each one it lists, then retry.

---

## Step 3 — Update `.env` and create the 3 admin users (~2 min)

Edit `.env` in your editor and replace the three values with your new project's:

```
VITE_SUPABASE_PROJECT_ID="<PROJECT_REF>"
VITE_SUPABASE_URL="https://<PROJECT_REF>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<NEW_ANON_KEY>"
```

Also update `supabase/config.toml` line 1 to the new project ref.

Then create the 3 admin users in one shot:

```powershell
$env:SUPABASE_URL = "https://<PROJECT_REF>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<SERVICE_ROLE_KEY>"
node scripts/create-admin-users.mjs
```

This creates:

| Email | Password | Role |
|---|---|---|
| `mile.stoev@elyoncrm.local` | `12345678` | admin |
| `miki.mitrov@elyoncrm.local` | `12345678` | admin |
| `tome.donchev@elyoncrm.local` | `12345678` | admin |

> **The `.local` domain is a placeholder** — Supabase doesn't send any emails since `email_confirm=true` is set. If you want password-reset emails to work later, you'll need to swap each email for a real one (you can do that from `/users` once the app is live, or via the Supabase dashboard).

> **Change passwords before production use.** `12345678` was your request for the bootstrap; rotate them as soon as everyone has logged in once.

---

## Step 4 — Verify locally before deploying

```powershell
npm run dev
```

Open http://localhost:8080, login as `mile.stoev@elyoncrm.local` / `12345678`. You should land on the dashboard with full admin access. Check `/users` and `/settings` — the 3 admin users should be visible, and the role/permission settings (which are seeded by migrations) should match what you had before.

---

## Step 5 — Deploy to Vercel (~5 min)

```powershell
# Link this folder to a new Vercel project (interactive — accept defaults)
vercel link

# Add the three env vars to the production environment
# (paste each value when prompted, keep the trailing newline empty)
vercel env add VITE_SUPABASE_PROJECT_ID production
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production

# Deploy to production
vercel --prod
```

After the first `vercel --prod`, every push to `main` on GitHub will auto-deploy.

---

## Step 6 — Final hardening to do before any real users

These were the **CRITICAL** and **HIGH** items from the audit. None of them block your demo, but all of them should land before the URL is shared:

- [ ] Add HMAC signature check to the public webhook endpoints (`supabase/functions/api/index.ts:182-262`)
- [ ] Lock CORS to your Vercel domain (replace `Access-Control-Allow-Origin: *`)
- [ ] Fix the `notifications` INSERT policy (currently `WITH CHECK (true)` — anyone can spam anyone)
- [ ] Restrict the four "config" tables (`module_settings`, `role_permissions`, `financial_visibility`, `lead_distribution_config`) to admin-only reads
- [ ] Code-split routes in `src/App.tsx` (every page currently ships in the main bundle)
- [ ] Set React Query defaults (`staleTime: 5 * 60_000`)

Want me to do any of those next? Just say the word.

---

## If anything goes wrong

| Problem | Fix |
|---|---|
| `supabase link` says "Wrong password" | The DB password is the one you set when creating the project, not your Supabase account password. Reset it at Settings → Database → Database password. |
| `supabase db push` shows migration ordering errors | Run `npx supabase migration repair --status reverted <timestamp>` for each problematic timestamp, then retry `db push`. |
| `node scripts/create-admin-users.mjs` returns 422 "User already registered" | The user exists from a previous run — delete them in Supabase dashboard → Authentication → Users, then rerun. |
| Vercel build fails with "VITE_SUPABASE_URL is undefined" | Env vars weren't saved. `vercel env ls` to confirm, redeploy with `vercel --prod`. |
| Login works but `/` redirects to `/login` immediately | The auth user has no row in `user_roles`. Re-run `create-admin-users.mjs` or insert manually in SQL editor. |

---

_Generated automatically while finishing the local cleanup. — see git log for the full picture._
