#!/usr/bin/env node
/**
 * fix_21d_57d_bands.mjs
 * Aligns the recency bands on the 21d and 57d lists to the user's clarified windows.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  console.log('Aligning recency bands to user clarified windows...');

  // 21d buckets: 21 days (0.7 months) to 57 days (1.9 months)
  let r = await supabase
    .from('prediction_segment_lists')
    .update({ recency_months_min: 0.7, recency_months_max: 1.9 })
    .like('name', '21d %')
    .eq('is_static', false);
  console.log('21d buckets (21-57 days):', r.error ? r.error.message : 'OK');

  // 57d buckets: start at 57 days (1.9 months) to 4 months
  r = await supabase
    .from('prediction_segment_lists')
    .update({ recency_months_min: 1.9, recency_months_max: 4 })
    .like('name', '57d %')
    .eq('is_static', false);
  console.log('57d buckets (57 days - 4 months):', r.error ? r.error.message : 'OK');

  console.log('Forcing full recompute...');
  const r2 = await supabase.rpc('recompute_all_segments');
  console.log('Recompute processed:', r2.error ? r2.error.message : r2.data + ' phones');

  console.log('Done. Hard refresh /segments.');
})();
