# 02 — Fork the code into `elyon-macedonia`

Goal: a **clean, standalone copy** of the app in its own GitHub repo, sharing nothing with the
live repo's history or remote. No secrets travel with it (they're all gitignored).

---

## Step 1 — get a clean copy

You want the **files**, not the live git history pointing at the live remote. Easiest is a
fresh clone, then detach it.

```bash
# 1. Clone the current repo into a NEW folder (a sibling of elyoncrm)
git clone https://github.com/Gordana1005/elyoncrm.git elyon-macedonia
cd elyon-macedonia

# 2. Detach from the Bulgarian remote so you can never push to it by accident
git remote remove origin

# 3. (Optional) start a clean history
rm -rf .git
git init
git add .
git commit -m "chore: fork Elyon CRM for Macedonia (Phase 1 baseline)"
```

> Alternatively just **copy the folder** (without `node_modules/`, `dist/`, `.git/`, `.vercel/`).
> The point is the same: a separate tree with no link back to live.

## Step 2 — point it at the new GitHub repo

```bash
git remote add origin https://github.com/<you>/elyon-macedonia.git
git push -u origin main
```

---

## What is safe — secrets do NOT travel

The live secrets are **not** in the code; they're in gitignored files, so a clone never
carries them. Confirmed in [`../.gitignore`](../.gitignore):

- `.env` and `.env.*` (except `.env.example`) — your local keys
- `docs/VAULT.md` — the credentials vault
- `.secrets/`, `.vercel/` — local key copies + Vercel link
- `dist/`, `node_modules/`

So a fresh clone starts with **no credentials**. You will create brand-new ones for Macedonia in
[03](03-SUPABASE-FROM-ZERO.md), [05](05-FRONTEND-DEPLOY.md), and [08](08-SECRETS-TEMPLATE.md).

### After cloning, double-check nothing leaked in
```bash
# Should print only .env.example
ls -a | grep -E '^\.env'
# Should NOT exist
ls docs/VAULT.md 2>/dev/null && echo "DELETE THIS — it's live secrets"
```
If `docs/VAULT.md` or a real `.env` somehow came along (e.g. you copied the folder manually),
**delete them** — they are Bulgaria's live credentials and must never live in the Macedonia repo.

---

## Step 3 — clean the live-only pointers

These files reference the **live** project. You'll overwrite them with Macedonia values in later
steps; just know they're here:

| File | Holds | Fixed in |
|---|---|---|
| `supabase/config.toml` | `project_id = "sxymaloycddnoxudxaqp"` | [03](03-SUPABASE-FROM-ZERO.md) |
| `.vercel/` (if present) | Bulgaria's Vercel link | delete; re-link in [05](05-FRONTEND-DEPLOY.md) |
| `vercel.json` | build config (generic — keep as-is) | no change |
| All market-specific code values | currency/timezone/phone/couriers | [06](06-PER-MARKET-CHANGES.md) |

---

## Step 4 — install and confirm it builds

```bash
npm install
npm run build      # should produce dist/ with no errors
```

A successful build here (before any Macedonia edits) proves the fork is intact. You'll wire it to
the new Supabase/Vercel next.

> Where the market-specific values live (currency, timezone, +359, couriers, PBX URLs) is
> documented once, with exact file paths, in
> [06-PER-MARKET-CHANGES.md](06-PER-MARKET-CHANGES.md). Don't change them yet — do the
> database first so you can test end-to-end.

➡ Next: [03-SUPABASE-FROM-ZERO.md](03-SUPABASE-FROM-ZERO.md)
