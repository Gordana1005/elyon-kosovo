# Elyon CRM

Call center & lead management platform built on React + Vite + Supabase.

## Tech stack

- **Frontend**: Vite, React 18, TypeScript, React Router 6, React Query, Tailwind, shadcn/ui
- **Backend**: Supabase (Postgres + Auth + Edge Functions on Deno)
- **Hosting**: Vercel (frontend), Supabase (backend)

## Local development

Prerequisites: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

The dev server runs on http://localhost:8080.

## Environment variables

Copy `.env.example` to `.env` and fill in your Supabase project values:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PROJECT_ID=<project-ref>
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

The anon key is safe to ship to the browser. The service role key must **never** appear in this file or in the frontend code — it lives only in the Supabase Edge Function environment.

## Working with Supabase

The project uses the Supabase CLI (installed locally as a dev dependency).

```bash
# Link this folder to your Supabase project
npx supabase link --project-ref <project-ref>

# Apply pending migrations
npx supabase db push

# Deploy the edge function
npx supabase functions deploy api --no-verify-jwt

# Generate TypeScript types from the live schema
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

## Project layout

```
src/
  pages/             # 26 routed pages (one per CRM area)
  components/        # Shared UI + shadcn/ui primitives
  contexts/          # AuthContext, PermissionsContext
  hooks/             # Custom React hooks
  integrations/      # Supabase client + generated DB types
  lib/               # API wrapper, utils, validation schemas
supabase/
  functions/api/     # Single edge function exposing the REST surface
  migrations/        # 35 forward-only Postgres migrations
  config.toml        # Project ref + function settings
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 8080 |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint over the codebase |
| `npm run test` | Run vitest once |
| `npm run preview` | Preview a production build locally |

## Deployment

Pushing to `main` deploys automatically to Vercel.
Edge function changes deploy via `npx supabase functions deploy api --no-verify-jwt`.
