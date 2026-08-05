# collabBox corrections

45,227 collabBox documents matched against 81,657 AlterCPA MK orders.
Window: AlterCPA date within `[collabBox date − 5d, collabBox date + 1d]`.

| | documents | share |
|---|---:|---:|
| tier A — exact name, one candidate | 3,582 | 7.9% |
| tier B — fuzzy name (one token exact), one candidate | 1,299 | 2.9% |
| weak — single-token name, amount did not corroborate → not applied | 582 | 1.3% |
| ambiguous — several candidates → not applied | 602 | 1.3% |
| no candidate in window | 39,162 | 86.6% |

**2,621 orders flip from cancelled/trash to paid.**
2,260 matched orders were already approved — no change, but they are the
evidence the matcher works: 46.3% of matches landed on an approved order against a
30.3% base rate (enrichment ×1.53). A matcher pairing people at random would show ×1.00.

## What this does not reach

- **LeadIn** — 36,814 documents found no AlterCPA counterpart.
- **LeadOut** — 3,532 documents found no AlterCPA counterpart.

collabBox records 45,227 paid orders; AlterCPA approves 24,766, and this pass
recovers 2,621 more. The remainder cannot be imported at all — the collabBox export
carries no phone and no product, and phone is the CRM's only customer identity.
Fixing that needs a collabBox re-export with those two columns.

Full row-by-row audit: `scripts/data/collabbox-corrections.csv` (semicolon-separated, UTF-8 BOM).
