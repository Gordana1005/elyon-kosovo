#!/usr/bin/env node
/**
 * Tripwire — run before ANY state-changing command (db push, functions deploy,
 * secrets set, vercel deploy).
 *
 * Why this exists: the SUPABASE_ACCESS_TOKEN in .env has write access to BOTH
 * this project and the live Bulgarian CRM. An explicit `--project-ref` OVERRIDES
 * the local link, so nothing but the command line protects Bulgaria. This has
 * already caused one live BG outage (2026-06-30).
 *
 * Exits 0 only if every local config agrees we are pointed at Macedonia, and the
 * remote database looks like Macedonia rather than Bulgaria.
 *
 *   node scripts/assert-mk-target.mjs
 *
 * The row-count ceiling (not "== 0") is deliberate: it keeps working once MK has
 * real orders, while still catching a connection to BG, which has 6-figure volume.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_REF = 'bmfxhgznttcnnlqloqzp';   // Macedonia
const FORBIDDEN_REF = 'sxymaloycddnoxudxaqp';  // live Bulgaria — never a target
const EXPECTED_VERCEL = 'elyon-natura';  // renamed from elyon-kosovo 2026-08-01
const MAX_ORDERS = Number(process.env.MK_MAX_ORDERS || 50_000);

const fail = (msg) => { console.error(`\x1b[31m✗ ABORT\x1b[0m  ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);

function readEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  } catch { /* .env optional when vars already exported */ }
  return env;
}

// 1 — supabase/config.toml is what `--linked` resolves to.
const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
const projectId = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];
if (projectId !== EXPECTED_REF) fail(`supabase/config.toml project_id = "${projectId}", expected "${EXPECTED_REF}"`);
ok(`config.toml → ${projectId}`);

// 2 — .env must agree, or a script reading it will diverge from the CLI.
const env = readEnv();
if (env.VITE_SUPABASE_PROJECT_ID && env.VITE_SUPABASE_PROJECT_ID !== EXPECTED_REF)
  fail(`.env VITE_SUPABASE_PROJECT_ID = "${env.VITE_SUPABASE_PROJECT_ID}", expected "${EXPECTED_REF}"`);
for (const k of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
  if (env[k] && !env[k].includes(EXPECTED_REF)) fail(`.env ${k} does not point at ${EXPECTED_REF}: ${env[k]}`);
  if (env[k] && env[k].includes(FORBIDDEN_REF)) fail(`.env ${k} points at LIVE BULGARIA`);
}
ok('.env agrees');

// 3 — Vercel link.
try {
  const vp = JSON.parse(readFileSync(join(root, '.vercel', 'project.json'), 'utf8'));
  if (vp.projectName !== EXPECTED_VERCEL) fail(`.vercel/project.json projectName = "${vp.projectName}", expected "${EXPECTED_VERCEL}"`);
  ok(`vercel → ${vp.projectName}`);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  console.log('· .vercel/project.json absent (skipped)');
}

// 4 — Remote identity. Local files can all be right while the CLI is aimed elsewhere,
//     so confirm against the database we would actually write to.
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) fail('SUPABASE_ACCESS_TOKEN missing — cannot verify the remote target');

const res = await fetch(`https://api.supabase.com/v1/projects/${EXPECTED_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'select (select count(*) from public.orders)::int as orders, current_database() as db;' }),
});
if (!res.ok) fail(`Management API query failed: ${res.status} ${await res.text()}`);
const [row] = await res.json();
if (row.orders > MAX_ORDERS)
  fail(`remote has ${row.orders} orders (ceiling ${MAX_ORDERS}). This looks like LIVE BULGARIA, not Macedonia.`);
ok(`remote ${EXPECTED_REF} reachable — ${row.orders} orders (under ${MAX_ORDERS} ceiling)`);

console.log('\n\x1b[32mTarget confirmed: Macedonia.\x1b[0m Safe to proceed.\n');
