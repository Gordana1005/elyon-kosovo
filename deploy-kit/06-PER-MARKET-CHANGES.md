# 06 — The master Bulgaria → Kosovo change list

Every value that is **Bulgaria-specific** and must change for Kosovo, with the exact file and
line. The good news from the codebase audit: these are **isolated to ~10-15 files**. The core
order/customer/call/segment logic is market-neutral and needs no changes.

Make these edits **in the fork only**. Group A is needed for a correct Phase-1 launch;
Group B is telephony (Phase 2 — see [07](07-TELEPHONY-LATER.md)); Group C is data, handled in
[04](04-SEED-AND-BOOTSTRAP.md).

> Tip: after editing, grep the fork for the old values to catch stragglers:
> `1.95583`, `359`, `Europe/Sofia`, `elyoncall.com`, `elyoncrm.local`, `Speedy`, `Econt`.

---

## Group A — needed for Phase 1 (CRM correctness)

### A1. Currency — drop the lev peg (Kosovo uses EUR natively)
Bulgaria stores prices in EUR and displays EUR **+** lev via a fixed 1.95583 peg. Kosovo is
euro-only, so the dual display should collapse to EUR.

- File: [`../src/lib/currency.ts`](../src/lib/currency.ts)
  - `BGN_PER_EUR = 1.95583` (line 5) — peg
  - `formatLev`, `formatPriceInline` (lines 23, 26-27) — the "… лв" second line
- **Change:** make `formatLev`/`formatPriceInline` return EUR-only (or make `formatPriceInline`
  just call `formatEur`). Leaving the peg constant in place is harmless if nothing calls the
  lev formatters — simplest is to neutralize the formatters so the UI shows only `€`.
- Rule context: [`../.grok/skills/elyon-currency/SKILL.md`](../.grok/skills/elyon-currency/SKILL.md).

### A2. Timezone — `Europe/Sofia` (UTC+2) → `Europe/Belgrade` (Pristina, UTC+1)
The 1-hour difference matters for any "midnight" day-boundary (daily bonus, leaderboard, daily
activity). Search and replace across the fork:

- Known spots (search `Europe/Sofia`):
  [`../src/lib/api.ts`](../src/lib/api.ts),
  [`../src/components/activity/AgentTimeline.tsx`](../src/components/activity/AgentTimeline.tsx),
  [`../src/components/insights/CallActivityTimeline.tsx`](../src/components/insights/CallActivityTimeline.tsx),
  and any `*Sofia*` display strings (e.g. PredictionEngineTab) + the Edge Function.
- Also re-grep `supabase/functions/api/index.ts` for `Sofia` and time math.
- **Change every `Europe/Sofia` → `Europe/Belgrade`.** (Kosovo/Pristina has no own IANA zone;
  it follows Belgrade = CET/CEST.)

> The pg_cron recompute schedule is in UTC and can stay — only the *human-facing* day boundary
> needs the Kosovo zone.

### A3. Phone country code — +359 → +383
Storage/search is last-8-digits + E.164; the **default country code** for inbound/normalized
numbers is the Bulgarian one.

