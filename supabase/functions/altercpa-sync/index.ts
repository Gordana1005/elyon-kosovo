/**
 * altercpa-sync — pull leads from AlterCPA into Elyon.
 *
 *   POST /functions/v1/altercpa-sync
 *   header: x-altercpa-sync-secret: <ALTERCPA_SYNC_SECRET>
 *   body:   { account?: string, kind?: 'rolling'|'nightly'|'weekly'|'backfill'|'manual',
 *             from?: <ISO or epoch s>, to?: <ISO or epoch s>, dry?: boolean }
 *
 * Called by pg_cron every 2 minutes (rolling), nightly and weekly (sweeps), and
 * by an admin for backfills.
 *
 * ── Why a separate function and not another route in api/index.ts ───────────
 * That file is ~15.500 lines and 784 KB and serves every interactive request in
 * the CRM. This is a batch job with a different failure profile: it fans out to
 * a third-party API, can run for tens of seconds, and must be redeployable
 * without shipping the live API. It also needs none of api's auth machinery —
 * its only caller is cron, holding a shared secret.
 *
 * ── The rule that shapes everything ─────────────────────────────────────────
 * EVERY record is written to altercpa_leads. Only records whose geo is in the
 * account's callable_geos are ALSO written to public.orders. Foreign traffic is
 * mirrored and reported on, never called — which is what keeps it away from
 * normalizeMkPhone, from the segment engine, and from every calling queue.
 *
 * Nothing is ever sent back to AlterCPA. Mirrored orders get no affiliate_leads
 * row, so the postback trigger has nothing to fire on.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AlterCpaOrder, PHASE, PHASE_TO_STATUS, REASON,
  fetchWindow, isTestOrder, normalizePhoneForGeo, productNameOf, quantityOf, toEur,
} from "./altercpa.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Overlap on the rolling window: re-reading a few minutes is free (the upsert
 * is idempotent) and it absorbs clock skew plus anything in flight when the
 * previous run took its snapshot. */
const ROLLING_OVERLAP_MIN = 45;

const SWEEP_DAYS: Record<string, number> = {
  rolling: 0,        // computed from last_synced_at
  nightly: 7,
  weekly: 90,
};

const s = (v: unknown, max = 300) => (v == null ? "" : String(v).trim().slice(0, max));
const epoch = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1_000_000_000) return Math.floor(n);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
};
const isoOf = (sec: number) => new Date(sec * 1000).toISOString();

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("ALTERCPA_SYNC_SECRET");
  if (!expected) {
    console.error("ALTERCPA_SYNC_SECRET not set — refusing to run (fail-closed).");
    return json({ error: "Not configured" }, 503);
  }
  if ((req.headers.get("x-altercpa-sync-secret") || "") !== expected) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body = rolling, all accounts */ }

  const kind = s(body.kind, 20) || "rolling";
  if (!["rolling", "nightly", "weekly", "backfill", "manual"].includes(kind)) {
    return json({ error: `Unknown kind '${kind}'` }, 400);
  }
  const dry = body.dry === true;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const accountRef = s(body.account, 200);
  let q = admin.from("altercpa_accounts").select("*").eq("is_active", true);
  if (accountRef) q = q.eq("name", accountRef);
  const { data: accounts, error: accErr } = await q;
  if (accErr) return json({ error: `accounts: ${accErr.message}` }, 500);
  if (!accounts?.length) return json({ error: "No active AlterCPA account matched" }, 404);

  const results = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(admin, account, kind, body, dry));
    } catch (e) {
      console.error(`altercpa-sync: account ${account.name} failed:`, (e as Error).message);
      results.push({ account: account.name, status: "failed", error: (e as Error).message });
    }
  }
  return json({ ok: true, dry, kind, results });
});

