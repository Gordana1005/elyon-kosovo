#!/usr/bin/env node
// One-off: create two new call agents with pending_agent + prediction_agent
// roles. Uses the Supabase admin API via the service-role key.
//
// Idempotent: if a user with the same email exists it is deleted first, then
// recreated, so re-running gives a clean state.
//
// Usage:
//   node --env-file=.env scripts/create-agents-2026-05.mjs

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const PASSWORD = '12345678';
const ROLES = ['pending_agent', 'prediction_agent'];

const AGENTS = [
  { email: 'elenapockova@elyoncrm.local', full_name: 'Elena Pockova' },
  { email: 'ile1234@elyoncrm.local',      full_name: 'Ile' },
];

async function adminApi(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function deleteIfExists(email) {
  const list = await adminApi(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`, 'GET');
  const existing = list?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await adminApi(`/auth/v1/admin/users/${existing.id}`, 'DELETE');
    console.log(`  removed existing user ${email}`);
  }
}

async function createAgent(agent) {
  console.log(`\n→ ${agent.full_name} <${agent.email}>`);
  await deleteIfExists(agent.email);

  const auth = await adminApi('/auth/v1/admin/users', 'POST', {
    email: agent.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: agent.full_name },
  });
  console.log(`  auth user id: ${auth.id}`);

  // Roles. The DB has a UNIQUE(user_id, role) constraint so duplicates are
  // rejected — insert each role separately.
  for (const role of ROLES) {
    await adminApi('/rest/v1/user_roles', 'POST', { user_id: auth.id, role });
    console.log(`  + role: ${role}`);
  }

  // The profiles row is auto-created by a trigger on signup; set the name.
  await adminApi(`/rest/v1/profiles?user_id=eq.${auth.id}`, 'PATCH', { full_name: agent.full_name });
  console.log(`  profile.full_name = "${agent.full_name}"`);
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}`);
  for (const agent of AGENTS) {
    await createAgent(agent);
  }
  console.log('\nDone. Login credentials:');
  for (const a of AGENTS) {
    console.log(`  ${a.email}  /  ${PASSWORD}   (roles: ${ROLES.join(', ')})`);
  }
  console.log('\n⚠ These are non-admin agents — they cannot log in until they have a');
  console.log('  shift assignment covering the current time (Shifts Management page).');
}

main().catch(err => { console.error(err); process.exit(1); });
