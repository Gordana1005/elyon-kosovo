#!/usr/bin/env node
/**
 * Creates a test agent user so we can verify the agent permission flow.
 *
 * Usage:
 *   $env:SUPABASE_URL="https://<ref>.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
 *   node scripts/create-test-agent.mjs
 *
 * Idempotent: deletes any existing user with this email before creating.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const USER = {
  email: "TestAgent@elyoncrm.local",
  full_name: "Test Agent",
  role: "agent",
};
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

async function deleteIfExists(email) {
  const list = await adminApi(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`, "GET");
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await adminApi(`/auth/v1/admin/users/${existing.id}`, "DELETE");
    console.log(`  removed existing user ${email}`);
  }
}

async function ensureTodayShift(userId) {
  // The shift-check endpoint blocks non-admin logins unless a shift covers
  // 'right now'. Create or reuse a 24-hour testing shift for today and
  // assign the user to it.
  const today = new Date().toISOString().substring(0, 10);
  const SHIFT_NAME = "Test Agent — 24h coverage";

  // Look up existing shift with this name+date
  const existing = await adminApi(
    `/rest/v1/shifts?date=eq.${today}&name=eq.${encodeURIComponent(SHIFT_NAME)}&select=id`,
    "GET",
  );
  let shiftId = existing?.[0]?.id;

  if (!shiftId) {
    const created = await fetch(`${SUPABASE_URL}/rest/v1/shifts`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: SHIFT_NAME,
        date: today,
        start_time: "00:01:00",
        end_time: "23:59:00",
      }),
    });
    const txt = await created.text();
    if (!created.ok) throw new Error(`shift create: ${created.status} ${txt}`);
    shiftId = JSON.parse(txt)[0].id;
    console.log(`  created today's test shift ${shiftId}`);
  } else {
    console.log(`  reusing today's test shift ${shiftId}`);
  }

  // Assign agent to the shift (idempotent — drop any prior link first)
  await adminApi(
    `/rest/v1/shift_assignments?shift_id=eq.${shiftId}&user_id=eq.${userId}`,
    "DELETE",
  );
  await adminApi("/rest/v1/shift_assignments", "POST", {
    shift_id: shiftId,
    user_id: userId,
  });
  console.log(`  shift_assignment created`);
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}`);
  await deleteIfExists(USER.email);

  console.log(`\n→ Creating ${USER.full_name} <${USER.email}> (role: ${USER.role})`);
  const auth = await adminApi("/auth/v1/admin/users", "POST", {
    email: USER.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: USER.full_name },
  });
  console.log(`  auth user id: ${auth.id}`);

  await adminApi("/rest/v1/user_roles", "POST", { user_id: auth.id, role: USER.role });
  console.log(`  ${USER.role} role assigned`);

  await adminApi(`/rest/v1/profiles?user_id=eq.${auth.id}`, "PATCH", { full_name: USER.full_name });
  console.log(`  profile.full_name set`);

  await ensureTodayShift(auth.id);

  console.log(`\nDone. Test with: ${USER.email} / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