async function syncAccount(
  admin: SupabaseClient,
  account: Record<string, any>,
  kind: string,
  body: Record<string, unknown>,
  dry: boolean,
) {
  const startedMs = Date.now();

  const token = Deno.env.get(account.token_secret_name);
  if (!token) {
    // Named explicitly: "secret missing" and "wrong token" look identical from
    // the API's error body, and this is the one of the two we can detect.
    throw new Error(`Secret ${account.token_secret_name} is not set on this function`);
  }

  // ── window ────────────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  let from = epoch(body.from);
  let to = epoch(body.to) ?? nowSec;

  if (from == null) {
    if (kind === "rolling") {
      const last = account.last_synced_at ? Math.floor(new Date(account.last_synced_at).getTime() / 1000) : null;
      // First ever rolling run has no high-water mark. Take one day, not "since
      // sync_from" — a cold start must not silently become an unattended
      // multi-year backfill on a 2-minute cron.
      from = last ? last - ROLLING_OVERLAP_MIN * 60 : nowSec - 86400;
    } else if (SWEEP_DAYS[kind]) {
      from = nowSec - SWEEP_DAYS[kind] * 86400;
    } else {
      throw new Error(`kind '${kind}' requires an explicit from`);
    }
  }
  // A backfill may not reach further back than the account allows.
  if (account.sync_from) {
    const floor = Math.floor(new Date(account.sync_from).getTime() / 1000);
    if (from < floor) from = floor;
  }
  if (to <= from) throw new Error(`empty window: ${isoOf(from)} → ${isoOf(to)}`);

  // ── run log opened BEFORE the fetch, so a run that dies mid-flight is
  // visible as 'running' rather than leaving no trace at all. ───────────────
  let runId: string | null = null;
  if (!dry) {
    const { data: run } = await admin.from("altercpa_sync_runs").insert({
      account_id: account.id,
      kind,
      window_from: isoOf(from),
      window_to: isoOf(to),
      status: "running",
    }).select("id").single();
    runId = run?.id ?? null;
  }

  const splits: string[] = [];
  let rows: AlterCpaOrder[];
  try {
    rows = await fetchWindow(account.api_base, token, from, to, 0, (m) => splits.push(m));
  } catch (e) {
    if (runId) {
      await admin.from("altercpa_sync_runs").update({
        status: "failed", error: (e as Error).message,
        finished_at: new Date().toISOString(), duration_ms: Date.now() - startedMs,
      }).eq("id", runId);
    }
    throw e;
  }

  const callable = new Set<string>((account.callable_geos || []).map((g: string) => String(g).toUpperCase()));
  const importScope = String(account.import_scope || "pending_only");
  const stats = {
    fetched: rows.length, ledger_new: 0, ledger_updated: 0,
    orders_created: 0, orders_updated: 0,
    skipped: {} as Record<string, number>,
  };
  const bump = (k: string) => { stats.skipped[k] = (stats.skipped[k] || 0) + 1; };
  const preview: unknown[] = [];

  // Offer map, loaded once. Keyed the same way the unique index is: lowercased,
  // trimmed — the historical map needed byte-identical names and a stray double
  // space silently broke the link.
  const { data: mapRows } = await admin
    .from("altercpa_offer_map").select("*").eq("account_id", account.id);
  const offerMap = new Map<string, any>();
  for (const m of mapRows || []) {
    offerMap.set(`${String(m.geo).toUpperCase()}|${String(m.offer_name).trim().toLowerCase()}`, m);
  }
  const newOfferSightings = new Map<string, { geo: string; name: string; n: number }>();

  for (const o of rows) {
    const geo = s(o.country, 8).toUpperCase();
    const offerName = productNameOf(o) || "(blank)";
    const offerKey = `${geo}|${offerName.trim().toLowerCase()}`;
    const qty = quantityOf(o);
    const priceEur = toEur(o.price, o.currency);
    const phase = Number(o.phase) || null;

    // Always resolve the number to ITS OWN country's E.164 — a Romanian lead
    // must read +40…, never +389…. An unrecognised geo yields null and
    // phone_raw carries the truth; nothing is ever prefixed with a country code
    // that is not the lead's own.
    const phoneE164 = normalizePhoneForGeo(o.phone, geo);

    // Decide skip_reason; the ledger row is written either way.
    let skip: string | null = null;
    if (isTestOrder(o)) skip = "test_order";
    else if (!callable.has(geo)) skip = "geo_not_callable";
    // PENDINGS ONLY (the default). AlterCPA's own operators work their queue:
    // an order already approved, cancelled or trashed there has been decided,
    // and importing it would drop a finished order into our pipeline — or, for
    // phase 3, book revenue our agents never earned. We take the leads that are
    // still open and decide them ourselves. Everything else stays in the ledger,
    // fully visible in reports, just not in the calling queue.
    else if (importScope === "pending_only" && phase != null && phase !== 1 && phase !== 2) {
      skip = "not_pending";
    }
    else if (!phoneE164) skip = "no_phone";

    // Every sighting is counted, mapped or not, callable geo or not. seen_count
    // is then the true volume per offer, which is both how an admin picks what
    // to map first and how you see which offers a new country actually runs.
    const seen = newOfferSightings.get(offerKey);
    if (seen) seen.n++;
    else newOfferSightings.set(offerKey, { geo, name: offerName, n: 1 });

    const mapping = offerMap.get(offerKey);
    if (skip === null) {
      // An offer with no row, an explicitly ignored one, and one still awaiting
      // a product all mean the same thing here: mirror it, do not invent an
      // order for it. Importing with product_id = NULL instead would make the
      // order invisible to every product report and to stock, with nothing to
      // surface the gap.
      if (!mapping || mapping.is_ignored || !mapping.product_id) skip = "unmapped_offer";
      else if (priceEur == null) skip = "no_fx_rate";
    }

    if (skip) bump(skip);

    const ledgerRow = {
      account_id: account.id,
      altercpa_id: String(o.id),
      geo: geo || null,
      offer_name: offerName,
      offer_ext_id: o.offer != null ? String(o.offer) : null,
      product_id: mapping?.product_id ?? null,
      webmaster: o.wm != null ? String(o.wm) : null,
      phase,
      status: Number(o.status) || null,
      reason: Number(o.reason) || 0,
      created_remote: o.time ? isoOf(Number(o.time)) : null,
      phone_raw: s(o.phone, 60) || null,
      phone_e164: phoneE164,
      customer_name: s(o.name, 200) || null,
      city: s(o.city, 200) || null,
      price_raw: Number(o.price) || 0,
      currency_raw: s(o.currency, 10).toLowerCase() || null,
      price_eur: priceEur,
      quantity: qty,
      payload: o as unknown as Record<string, unknown>,
      skip_reason: skip,
      last_seen_at: new Date().toISOString(),
    };

    if (dry) {
      // Rows that WOULD be written come first and are never crowded out. A
      // preview that fills up with skipped rows answers the least interesting
      // question — the point of a dry run is to see what is about to change.
      if (skip === null || preview.length < 25) {
        preview.push({
          altercpa_id: ledgerRow.altercpa_id, geo, offer: offerName,
          phase, phase_label: phase ? PHASE[phase] : null,
          reason_label: REASON[ledgerRow.reason ?? 0] ?? null,
          price_raw: ledgerRow.price_raw, currency: ledgerRow.currency_raw, price_eur: priceEur,
          skip_reason: skip,
          would_write_order: skip === null,
          would_be_status: skip === null && phase ? PHASE_TO_STATUS[phase] : null,
        });
      }
      continue;
    }

    const written = await upsertLead(admin, account, ledgerRow, o, mapping, stats);
    if (written === "new") stats.ledger_new++;
    else if (written === "updated") stats.ledger_updated++;
  }

  // ── record newly-seen offers so the admin queue is self-populating ────────
  // Via RPC rather than a PostgREST upsert: uniqueness is on a normalized key,
  // and seen_count has to ACCUMULATE. An upsert with ignoreDuplicates would
  // freeze the count at the first batch, and that count is what an admin sorts
  // by to decide which unmapped offer to map first.
  if (!dry && newOfferSightings.size) {
    for (const v of newOfferSightings.values()) {
      const { error: mapErr } = await admin.rpc("altercpa_record_offer_sighting", {
        _account_id: account.id,
        _geo: v.geo || "??",
        _offer_name: v.name,
        _n: v.n,
      });
      if (mapErr) console.error("altercpa-sync: offer sighting:", mapErr.message);
    }
  }

  if (dry) {
    return {
      account: account.name, status: "ok", dry: true,
      window: { from: isoOf(from), to: isoOf(to) },
      splits, ...stats, preview,
      offers_seen: [...newOfferSightings.values()]
        .sort((a, b) => b.n - a.n)
        .map((v) => ({ geo: v.geo, offer: v.name, n: v.n, mapped: !!offerMap.get(`${v.geo}|${v.name.trim().toLowerCase()}`)?.product_id })),
    };
  }

  // Advance the high-water mark ONLY on a clean rolling/sweep run. A backfill
  // must never move it forward — it looks at the past, and moving the cursor
  // would skip everything between the backfill's end and now.
  if (kind === "rolling" || kind === "nightly" || kind === "weekly") {
    await admin.from("altercpa_accounts")
      .update({ last_synced_at: isoOf(to), last_cursor_to: isoOf(to) })
      .eq("id", account.id);
  }

  if (runId) {
    await admin.from("altercpa_sync_runs").update({
      status: "ok",
      fetched: stats.fetched,
      ledger_new: stats.ledger_new,
      ledger_updated: stats.ledger_updated,
      orders_created: stats.orders_created,
      orders_updated: stats.orders_updated,
      skipped: stats.skipped,
      error: splits.length ? `windows split: ${splits.length}` : null,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
    }).eq("id", runId);
  }

  return {
    account: account.name, status: "ok",
    window: { from: isoOf(from), to: isoOf(to) },
    splits, ...stats,
    offers_seen: newOfferSightings.size,
  };
}

