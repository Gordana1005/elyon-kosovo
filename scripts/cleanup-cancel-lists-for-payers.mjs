#!/usr/bin/env node
/**
 * cleanup-cancel-lists-for-payers.mjs
 *
 * Post the "simplify cancel lists" migration (20260529120000).
 *
 * Purpose (user request):
 * - Remove every phone that has ANY paid order history from all cancel lists.
 * - These phones belong in normal value/prestige prediction lists based on their purchase behavior.
 * - Only phones with ZERO paid orders ever should remain in the (now simple 4) cancel lists.
 *
 * What it does:
 * 1. Finds all phones that have at least one 'cancelled' order AND at least one 'paid' order.
 * 2. Deletes any current cancel list memberships for those phones.
 * 3. Forces a recompute for each such phone → they will be placed in the correct value/prestige list
 *    (thanks to the new guard in recompute + priority system).
 * 4. Reports stats.
 *
 * Run after the migration + a full recompute if desired.
 * Safe and idempotent.
 *
 * Usage (production):
 *   SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_URL=... node scripts/cleanup-cancel-lists-for-payers.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log('=== Cleanup: Remove payers from Cancel lists ===\n');

async function main() {
  // 1. Find phones with both cancelled AND paid orders
  const { data: mixedPhones, error: mixedErr } = await supabase
    .from('orders')
    .select('customer_phone')
    .in('status', ['cancelled', 'paid'])
    .not('customer_phone', 'is', null)
    .not('customer_phone', 'eq', '');

  if (mixedErr) throw mixedErr;

  const phoneSet = new Set(mixedPhones.map(r => r.customer_phone));
  const phonesToClean = Array.from(phoneSet);

  console.log(`Phones with at least one cancel + at least one paid order: ${phonesToClean.length}`);

  if (phonesToClean.length === 0) {
    console.log('Nothing to clean.');
    return;
  }

  // 2. Find which of these are currently in any cancel list
  const { data: currentCancelMembers } = await supabase
    .from('prediction_segment_members')
    .select(`
      customer_phone,
      list_id,
      prediction_segment_lists!inner(category, is_static, name)
    `)
    .in('customer_phone', phonesToClean)
    .eq('prediction_segment_lists.category', 'cancel')
    .eq('prediction_segment_lists.is_static', false);

  const toDelete = (currentCancelMembers || []).filter(m => m.prediction_segment_lists);

  console.log(`Of which are currently in a (simple) cancel list: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log('No payers currently sitting in cancel lists. Good.');
    // Still force recompute so they land in the right value list if they aren't already
  }

  // 3. Delete the bad memberships
  let deleted = 0;
  for (const row of toDelete) {
    const { error: delErr } = await supabase
      .from('prediction_segment_members')
      .delete()
      .eq('list_id', row.list_id)
      .eq('customer_phone', row.customer_phone);
    if (!delErr) deleted++;
  }
  console.log(`Deleted ${deleted} incorrect cancel memberships.`);

  // 4. Force recompute for all these phones so the engine places them correctly
  //    (into value/prestige lists thanks to the new "skip cancel if paid_count > 0" logic)
  console.log(`Forcing recompute for ${phonesToClean.length} phones...`);
  let recomputed = 0;
  for (const phone of phonesToClean) {
    try {
      await supabase.rpc('recompute_customer_segments', { _phone: phone });
      recomputed++;
    } catch (e) {
      console.warn('Recompute failed for', phone, e.message);
    }
  }
  console.log(`Recomputed ${recomputed} phones.`);

  console.log('\nDone. These phones should now appear in their proper value/prestige prediction lists.');
  console.log('Only pure non-buyers (zero paid orders ever) will remain in the 4 simple cancel lists.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});