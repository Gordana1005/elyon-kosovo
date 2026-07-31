#!/usr/bin/env node
/**
 * Creates a single super-admin user `ntkosovo` in the Kosovo Supabase project.
 *
 * Usage (Node 20.6+ for --env-file):
 *   node --env-file=.env scripts/create-ntkosovo-admin.mjs
 *
 * Reads SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY from .env.
 * "admin" is the highest role — it bypasses every module/permission check, so this
 * account has full access. Idempotent: re-running deletes the prior ntkosovo first.
 *
 * SECURITY: password is "12345678" by request — rotate before real production use.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run:  node --env-file=.env scripts/create-ntkosovo-admin.mjs");
  process.exit(1);
}

// Hard guard: never run against the Bulgarian project.
if (SUPABASE_URL.includes("sxymaloycddnoxudxaqp")) {
  console.error("REFUSING: that is the Bulgarian project. Kosovo only.");
  process.exit(1);
}

const USER = { email: "ntkosovo@elyon-xk.local", full_name: "NT Kosovo" };
const PASSWORD = "12345678";

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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function deleteUserIfExists(email) {
  const list = await adminApi(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`, "GET");
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await adminApi(`/auth/v1/admin/users/${existing.id}`, "DELETE");
    console.log(`  removed existing user ${email}`);
  }
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}`);
  try { await deleteUserIfExists(USER.email); } catch { /* ignore */ }

  console.log(`\n→ Creating ${USER.full_name} <${USER.email}>`);
  const created = await adminApi("/auth/v1/admin/users", "POST", {
    email: USER.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: USER.full_name },
  });
  console.log(`  auth user id: ${created.id}`);

  await adminApi("/rest/v1/user_roles", "POST", { user_id: created.id, role: "admin" });
  console.log(`  admin role assigned`);

  await adminApi(`/rest/v1/profiles?user_id=eq.${created.id}`, "PATCH", { full_name: USER.full_name });
  console.log(`  profile.full_name set`);

  console.log(`\nDone. Login:  ntkosovo  /  ${PASSWORD}   (admin — full access)`);
  console.log("IMPORTANT: rotate this password before production use.");
}

main().catch((err) => { console.error(err); process.exit(1); });