/**
 * Upsert the ledger row, then promote it to an order when it is callable.
 * Returns 'new' | 'updated'.
 */
async function upsertLead(
  admin: SupabaseClient,
  account: Record<string, any>,
  row: Record<string, any>,
  o: AlterCpaOrder,
  mapping: any,
  stats: any,
): Promise<string> {
  const { data: existing } = await admin
    .from("altercpa_leads")
    .select("id, order_id, phase, skip_reason")
    .eq("account_id", account.id)
    .eq("altercpa_id", row.altercpa_id)
    .maybeSingle();

  const phaseChanged = !existing || existing.phase !== row.phase;
  if (phaseChanged) row.phase_seen_at = new Date().toISOString();

  // Promote to an order first, so the ledger row can carry order_id in the same
  // write and never exists in a half-linked state.
  let orderId: string | null = existing?.order_id ?? null;
  if (!row.skip_reason) {
    orderId = await upsertOrder(admin, account, row, o, mapping, stats, orderId, phaseChanged);
  }
  row.order_id = orderId;

  if (existing) {
    await admin.from("altercpa_leads").update(row).eq("id", existing.id);
    return "updated";
  }
  const { error } = await admin.from("altercpa_leads").insert(row);
  if (error) {
    // Two concurrent runs raced on the same id; the other one won, which is a
    // correct outcome, not a failure.
    if ((error as any).code === "23505") return "updated";
    throw new Error(`ledger insert ${row.altercpa_id}: ${error.message}`);
  }
  return "new";
}

