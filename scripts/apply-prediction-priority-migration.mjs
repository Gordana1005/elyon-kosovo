#!/usr/bin/env node
/**
 * apply-prediction-priority-migration.mjs
 *
 * Post-migration cleanup + verification script for the 2026-05-28 priority + 21-day floor change.
 *
 * What it does:
 *   1. Reports current state (total memberships vs distinct phones, top duplicates).
 *   2. For every phone that has 2+ *rule-driven* (non-static) members:
 *        - Picks the single "best" list using the new priority logic (lower priority wins,
 *          then higher trigger_price, then more recent).
 *        - Merges the best possible assigned_agent / is_completed / in_call_again state
 *          from any of the old rows for that phone.
 *        - Deletes the loser rows.
 *   3. Backfills avg_package_price on remaining members.
 *   4. Final strong assertions:
 *        - Zero phones with >1 non-static member.
 *        - 21-day floor is conceptually respected (we don't auto-remove recent ones here;
 *          the new recompute fn will do it on next event or full recompute).
 *   5. Prints a clear "next steps" block (run full recompute in UI, re-verify, brief agents).
 *
 * Usage (after the new migration has been applied):
 *   SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_URL=... node scripts/apply-prediction-priority-migration.mjs
 *
 * Safe: only touches prediction_segment_members for non-static lists. Static lists (Cancelled Pendings etc.) are left alone.
 * Idempotent: running twice is harmless.
 *
 * This is the "phase 2" artifact from the approved prediction segments redesign plan.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log('=== Prediction Segments Priority Migration Cleanup ===\n');

async function getLists() {
  const { data, error } = await supabase
    .from('prediction_segment_lists')
    .select('id, name, category, priority, is_static, display_order')
    .order('priority', { ascending: true })
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function main() {
  const lists = await getLists();
  const ruleDrivenLists = lists.filter(l => !l.is_static);
  const listById = new Map(lists.map(l => [l.id, l]));

  console.log(`Total lists: ${lists.length} (rule-driven: ${ruleDrivenLists.length})`);

  // 1. Current overlap report
  const { data: allMembers, error: membersErr } = await supabase
    .from('prediction_segment_members')
    .select('list_id, customer_phone, assigned_agent_id, is_completed, in_call_again_until, last_call_at, trigger_price, paid_count, lifetime_value, trigger_event_at');
  if (membersErr) throw membersErr;

  const byPhone = new Map();
  for (const m of allMembers) {
    const l = listById.get(m.list_id);
    if (!l || l.is_static) continue; // ignore static for overlap counting
    if (!byPhone.has(m.customer_phone)) byPhone.set(m.customer_phone, []);
    byPhone.get(m.customer_phone).push({ ...m, list: l });
  }

  let dupPhones = 0;
  let maxDups = 0;
  for (const [phone, rows] of byPhone) {
    if (rows.length > 1) {
      dupPhones++;
      maxDups = Math.max(maxDups, rows.length);
    }
  }

  console.log(`\nBefore cleanup:`);
  console.log(`  Total rule-driven memberships: ${allMembers.filter(m => !listById.get(m.list_id)?.is_static).length}`);
  console.log(`  Distinct phones with rule-driven members: ${byPhone.size}`);
  console.log(`  Phones with 2+ lists: ${dupPhones} (max dups on one phone: ${maxDups})`);

  if (dupPhones === 0) {
    console.log('\n✓ Already clean — no action needed. Still running final verification...');
  } else {
    console.log(`\nCleaning ${dupPhones} duplicate phones...`);
  }

  // 2. Collapse duplicates
  let collapsed = 0;
  let keptWithAssignment = 0;

  for (const [phone, rows] of byPhone) {
    if (rows.length <= 1) continue;

    // Pick winner: lowest priority, then highest trigger_price, then lowest recency_days (most recent)
    rows.sort((a, b) => {
      const pa = a.list.priority ?? 999;
      const pb = b.list.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const ta = Number(a.trigger_price) || 0;
      const tb = Number(b.trigger_price) || 0;
      if (ta !== tb) return tb - ta;
      const ra = a.trigger_event_at ? (Date.now() - new Date(a.trigger_event_at).getTime()) : Infinity;
      const rb = b.trigger_event_at ? (Date.now() - new Date(b.trigger_event_at).getTime()) : Infinity;
      return ra - rb;
    });

    const winner = rows[0];
    const losers = rows.slice(1);

    // Merge best state (prefer any row that has an active assignment or recent call)
    let bestAssigned = null;
    let bestCompleted = false;
    let bestInCallAgain = null;
    let bestLastCall = null;

    for (const r of rows) {
      if (r.assigned_agent_id && (!bestAssigned || (r.last_call_at && (!bestLastCall || new Date(r.last_call_at) > new Date(bestLastCall))))) {
        bestAssigned = r.assigned_agent_id;
        bestLastCall = r.last_call_at;
      }
      if (r.in_call_again_until && (!bestInCallAgain || new Date(r.in_call_again_until) > new Date(bestInCallAgain))) {
        bestInCallAgain = r.in_call_again_until;
      }
      if (r.is_completed) bestCompleted = true; // once completed anywhere, treat as completed
    }

    // Delete losers
    const loserIds = losers.map(r => r.list_id);
    const { error: delErr } = await supabase
      .from('prediction_segment_members')
      .delete()
      .eq('customer_phone', phone)
      .in('list_id', loserIds);
    if (delErr) {
      console.error(`  ERROR deleting losers for ${phone}:`, delErr.message);
      continue;
    }

    // Update winner with merged state (if it changed anything useful)
    const update = {};
    if (bestAssigned) update.assigned_agent_id = bestAssigned;
    if (bestInCallAgain) update.in_call_again_until = bestInCallAgain;
    if (bestCompleted) update.is_completed = true;
    if (Object.keys(update).length > 0) {
      await supabase
        .from('prediction_segment_members')
        .update(update)
        .eq('list_id', winner.list_id)
        .eq('customer_phone', phone);
    }

    // Backfill avg on the winner
    const avg = winner.paid_count > 0 ? (Number(winner.lifetime_value) || 0) / winner.paid_count : null;
    await supabase
      .from('prediction_segment_members')
      .update({ avg_package_price: avg })
      .eq('list_id', winner.list_id)
      .eq('customer_phone', phone);

    collapsed++;
    if (bestAssigned) keptWithAssignment++;
  }

  if (dupPhones > 0) {
    console.log(`\nCollapsed ${collapsed} phones. Preserved assignments on ${keptWithAssignment} of them.`);
  }

  // 3. Global avg backfill for any remaining rows that are missing it
  const { data: missingAvg } = await supabase
    .from('prediction_segment_members')
    .select('list_id, customer_phone, paid_count, lifetime_value')
    .is('avg_package_price', null)
    .limit(5000);

  let avgFixed = 0;
  for (const row of (missingAvg || [])) {
    const avg = row.paid_count > 0 ? (Number(row.lifetime_value) || 0) / row.paid_count : null;
    await supabase
      .from('prediction_segment_members')
      .update({ avg_package_price: avg })
      .eq('list_id', row.list_id)
      .eq('customer_phone', row.customer_phone);
    avgFixed++;
  }
  if (avgFixed > 0) console.log(`Backfilled avg_package_price on ${avgFixed} additional members.`);

  // 4. Final verification
  const { data: afterMembers } = await supabase
    .from('prediction_segment_members')
    .select('list_id, customer_phone');

  const afterByPhone = new Map();
  for (const m of (afterMembers || [])) {
    const l = listById.get(m.list_id);
    if (!l || l.is_static) continue;
    if (!afterByPhone.has(m.customer_phone)) afterByPhone.set(m.customer_phone, 0);
    afterByPhone.set(m.customer_phone, afterByPhone.get(m.customer_phone) + 1);
  }

  let stillBad = 0;
  for (const [phone, count] of afterByPhone) {
    if (count > 1) stillBad++;
  }

  console.log(`\nAfter cleanup:`);
  console.log(`  Rule-driven memberships: ${afterMembers.filter(m => !listById.get(m.list_id)?.is_static).length}`);
  console.log(`  Distinct phones: ${afterByPhone.size}`);
  console.log(`  Phones with >1 list: ${stillBad}`);

  if (stillBad === 0) {
    console.log('\n✅ SUCCESS — Zero duplicate phones in rule-driven prediction lists.');
  } else {
    console.log(`\n⚠️  WARNING — ${stillBad} phones still have multiple rule-driven lists. Manual review recommended.`);
  }

  // 5. Next steps for the operator
  console.log(`
Next steps (follow the approved plan):
  1. In the admin UI go to Prediction Lists → click "Recompute all segments" (or call the RPC).
     This makes the new 21-day floor + priority logic apply to *future* order events immediately.
  2. Re-run this script + verify-segments.mjs to confirm everything is still clean.
  3. Spot-check a few recent paid customers (< 21 days) — they should no longer be in value/prestige lists.
  4. Brief prediction agents + managers: "Queues are now duplicate-free and respect a 21-day cooling-off after purchase."
  5. (Optional but recommended) Update the two skills docs and DATABASE.md with the new reality.

The prediction system is now dramatically better for the people who actually make the calls.
`);

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});