- The frontend `normalizePhone` ([`../src/lib/validation.ts:4`](../src/lib/validation.ts#L4)) is
  already country-agnostic (just strips junk) — no change.
- The **country-code assumption** lives server-side / in ingestion. Check:
  - [`../supabase/functions/api/index.ts:1303`](../supabase/functions/api/index.ts#L1303) —
    `hasFullPhone` assumes "+359 + 8-9 digits" (≥11). Kosovo +383 mobile lengths differ;
    re-check this digit threshold.
  - Webhook/lead normalization that prepends a default country code → make it `+383`.
- Authority on the rules: [`../.grok/skills/elyon-phone-normalization/SKILL.md`](../.grok/skills/elyon-phone-normalization/SKILL.md).
- Note: any genuinely foreign numbers (the system intentionally leaves non-local numbers alone)
  keep their own prefix.

### A4. Login email domain
- File: [`../src/pages/LoginPage.tsx:11`](../src/pages/LoginPage.tsx#L11) —
  `const EMAIL_DOMAIN = 'elyoncrm.local';`
- **Change** to your Kosovo convention (e.g. `'elyon-xk.local'`). Must match the emails you
  create in [`create-admin-users.mjs`](../scripts/create-admin-users.mjs) (step 1 of [04](04-SEED-AND-BOOTSTRAP.md)).

### A5. Default UI language → Albanian (recommended)
- File: [`../src/i18n/index.ts:32`](../src/i18n/index.ts#L32) — `storedLanguage()` falls back to
  `'en'`. Change the fallback to `'sq'` so a brand-new Kosovo user starts in Albanian.
- `sq` is already a supported language with full translations
  ([`../src/i18n/locales/sq.json`](../src/i18n/locales/sq.json)). Operator should review wording
  in-app. Rule: [`../.grok/skills/elyon-i18n/SKILL.md`](../.grok/skills/elyon-i18n/SKILL.md).

### A6. CORS allow-list (backend)
- File: [`../supabase/functions/api/index.ts:547`](../supabase/functions/api/index.ts#L547) —
  replace `https://elyoncall.com` / `https://www.elyoncall.com` with the Kosovo domain(s).
  (Full steps in [05](05-FRONTEND-DEPLOY.md).)

### A7. Couriers, settlements, address format (Kosovo-local)
- **Courier picker enum/labels:** [`../src/components/DeliveryMethodPicker.tsx`](../src/components/DeliveryMethodPicker.tsx)
  and the `delivery_type` values (`home` / `speedy_office` / `econt_office`) referenced in
  [`../src/lib/api.ts`](../src/lib/api.ts) and the Edge Function. Replace Speedy/Econt with the
  chosen Kosovo carrier(s).
- **Settlements / city DB:** the `bg_settlements` migration data → Kosovo cities (data step,
  [04](04-SEED-AND-BOOTSTRAP.md) §5).
- **Address parsing:** [`../src/lib/address.ts`](../src/lib/address.ts) parses Bulgarian Cyrillic
  markers (ул./бул./бл./вх./ет./ап.). Adapt for Albanian address conventions (or simplify to a
  free-text address for Phase 1).
- **Fulfilment CSV** format stays the same shape — keep
  [`../.grok/skills/elyon-fulfilment-csv/SKILL.md`](../.grok/skills/elyon-fulfilment-csv/SKILL.md);
  just confirm your Kosovo courier accepts that layout.

### A8. Webhook source label (cosmetic)
- The Edge Function defaults an inbound source label to `naturatherapy.bg`. Update to the
  Kosovo store/landing label (or leave — it's only a provenance tag). See [04](04-SEED-AND-BOOTSTRAP.md) §4.

---

## Group B — telephony (Phase 2 only; skip for launch)

These hold Bulgarian PBX/A1 values. Leave them until you do [07](07-TELEPHONY-LATER.md); with
`VITE_USE_REAL_VOIP=false` the dialer isn't shown.

| What | File:line | Bulgaria value |
|---|---|---|
| PBX WebSocket host/URL | [`../src/lib/voip/pbxConfig.ts:13`](../src/lib/voip/pbxConfig.ts#L13), [`:16`](../src/lib/voip/pbxConfig.ts#L16) | `pbx.elyoncall.com`, `wss://pbx.elyoncall.com/ws` |
| Fallback caller ID | [`../src/lib/voip/pbxConfig.ts:19`](../src/lib/voip/pbxConfig.ts#L19) | `+35924234100` |
| Real-VOIP switch | [`../src/lib/voip/pbxConfig.ts:22`](../src/lib/voip/pbxConfig.ts#L22) | `VITE_USE_REAL_VOIP` |
| PBX ws_url returned by backend | [`../supabase/functions/api/index.ts:1832`](../supabase/functions/api/index.ts#L1832) | `wss://pbx.elyoncall.com/ws` |
| Default caller IDs | [`:1834`](../supabase/functions/api/index.ts#L1834), [`:1838`](../supabase/functions/api/index.ts#L1838) | `+35924234100`, `+359882040529` |
| DID dropdown (caller-ID picker) | [`:2160-2179+`](../supabase/functions/api/index.ts#L2160) | the 20 Sofia/mobile DIDs |
| Recording host | [`:1852`](../supabase/functions/api/index.ts#L1852) | `https://pbx.elyoncall.com/elyon-rec.php` |
| Health host | [`:1978`](../supabase/functions/api/index.ts#L1978) | `https://pbx.elyoncall.com/elyon-health.php` |
| Also | `src/lib/voip/RealVoipEngine.ts` | several `pbx.elyoncall.com` references |

---

## Group C — data (not code; done in step 04)

Fresh customers/orders, Kosovo couriers + cities, new admin accounts, new `WEBHOOK_SECRET`.
See [04-SEED-AND-BOOTSTRAP.md](04-SEED-AND-BOOTSTRAP.md).

---

## Business rules to PRESERVE (do not "fix" these)

These skills encode how the system must behave; keep them intact (adapt only the market values
above):

- Phone normalization (last-8 search, E.164 storage) — [`elyon-phone-normalization`](../.grok/skills/elyon-phone-normalization/SKILL.md)
- Stock only moves on shipped/returned — [`elyon-stock-and-bigarena`](../.grok/skills/elyon-stock-and-bigarena/SKILL.md)
- Agent commissions (paid-only, tiered) — [`elyon-agent-commissions`](../.grok/skills/elyon-agent-commissions/SKILL.md)
- Webhook HMAC + fail-closed — [`elyon-webhook-and-lead-ingestion`](../.grok/skills/elyon-webhook-and-lead-ingestion/SKILL.md)
- RLS everywhere + 3-layer authz — [`elyon-security`](../.grok/skills/elyon-security/SKILL.md)
- Fulfilment CSV format — [`elyon-fulfilment-csv`](../.grok/skills/elyon-fulfilment-csv/SKILL.md)
- Segments/prediction engine — [`elyon-segments-and-prediction`](../.grok/skills/elyon-segments-and-prediction/SKILL.md)
- i18n (never hardcode UI text) — [`elyon-i18n`](../.grok/skills/elyon-i18n/SKILL.md)

➡ Next: [07-TELEPHONY-LATER.md](07-TELEPHONY-LATER.md)