/**
 * Outcome timestamps taken from AlterCPA's own clock rather than ours.
 *
 * orders has NULL-only BEFORE triggers for paid_at / cancelled_at / trashed_at
 * (20260727000000, 20260711000000, 20260913000100), so anything we set
 * explicitly wins and anything we omit gets stamped now().
 *
 * Letting them default to now() would be wrong in a way that MOVES MONEY AND
 * MEMBERSHIPS: a lead trashed on their side five days ago would get
 * trashed_at = now(), restarting the engine v3.7 21-day Trash List parking
 * period from today, and a COD paid last week would land in this week's paid
 * window on every agent dashboard and payout report.
 *
 * `paid` and `done` are epoch seconds on their record. Guarded against zero and
 * against times before creation, either of which would be worse than a NULL.
 */
function outcomeTimestamps(o: AlterCpaOrder, status: string): Record<string, string> {
  const created = Number(o.time) || 0;
  const at = (v: unknown): string | null => {
    const n = Number(v) || 0;
    if (n <= 0) return null;
    if (created && n < created) return null;
    if (n > Math.floor(Date.now() / 1000) + 86400) return null;   // clock skew / bad data
    return isoOf(n);
  };
  const done = at(o.done);
  const out: Record<string, string> = {};
  if (status === "paid") {
    const p = at(o.paid) ?? done;
    if (p) out.paid_at = p;
  } else if (status === "cancelled") {
    if (done) out.cancelled_at = done;
  } else if (status === "trashed") {
    if (done) out.trashed_at = done;
  }
  return out;
}

