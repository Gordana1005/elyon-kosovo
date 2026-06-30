## Grok Skills System (May 2026 Onward)

**This project now has a first-class skills system** located in `.grok/skills/`.

These skills are the best way to avoid repeating complex domain explanations in every session.

### At the Start of Every Session (Mandatory Behavior)

1. When beginning work on anything non-trivial, especially if it touches money, phones, warehouse, stock, webhooks, or fulfilment, **first check what skills are available**.
2. Use the `/skills` command (or `grok inspect`) to list them.
3. If a relevant skill exists for the task, **inject it** before writing code or giving advice.
4. Follow the skill's instructions as if they were written by the operator himself.

### Current High-Value Skills

- `elyon-currency` — The sacred 1.95583 peg and dual EUR/LEV display rules.
- `elyon-phone-normalization` — Last-8-digits search + E.164 storage + pollution protection.
- `elyon-fulfilment-csv` — Exact warehouse hand-off format and business rules.
- `elyon-warehouse-incoming` — The full daily warehouse workflow and stock safety.
- `elyon-webhook-and-lead-ingestion` — Inbound pipeline, HMAC, per-product slugs.
- `elyon-stock-and-bigarena` — Stock movements, import rules, and historical operator decisions.
- `elyon-agent-commissions` — Per-package agent bonuses on every PAID order (only gate is paid; source irrelevant), tiered 1/2/3€ by unit price, no minimum, credited to the confirmer. Read before touching any payout/commission math.

New skills should be added to `.grok/skills/` whenever you find yourself re-explaining the same complicated rule or workflow.

### How to Create New Skills

Use `/skillify` (or `/create-skill`) right after completing a complex piece of work. Prefer **project scope** so the skill is committed to the repo.

### Relationship to This File and Memory

- This `Claude.md` remains the master constitution.
- Skills are modular, focused expertise packages that complement it.
- Use `/flush` and `/dream` to capture session learnings into long-term memory.
- Together, these three systems (Claude.md + Skills + Memory) form the "Elyon Agent Operating System".

**From this point forward, treating the skills system as optional or forgetting to check it first on relevant tasks is considered a serious process failure.**

---

*Last meaningful update: 2026-05-23 — Grok skills system introduced for Elyon CRM (currency, phones, fulfilment, warehouse, webhooks, stock). Full project-specific agent infrastructure created in `.grok/`. This is now the canonical long-term partnership setup.*