#!/usr/bin/env node
/**
 * One-off: move every login from the Kosovo placeholder domain to the Macedonian
 * one, so they keep matching LoginPage's EMAIL_DOMAIN.
 *
 * The login form takes a USERNAME and appends EMAIL_DOMAIN. The moment that
 * constant changed from elyon-xk.local to elyon-mk.local, every existing account
 * became unreachable through the form. This renames the auth users (and their
 * profiles row) so the same usernames and passwords keep working.
 *
 *   node scripts/retarget-login-domain-mk.mjs [--dry-run]
 *
 * Idempotent: accounts already on the new domain are skipped.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'bmfxhgznttcnnlqloqzp';
const OLD = '@elyon-xk.local';
const NEW = '@elyon-mk.local';
const dry = process.argv.includes('--dry-run');

const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
if (toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1] !== REF) {
  console.error('config.toml does not point at Macedonia — refusing to run.'); process.exit(1);
}
const env = {};
for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const URL = env.SUPABASE_URL || `https://${REF}.supabase.co`;
if (!SERVICE) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const hdr = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

const list = await (await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: hdr })).json();
const users = list.users || [];
let done = 0;

for (const u of users) {
  if (!u.email?.endsWith(OLD)) { console.log(`· ${u.email} — not on ${OLD}, skipping`); continue; }
  const next = u.email.replace(OLD, NEW);
  if (dry) { console.log(`· would rename ${u.email} → ${next}`); continue; }

  const res = await fetch(`${URL}/auth/v1/admin/users/${u.id}`, {
    method: 'PUT', headers: hdr,
    // email_confirm keeps the account usable without a confirmation round-trip
    // (these are internal .local addresses that can never receive mail).
    body: JSON.stringify({ email: next, email_confirm: true }),
  });
  if (!res.ok) { console.error(`✗ ${u.email}: ${res.status} ${await res.text()}`); continue; }

  // profiles.email is a denormalised copy shown throughout the UI.
  await fetch(`${URL}/rest/v1/profiles?user_id=eq.${u.id}`, {
    method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' },
    body: JSON.stringify({ email: next }),
  });
  console.log(`✓ ${u.email} → ${next}`);
  done++;
}
console.log(`\n${dry ? '(dry run) ' : ''}${done} account(s) moved to ${NEW}`);