/**
 * Create or update the mirrored order.
 *
 * Keyed on (external_source='altercpa', external_order_id=<their id>) — the
 * exact pair scripts/import-altercpa-mk.mjs used for the 81.657-order history
 * import, backed by the partial-unique index from 20260521150000. Reusing it
 * means the live bridge continues from the import with no duplicates and no
 * cutover date to get right.
 */
async function upsertOrder(
  admin: SupabaseClient,
  account: Record<string, any>,
  row: Record<string, any>,
  o: AlterCpaOrder,
  mapping: any,
  stats: any,
  knownOrderId: string | null,
  phaseChanged: boolean,
): Promise<string | null> {
  const phase = row.phase as number | null;
  const remoteStatus = phase ? PHASE_TO_STATUS[phase] : "pending";
  const priceTotal = Math.round(Number(row.price_eur) * row.quantity * 100) / 100;

  const { data: product } = mapping?.product_id
    ? await admin.from("products").select("id, name").eq("id", mapping.product_id).maybeSingle()
    : { data: null };

  const { data: existing } = await admin
    .from("orders")
    .select("id, status, assigned_agent_id, confirmed_at")
    .eq("external_source", "altercpa")
    .eq("external_order_id", row.altercpa_id)
    .maybeSingle();

  if (!existing) {
    const { data: order, error } = await admin.from("orders").insert({
      product_id: product?.id ?? null,
      product_name: product?.name ?? row.offer_name,
      customer_name: row.customer_name || "—",
      customer_phone: row.phone_e164,
      customer_city: row.city || "",
      customer_address: s(o.addr, 600),
      postal_code: s(o.index, 30),
      price: priceTotal,
      quantity: row.quantity,
      status: remoteStatus,
      source_type: "altercpa",
      external_source: "altercpa",
      external_order_id: row.altercpa_id,
      created_at: row.created_remote ?? undefined,
      // Unassigned on purpose so it surfaces in the Assigner like any other
      // pending lead. The bridge distributes nothing.
      assigned_agent_id: null,
      assigned_agent_name: null,
      assigned_at: null,
      ...outcomeTimestamps(o, remoteStatus),
    }).select("id, display_id").single();

    if (error) {
      if ((error as any).code === "23505") return knownOrderId;   // concurrent run won
      throw new Error(`order insert ${row.altercpa_id}: ${error.message}`);
    }

    await admin.from("order_items").insert({
      order_id: order.id,
      product_id: product?.id ?? null,
      product_name: product?.name ?? row.offer_name,
      quantity: row.quantity,
      price_per_unit: Number(row.price_eur),
      total_price: priceTotal,
    });
    await admin.from("order_notes").insert({
      order_id: order.id,
      text: [
        `Mirrored from AlterCPA (${account.name}) — order #${row.altercpa_id}`,
        `Offer: ${row.offer_name}${row.geo ? ` [${row.geo}]` : ""}`,
        row.webmaster ? `Webmaster: ${row.webmaster}` : "",
        phase ? `Their phase: ${PHASE[phase]}${row.reason ? ` (${REASON[row.reason] ?? row.reason})` : ""}` : "",
        `Their price: ${row.price_raw} ${String(row.currency_raw || "").toUpperCase()}`,
        s(o.comment, 500) ? `Customer comment: ${s(o.comment, 500)}` : "",
      ].filter(Boolean).join("\n"),
      author_id: null,
      author_name: "System",
    });
    await admin.from("order_history").insert({
      order_id: order.id,
      to_status: remoteStatus,
      changed_by: null,
      changed_by_name: `System (altercpa:${account.name})`,
    });

    // Keep the phone-keyed profile in step — FILL-ONLY. An agent who corrected
    // an address on the phone has better data than the web form AlterCPA
    // captured it from, so a field that already has a value is never touched.
    // "Do not blank" is not enough here; the rule is "do not overwrite".
    const incoming: Record<string, string> = {};
    if (row.customer_name) incoming.customer_name = row.customer_name;
    if (row.city) incoming.city = row.city;
    if (s(o.index, 30)) incoming.postal_code = s(o.index, 30);
    if (s(o.street, 300)) incoming.street = s(o.street, 300);

    const { data: prof } = await admin
      .from("customer_profiles")
      .select("phone, customer_name, city, postal_code, street")
      .eq("phone", row.phone_e164)
      .maybeSingle();

    if (!prof) {
      await admin.from("customer_profiles").insert({ phone: row.phone_e164, ...incoming });
    } else {
      const patch: Record<string, string> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (!s((prof as Record<string, unknown>)[k])) patch[k] = v;
      }
      if (Object.keys(patch).length) {
        await admin.from("customer_profiles").update(patch).eq("phone", row.phone_e164);
      }
    }

    stats.orders_created++;
    return order.id;
  }

  // ── existing order: apply the status-mirror policy ───────────────────────
  const mode = account.status_mirror as string;
  if (mode === "off" || !phaseChanged) return existing.id;

  // 'until_touched' — an untouched order is one nobody here has worked. Once an
  // agent takes or confirms it, a stale phase from the other system must never
  // silently revert what they just did; it becomes a note instead.
  const untouched = existing.status === "pending"
    && !existing.assigned_agent_id
    && !existing.confirmed_at;

  if (mode === "always" || (mode === "until_touched" && untouched)) {
    if (existing.status !== remoteStatus) {
      const { error } = await admin.from("orders")
        .update({ status: remoteStatus, ...outcomeTimestamps(o, remoteStatus) })
        .eq("id", existing.id);
      if (error) throw new Error(`order update ${row.altercpa_id}: ${error.message}`);
      await admin.from("order_history").insert({
        order_id: existing.id,
        from_status: existing.status,
        to_status: remoteStatus,
        changed_by: null,
        changed_by_name: `System (altercpa:${account.name})`,
      });
      stats.orders_updated++;
    }
  } else {
    await admin.from("order_notes").insert({
      order_id: existing.id,
      text: `AlterCPA moved this to "${phase ? PHASE[phase] : "?"}"`
        + `${row.reason ? ` (${REASON[row.reason] ?? row.reason})` : ""}`
        + ` — not applied, this order is already being worked here.`,
      author_id: null,
      author_name: "System",
    });
  }
  return existing.id;
}
