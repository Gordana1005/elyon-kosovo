#!/usr/bin/env node
// Roll back a previous CPA import by deleting the orders listed in a
// scripts/cpa-import-*.txt rollback file.
//
// Usage:
//   node --env-file=.env scripts/rollback-cpa-import.mjs scripts/cpa-import-<timestamp>.txt
//
// order_items and order_notes cascade via FK ON DELETE CASCADE.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node --env-file=.env scripts/rollback-cpa-import.mjs <rollback-file>'); process.exit(1); }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env. Run with: node --env-file=.env scripts/rollback-cpa-import.mjs ...');
  process.exit(1);
}

const displayIds = readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
console.log(`Rolling back ${displayIds.length} orders from ${file}`);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Delete in chunks
let deleted = 0;
const CHUNK = 200;
for (let i = 0; i < displayIds.length; i += CHUNK) {
  const slice = displayIds.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('orders')
    .delete({ count: 'exact' })
    .in('display_id', slice);
  if (error) { console.error('Delete failed:', error); process.exit(1); }
  deleted += count || 0;
  process.stdout.write(`Deleted ${deleted}/${displayIds.length}\r`);
}
console.log(`\nRollback complete: ${deleted} orders removed.`);
