---
name: elyon-assigner
description: Use for anything related to the Assigner page, bulk assignment of pending orders and prediction list members, per-agent inspector, unassign rules (especially for pendings vs confirmed), cross-list baskets, round-robin distribution, and the logic that controls which agents see which leads. Critical for lead distribution and agent workload management. Post-2026 segments redesign: all prediction work now operates on unique phones (exclusive rule-driven membership).
---

# Elyon Assigner Skill

The Assigner is the control center for distributing work to agents. It combines unassigned pending orders with members from the intelligent prediction lists (segments) and gives managers powerful tools to assign them fairly and efficiently. After the 2026 prediction segments redesign (Option 1), **prediction member workloads are now clean by design** — every rule-driven phone appears in at most one list, eliminating the previous duplicate-calling frustration.

## Core Concepts

### Two Main Sources of Work
1. **Unassigned Pending Orders** — New leads that have not yet been assigned to an agent (classic flow, unaffected by segments redesign).
2. **Prediction List Members** — Customers automatically classified by the rule engine into the **single best** list (priority + 21-day floor + winner selection). These are the high-signal "smart" follow-up leads. **Post-redesign**: exclusively one active rule-driven list per phone.

### Key Screens
- **Main Assigner** — Overview of unassigned work + powerful bulk + auto-assign tools (including cross-list basket for prediction members).
- **Per-Agent Inspector** — Live view of exactly what any agent currently holds (pendings + their assigned prediction members from one or more lists). Granular unassign supported.
- **Cross-List Basket** — Advanced manager tool for selecting members across multiple prediction lists before bulk distribution. Still extremely useful — now works on inherently unique phones.

## Assignment Rules & Recent Changes (Important)

- **Pending orders** can be unassigned more freely (even after some work).
- **Confirmed / shipped orders** are protected (sales credit immutable except via superadmin correction).
- **Prediction list members** use dedicated flows (`apiAssignSegmentMembers`, `apiBulkUnassignSegment`, `apiAutoAssignSegment`).
- When unassigning a prediction member, it returns to the unassigned pool for that list (or will be re-evaluated on next order event).
- Bulk assign supports single agent or multi-agent round-robin (shuffled for fairness). Scope options: 'unassigned' (preserve existing) or 'all'.
- Auto-assign can take exact `limit` or `fraction` of a list.

**Post-2026 Redesign Impact (the big win)**:
- Prediction members assigned to agents are now guaranteed unique phones (the engine's priority pick-one + delete-siblings logic).
- No agent will ever see the same customer in two different prediction lists in their inspector or queue.
- Cross-list basket and multi-list inspector views remain powerful for managers but now operate on a deduplicated universe.
- `avg_package_price` (first-class, currency-formatted) is visible in the member tables used by the Assigner.

Recent broader improvements (May 2026 window):
- Granular unassign for both pendings and prediction members.
- Live inspector visibility.
- Sales credit protection.

## When This Skill Applies

- Working on AssignerPage, inspector, cross-list basket, or bulk flows
- Changing any assignment/unassignment logic (pending or prediction)
- Building distribution strategies or fairness algorithms
- Debugging "why does this agent have (or not have) this lead?"
- Bulk operations that move prediction members between agents
- Any change that affects agent workload visibility or the interaction between pending orders and prediction lists
- Post-redesign verification that prediction workloads are clean

## Important Files

- `src/pages/AssignerPage.tsx` (main logic, tabs, inspector, cross-list basket integration)
- `src/components/assigner/` folder (SegmentMemberTable — now with Avg / pkg dual-currency column, AgentPickerChips, CrossListBasketBar, etc.)
- API layer: `apiGetUnassignedPending`, `apiBulkAssignOrders`, `apiBulkUnassignOrders`, `apiGetSegment`, `apiAssignSegmentMembers`, `apiBulkUnassignSegment`, `apiAutoAssignSegment`, etc. (see src/lib/api.ts)
- Backend: `supabase/functions/api/index.ts` (assigner routes + segment member endpoints)
- Shared table component: `src/components/assigner/SegmentMemberTable.tsx` (used for both segment detail and Assigner inspector)
- Related prediction data layer: `src/components/calls/useMyQueue.ts`

**Companion skills (inject first)**: elyon-segments-and-prediction (the source of the now-exclusive members), elyon-currency (avg_package_price and all money in tables), elyon-phone-normalization (phone keys in all matching).

## Common Gotchas & Rules

- Do **not** assume unassigning always reverts to simple "pending". Some states (confirmed, etc.) are protected.
- Prediction memberships can (and do) change on recompute or order events — assignments are not permanent, but the engine now intelligently carries state to the winner list.
- The inspector + live counts are the ground truth for "where each agent is right now."
- Sales credit (`confirmed_by_agent_id`, `confirmed_by_name`) must be protected. Use the special superadmin Command picker flow for corrections only.
- **Post-redesign**: "Customer appears in multiple lists" is no longer a normal case for rule-driven prediction work. The engine guarantees exclusivity for calling/assignment.

## Decision Table (Post-2026 Redesign — Updated)

| Situation                                              | Correct Approach                                                                 | Avoid                                              |
|--------------------------------------------------------|----------------------------------------------------------------------------------|----------------------------------------------------|
| Agent has too many leads                               | Use inspector + granular unassign (prediction or pending)                        | Blind bulk unassign without live counts            |
| Want to distribute fairly across team                  | Multi-agent + round-robin in bulk/auto-assign (or fraction/limit for partial)    | One-by-one manual assignment                       |
| Customer appears in prediction lists (cross-list work) | The system now guarantees at most one active rule-driven list per phone. Cross-list basket remains powerful for managers but operates on unique phones only. | Assuming old multi-membership behavior for calling queues or inspector |
| Need to correct who confirmed an order                 | Special superadmin Command picker flow only                                      | Direct DB edit or normal OrderModal                |
| After changing segment rules or priorities             | Trigger recompute (UI does this on PATCH), run apply-prediction-priority-migration.mjs + verify scripts, then review inspector workloads and 21-day floor behavior | Assuming member counts or agent assignments stay identical |
| Agent complains about seeing the same customer twice   | Post-redesign this should be impossible for rule-driven lists. Verify via inspector + DB query on the phone + confirm a recent recompute ran. Escalate only if static list or personal hold involved. | Assuming the old duplicate problem still exists    |

## Best Practices

- Always use the per-agent inspector when an agent reports workload or duplicate issues (now the duplicate case should only surface pre-redesign data or static lists).
- Prefer the cross-list basket for sophisticated manager distribution across multiple high-priority segments — it now naturally works on deduplicated phones.
- After any bulk prediction operation, immediately refresh inspector views and have the affected agents refresh their Calls queues.
- When building new features or reports, preserve (and surface) the live "exactly what each agent holds right now" visibility.
- Surface `avg_package_price` (using elyon-currency dual formatting) in any new Assigner-adjacent tables or pickers — agents and managers love the high-frequency vs one-big-order signal.
- After segments redesign work, always verify that prediction agent workloads in the inspector are clean (no phone appears more than once across an agent's assigned lists).

This area directly affects agent morale, fairness perception, and conversion rates. Confusing or duplicative distribution is one of the fastest ways to damage trust and productivity.

When making changes here, always think from the perspective of both the manager doing the sophisticated assigning and the agent who must actually call the work — now with the massive quality-of-life win that the prediction engine itself prevents duplicates.

**Post-redesign, agent workloads for prediction lists are dramatically cleaner and higher-signal. The cross-list tools remain just as powerful but now operate in a deduplicated world. Preserve that cleanliness in every new flow.**