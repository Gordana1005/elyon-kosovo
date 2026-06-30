# Elyon CRM — KOSOVO edition (Natura Therapy XK)

This repository is the **Kosovo** instance of the Elyon CRM — a hard fork of the Bulgarian
system, run as a completely separate operation. It has its OWN infrastructure and shares
**nothing at runtime** with Bulgaria.

## 🛑 GOLDEN RULE — never touch the Bulgarian system
This is the #1 rule. A mistake here already caused a live Bulgarian outage once (2026-06-30).
**Bulgaria is OFF LIMITS.** Never run any command against, deploy to, or edit:
- Supabase project `sxymaloycddnoxudxaqp`
- Domains `elyoncall.com` / `www.elyoncall.com`
- The Bulgarian repo folder `C:\Users\Mile\Desktop\elyoncrm`
- The Bulgarian Vercel project `elyoncrm` (`prj_965V2iBg793RmiJJw9m6Tl3djllX`)

Everything here targets **Kosovo only** (see Infra below). If you ever see `sxymaloycddnoxudxaqp`
or `elyoncall.com` in a command you're about to run → **STOP.** That is the live BG system.

## ⚠️ CLI safety (this is how the BG incident happened — read it)
The shell's working directory **silently resets between tool calls**. NEVER rely on the current
directory to choose which project a command acts on. For ANY state-changing command, pass the
target **explicitly** and verify it before running:
- **Vercel:** `vercel <cmd> --cwd "C:\Users\Mile\Desktop\elyon-kosovo" --scope gordanas-projects-a53c0208`
- **Supabase:** confirm `supabase/config.toml` `project_id = "bmfxhgznttcnnlqloqzp"` before any link/push/deploy
- **Git:** `git -C "C:\Users\Mile\Desktop\elyon-kosovo" …`
- Read the tool's echoed target (e.g. "to Project X"); if it's ever `elyoncrm`/BG → abort immediately.
- **Vercel env vars:** prefer the Vercel REST API (JSON body) over `vercel env add` stdin — PowerShell
  piping injects a UTF-8 BOM ("non ISO-8859-1 code point" login error) and bash `printf` w/o newline
  sets empty. Always verify with `vercel env pull`.

## Infra (Kosovo only)
- **Supabase:** ref `bmfxhgznttcnnlqloqzp` → https://bmfxhgznttcnnlqloqzp.supabase.co
- **Vercel:** project `elyon-kosovo`, scope `gordanas-projects-a53c0208` → https://elyon-kosovo.vercel.app (GitHub-connected → auto-deploys on push to `main`)
- **GitHub:** `Gordana1005/elyon-kosovo`
- **Secrets:** `docs/VAULT.md` (gitignored) — keys, webhook secret, admin logins
- **Status / done / TODO:** `KOSOVO-FORK-STATUS.md` (repo root)

## Per-market rules (Kosovo ≠ Bulgaria) — these OVERRIDE the copied BG docs/skills
`.grok/skills/` and `docs/` were copied from Bulgaria and still describe BG specifics in places.
**Where they conflict with the list below, THIS LIST WINS** (and update the skill/doc):
- **Currency: EUR-only.** Kosovo is euro-native. NO lev, NO 1.95583 peg, NO dual display. `formatLev`/`formatPriceInline` are neutralized to EUR. (`elyon-currency` skill is updated for XK.)
- **Timezone:** `Europe/Belgrade` (Pristina, CET) — not Europe/Sofia.
- **Phone:** country code **+383** — not +359. Last-8 matching is unchanged.
- **Language:** default UI is Albanian (`sq`); en/bg kept as fallbacks.
- **Login email domain:** `elyon-xk.local` (placeholder — see TODO).
- **Couriers/cities:** still BG (Speedy/Econt + `bg_settlements`) — **TODO:** replace with Kosovo.
- **Telephony:** deferred (Phase 2). `VITE_USE_REAL_VOIP=false`; PBX/DID values are BG placeholders.
- Search the code for `TODO(kosovo)` to find every unfinished real-value spot.

## Skills system (`.grok/skills/`)
Same first-class skills system as BG — check `/skills` before non-trivial work on money, phones,
warehouse, stock, webhooks, or fulfilment. **But apply the Kosovo per-market overrides above** —
several skills still teach BG rules (lev peg, +359). When a skill conflicts with the overrides,
the overrides win; fix the skill. Add new skills with project scope.

## Memory
This Kosovo workspace has its OWN memory store, separate from Bulgaria. `MEMORY.md` is loaded each
session. Keep only Kosovo facts there; never write BG facts into this project's memory, and never
let a recalled BG fact send you to touch the BG system.

---
*Kosovo fork stood up 2026-06-30 from `deploy-kit/`. This file is the Kosovo constitution
(Claude.md + Skills + Memory = the Elyon Agent OS, Kosovo instance).*
