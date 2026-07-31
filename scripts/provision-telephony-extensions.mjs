#!/usr/bin/env node
// Register PBX SIP extensions into public.telephony_extensions so agents can
// auto-claim them at login (GET /api/voip/credentials, api/index.ts:2979).
//
// Secrets deliberately do NOT live in a migration: they must match the PBX's
// `sip` table byte-for-byte, they rotate independently of schema, and committing
// them would put working SIP credentials in git. Same discipline as docs/VAULT.md.
// The PBX writes /root/elyon-pbx-backup/new-extensions-<date>.json when the
// extensions are cloned; fetch that file and feed it to this script.
//
// SEQUENCING RULE: run this only AFTER the extensions answer on the PBX
// (`asterisk -rx "pjsip show endpoint 1021"`). There is no un-claim endpoint —
// an agent who claims a row whose PBX side is broken gets a dead phone and needs
// manual DB surgery.
//
// Usage:
//   node --env-file=.env scripts/provision-telephony-extensions.mjs --file=ext.json
//   node --env-file=.env scripts/provision-telephony-extensions.mjs --file=ext.json --commit
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const FILE = (() => {
  const a = process.argv.find((x) => x.startsWith('--file='));
  return a ? a.split('=')[1] : null;
})();
// Matches the default in the telephony_extensions DDL (20260612120000).
const DEFAULT_CID = process.env.DEFAULT_CALLER_ID || '+35924234100';

if (!FILE) { console.error('Missing --file=<extensions json>'); process.exit(1); }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const incoming = JSON.parse(readFileSync(FILE, 'utf8'));
if (!Array.isArray(incoming) || !incoming.length) {
  console.error('File must be a non-empty JSON array of {extension, sip_secret}');
  process.exit(1);
}
for (const r of incoming) {
  if (!/^\d{4}$/.test(String(r.extension || '')) || !r.sip_secret) {
    console.error('Bad row:', JSON.stringify(r)); process.exit(1);
  }
}

const { data: existing, error } = await supabase
  .from('telephony_extensions').select('extension,user_id');
if (error) { console.error('read error:', error.message); process.exit(1); }

const have = new Map(existing.map((r) => [r.extension, r]));
const toInsert = incoming.filter((r) => !have.has(r.extension));
const skipped = incoming.filter((r) => have.has(r.extension));

console.log(`pool before : ${existing.length} rows, ` +
  `${existing.filter((r) => r.user_id).length} assigned, ` +
  `${existing.filter((r) => !r.user_id).length} free`);
console.log(`to insert   : ${toInsert.length} (${toInsert.map((r) => r.extension).join(', ') || '—'})`);
if (skipped.length) console.log(`already present, left untouched: ${skipped.map((r) => r.extension).join(', ')}`);

if (!COMMIT) { console.log('\nDRY RUN — re-run with --commit to write.'); process.exit(0); }
if (!toInsert.length) { console.log('Nothing to do.'); process.exit(0); }

const { error: insErr } = await supabase.from('telephony_extensions').insert(
  toInsert.map((r) => ({
    extension: String(r.extension),
    sip_secret: String(r.sip_secret),
    user_id: null,                       // free pool — claimed on first login
    primary_caller_id: DEFAULT_CID,
    label: null,
  })),
);
if (insErr) { console.error('insert error:', insErr.message); process.exit(1); }

const { data: after } = await supabase
  .from('telephony_extensions').select('extension,user_id');
console.log(`pool after  : ${after.length} rows, ` +
  `${after.filter((r) => r.user_id).length} assigned, ` +
  `${after.filter((r) => !r.user_id).length} free`);
