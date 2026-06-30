# Elyon CRM — Grok Skills System

This directory contains **project-specific skills** for Grok (and compatible agents).

These skills encode the hard-won operational wisdom of running this Bulgarian call-centre CRM. They are the single best way to stop repeating the same complex explanations every session.

## How Skills Work Here

- Skills live in this folder (repo-scoped, version controlled).
- Each skill is a directory with a `SKILL.md` file.
- Grok automatically discovers them with high priority when working inside this repository.
- Use `/skills` in the TUI to list or inject a specific skill.
- Good skills are **automatically invoked** when your prompt matches their `description`.

## Current Skills (as of May 2026)

| Skill | When to Use | Sacred Area |
|-------|-------------|-------------|
| `elyon-currency` | Any price, money, totals, stock value, revenue | The 1.95583 BGN/EUR peg |
| `elyon-phone-normalization` | Any phone search, lookup, import, or matching | Last-8-digits rule + E.164 |
| `elyon-fulfilment-csv` | Daily warehouse export, status flips on export | Exact comma/no-BOM format + business rules |
| `elyon-warehouse-incoming` | Warehouse tabs, bulk actions, ship_after_date logic | The daily operational heartbeat |
| `elyon-webhook-and-lead-ingestion` | New websites, landing pages, debugging missing leads | HMAC + per-product webhooks |
| `elyon-stock-and-bigarena` | Stock movements, BigArena imports, reconciliation | Historical operator decisions on SKUs/barcodes |
| `elyon-voip-and-pbx` | Telephony, SIP trunk, Asterisk, FreePBX, softphone swap, recordings, **A1 trunk connection** | The long-term real call infrastructure (significantly strengthened May 2026) |
| `elyon-segments-and-prediction` | Prediction lists, segments, recompute, bulk assign, Assigner | The intelligent lead distribution engine |
| `elyon-security` | Authentication, RLS, webhook HMAC, permissions, audit, CORS, secrets | Protecting data and operational integrity |
| `elyon-assigner` | Assigner page, bulk assignment, per-agent inspector, unassign rules, workload management | Lead distribution and agent workload fairness |
| `elyon-agent-commissions` | Agent bonus/commission/payout math, attribution, who gets credited | Per-package pay; one first-confirming agent; super-admins earn nothing |
| `elyon-logistics-costs` | Shipping/return/courier cost, Pure Profit actuals, courier rate card | Per-courier+service rates; full round-trip return loss; cash-basis profit |

## Best Practice for Future Work

**At the beginning of any significant task, especially if it touches one of the areas above:**

1. Run `/skills` to see what is available.
2. If a relevant skill exists, inject it (e.g. `/skills elyon-voip-and-pbx`).
3. Follow the skill's instructions strictly.

The goal of this system is to make future work dramatically faster, safer, and more consistent — especially on the complex, high-stakes parts of the CRM.

## Adding New Skills

When you find yourself explaining the same domain rule or workflow multiple times, capture it as a new skill using `/skillify` (or `/create-skill`).

Prefer project scope (`<repo_root>/.grok/skills/`) so the whole team benefits.

## Memory Connection

Many of these skills are also excellent candidates for long-term memory entries (via `/flush` and `/dream`).

Together, skills + memory + this `Claude.md` form the "Elyon Agent Operating System".

---

**This setup was created and significantly strengthened in May 2026 to make the partnership between the human operator and Grok as powerful and low-friction as possible for the long term.**