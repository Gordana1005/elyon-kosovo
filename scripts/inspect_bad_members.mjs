#!/usr/bin/env node
/**
 * inspect_bad_members.mjs
 * Shows actual members in '(1-3 orders)' groups with their real paid_count and last_paid date.
 * Run with production env vars.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data } = await supabase
    .from('prediction_segment_members')
    .select('customer_phone, paid_count, last_paid_at, prediction_segment_lists(name)')
    .like('prediction_segment_lists.name', '%(1-3 orders)%')
    .limit(8);

  console.log('Sample members in "(1-3 orders)" groups:');
  data.forEach(m => {
    const days = m.last_paid_at
      ? Math.floor((Date.now() - new Date(m.last_paid_at)) / (1000 * 60 * 60 * 24))
      : 'N/A';
    console.log(
      `Phone: ${m.customer_phone} | paid_count: ${m.paid_count} | last_paid_days_ago: ${days} | list: ${m.prediction_segment_lists?.name}`
    );
  });
})();
