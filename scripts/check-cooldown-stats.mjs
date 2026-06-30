#!/usr/bin/env node
/**
 * check-cooldown-stats.mjs
 *
 * Tiny verification query for the 21-day global cooldown protection.
 *
 * Run with production env:
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-cooldown-stats.mjs
 *
 * Shows:
 * - How many distinct phones have had a protected status (paid/confirmed/shipped/cancelled) in the last 21 days.
 * - How many of them currently have NO active prediction_segment_members (i.e. blocked by cooldown).
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

(async () => {
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recent, error } = await supabase
    .from('orders')
    .select('customer_phone')
    .in('status', ['paid', 'confirmed', 'shipped', 'cancelled'])
    .gte('updated_at', since);

  if (error) throw error;

  const uniquePhones = new Set(recent.map(r => r.customer_phone));
  console.log(`Phones with protected status change in last 21 days: ${uniquePhones.size}`);

  // Check how many have NO current prediction member
  let blocked = 0;
  for (const phone of uniquePhones) {
    const { count } = await supabase
      .from('prediction_segment_members')
      .select('*', { count: 'exact', head: true })
      .eq('customer_phone', phone);
    if (!count || count === 0) blocked++;
  }

  console.log(`Of which are currently blocked from prediction lists (no active membership): ${blocked}`);
  console.log(`Percentage blocked: ${uniquePhones.size ? Math.round((blocked / uniquePhones.size) * 100) : 0}%`);
})();