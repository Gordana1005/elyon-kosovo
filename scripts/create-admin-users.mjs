#!/usr/bin/env node
/**
 * Creates the 3 founding admin users in the new Supabase project.
 *
 * Usage:
 *   1. Make sure your new Supabase project is ready and migrations are applied.
 *   2. Set these two env vars (one-shot, in this same shell):
 *        $env:SUPABASE_URL="https://<new-ref>.supabase.co"
 *        $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key from dashboard>"
 *   3. Run:
 *        node scripts/create-admin-users.mjs
 *
 * What it does for each user:
 *   - Creates an auth.users row with email_confirm=true (skips email verification)
 *   - The handle_new_user() trigger auto-creates the profiles row
 *   - Inserts an 'admin' row into public.user_roles
 *
 * SECURITY NOTE: All three users share password "12345678" by request.
 *                Change passwords from the app or Supabase dashboard
 *                before any production usage.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  console.error("PowerShell example:");
  console.error('  $env:SUPABASE_URL="https://<ref>.supabase.co"');
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"');
  process.exit(1);
}

const USERS = [
  { email: "MileStoev@elyoncrm.local", full_name: "Mile Stoev" },
  { email: "MikiMitrov@elyoncrm.local", full_name: "Miki Mitrov" },
  { email: "TomeDonchev@elyoncrm.local", full_name: "Tome Donchev" },
];
const PASSWORD = "12345678";

async function deleteUserIfExists(email) {
  // Find by email
  const list = await adminApi(
    `/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    "GET",
  );
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await adminApi(`/auth/v1/admin/users/${existing.id}`, "DELETE");
    console.log(`  removed existing user ${email}`);
  }
}

async function adminApi(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function createUser({ email, full_name }) {
  console.log(`\n→ Creating ${full_name} <${email}>`);
  const created = await adminApi("/auth/v1/admin/users", "POST", {
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  });
  console.log(`  auth user id: ${created.id}`);
  return created;
}

async function ensureAdminRole(userId) {
  await adminApi("/rest/v1/user_roles", "POST", {
    user_id: userId,
    role: "admin",
  });
  console.log(`  admin role assigned`);
}

async function ensureProfileName(userId, fullName) {
  // The handle_new_user() trigger creates the profile. Patch full_name in case
  // the trigger sourced it from email only.
  await adminApi(
    `/rest/v1/profiles?user_id=eq.${userId}`,
    "PATCH",
    { full_name: fullName },
  );
  console.log(`  profile.full_name set`);
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}`);
  // Clean slate: drop any prior users with these emails (or older formats)
  const allEmails = [
    ...USERS.map((u) => u.email),
    "mile.stoev@elyoncrm.local",
    "miki.mitrov@elyoncrm.local",
    "tome.donchev@elyoncrm.local",
  ];
  for (const e of allEmails) {
    try { await deleteUserIfExists(e); } catch (err) { /* ignore */ }
  }

  for (const u of USERS) {
    try {
      const auth = await createUser(u);
      await ensureAdminRole(auth.id);
      await ensureProfileName(auth.id, u.full_name);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }
  console.log("\nDone. Login with any of:");
  for (const u of USERS) console.log(`  ${u.email}  /  ${PASSWORD}`);
  console.log("\nIMPORTANT: rotate these passwords before production use.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
