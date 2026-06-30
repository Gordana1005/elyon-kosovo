# Elyon CRM — Grok Agent Operating System

This directory contains the custom infrastructure that makes working with Grok on this project dramatically better over time.

## Components

- **skills/** — Domain-specific reusable expertise (currency, phones, warehouse, stock, webhooks, fulfilment CSV, VOIP/PBX, segments/prediction lists, etc.)
- **memory/** — Reference seed for persistent cross-session memory
- **agents/** — Reserved for future custom subagent roles/personas
- **AGENT_CONSTITUTION.md** — High-level trigger table for routing tasks to the right skills
- **config.toml** (global, in ~/.grok/) — Memory is enabled here

## How to Use Going Forward

1. **At the start of relevant work**, check skills:
   - Run `/skills` in the Grok TUI
   - Inject the relevant one (e.g. `/skills elyon-currency` or `/skills elyon-voip-and-pbx`)

2. **After good sessions**, capture knowledge:
   - Use `/flush`
   - Periodically run `/dream`

3. **Memory is now enabled** globally. The workspace memory for this project lives at:
   `C:\Users\Mile\.grok\memory\elyoncrm-elyon\MEMORY.md`

## Current Skills (May 2026)

- elyon-currency
- elyon-phone-normalization
- elyon-fulfilment-csv
- elyon-warehouse-incoming
- elyon-webhook-and-lead-ingestion
- elyon-stock-and-bigarena
- elyon-voip-and-pbx
- elyon-segments-and-prediction

## Why This Exists

This CRM has many "sacred" rules and complex operational workflows that are easy to get wrong. The skills + memory + enhanced `Claude.md` system ensures that Grok respects them consistently across months of work.

This setup was built in May 2026 to create a true long-term partnership between the human operator and the AI.

---

Run `scripts\seed-grok-memory.ps1` anytime you want to refresh the seed.