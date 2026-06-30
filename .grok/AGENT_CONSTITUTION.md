# Elyon CRM Agent Constitution (2026)

This is the high-level trigger table for routing work to the correct skills, memory, and sub-processes.

## Task → Recommended First Action

| If the task involves...                  | First Action                              | Primary Skill(s) to Load                                      | Memory Section |
|------------------------------------------|-------------------------------------------|---------------------------------------------------------------|----------------|
| Any money, price, total, revenue         | Check currency rules                      | `elyon-currency`                                              | Sacred Constants |
| Phone search, lookup, import, matching   | Normalize using last-8-digits             | `elyon-phone-normalization`                                   | Sacred Constants |
| Daily Fulfilment CSV or warehouse export | Respect exact format + business rules     | `elyon-fulfilment-csv`                                        | High-Risk Areas |
| Warehouse tabs, bulk shipping, stock     | Think about performance + stock safety    | `elyon-warehouse-incoming` + `elyon-stock-and-bigarena`       | High-Risk Areas |
| New landing page / webhook               | Understand per-product + HMAC model       | `elyon-webhook-and-lead-ingestion`                            | High-Risk Areas |
| Stock import or reconciliation           | Follow historical operator decisions      | `elyon-stock-and-bigarena`                                    | High-Risk Areas |
| Telephony, SIP, PBX, softphone, recordings, **A1 trunk connection** | Respect infrastructure & current status | `elyon-voip-and-pbx` (strengthened May 2026)                 | VOIP / PBX section |
| Prediction lists, segments, recompute, bulk assign | Protect membership integrity & recompute rules | `elyon-segments-and-prediction`                          | Segments section |
| Security, RLS, permissions, audit, secrets, CORS | Follow security model and least-privilege | `elyon-security`                                             | Security section |
| Assigner, bulk assignment, inspector, unassign rules | Fair distribution + workload visibility | `elyon-assigner`                                             | Assigner section |
| Big refactor or complex feature          | Consider using `/best-of-n`               | Relevant domain skills + best-of-n                            | N/A |

## Core Principles

1. Skills first on domain work.
2. Never break the sacred rules (currency peg, phone normalization, fulfilment format, stock discipline, etc.).
3. Use memory (`/flush`, `/dream`) to carry knowledge across sessions.
4. When in doubt on high-stakes operational changes, ask the human.
5. Keep the skills and this constitution up to date as the project evolves.

This constitution should be consulted at the beginning of any non-trivial piece of work.

---

Maintained as part of the Elyon Agent Operating System. Last updated with Security, Assigner, and strengthened VOIP skills: May 2026.