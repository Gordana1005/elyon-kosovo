import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

// ============================================================
// INPUT VALIDATION SCHEMAS
// ============================================================

const createUserSchema = z.object({
  email: z.string().trim().email("Invalid email format").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  full_name: z.string().trim().min(1, "Name is required").max(200),
  roles: z.array(z.enum(["admin", "manager", "agent", "pending_agent", "prediction_agent", "warehouse", "ads_admin"])).min(1).optional(),
  role: z.string().optional(),
});

const createOrderItemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(100000),
  price_per_unit: z.number().min(0).max(10000000),
});

const createOrderSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name: z.string().trim().min(1, "Product name is required").max(200),
  customer_name: z.string().max(200).optional().default(""),
  customer_phone: z.string().max(30).optional().default(""),
  customer_city: z.string().max(200).optional().default(""),
  customer_address: z.string().max(500).optional().default(""),
  postal_code: z.string().max(20).optional().default(""),
  // Granular address (Phase 3) — supplements customer_address rather than
  // replacing it; existing rows keep their single-line addresses untouched.
  street: z.string().max(300).optional().default(""),
  street_number: z.string().max(20).optional().default(""),
  quarter: z.string().max(200).optional().default(""),
  apartment: z.string().max(50).optional().default(""),
  floor: z.string().max(20).optional().default(""),
  block: z.string().max(100).optional().default(""),
  entry: z.string().max(50).optional().default(""),
  delivery_instructions: z.string().max(1000).optional().default(""),
  gift_note: z.string().max(500).optional().default(""),
  // Structured delivery method (Phase 6 — courier office picker)
  delivery_type: z.enum(["home", "speedy_office", "econt_office"]).optional().default("home"),
  home_courier: z.enum(["speedy", "econt"]).optional(),
  courier_office_code: z.string().max(50).optional().default(""),
  courier_office_name: z.string().max(300).optional().default(""),
  courier_office_city: z.string().max(200).optional().default(""),
  birthday: z.string().nullable().optional().default(null),
  ship_after_date: z.string().nullable().optional().default(null),
  price: z.number().min(0).max(10000000).optional().default(0),
  quantity: z.number().int().min(1).max(100000).optional().default(1),
  // Status the agent picks when creating the order from a call. Beyond the
  // "soft commit" trio we now allow cancelled/trashed so the agent can record
  // the call outcome directly (no separate order edit needed).
  status: z.enum(["pending", "confirmed", "call_again", "cancelled", "trashed"]).optional(),
  // Required when status is 'cancelled' — moves the customer into the right
  // Cancelled mirror segment.
  cancellation_reason: z.enum([
    "no_money", "changed_mind", "wrong_product", "bought_elsewhere",
    "family_refused", "duplicate_order", "price_too_high", "not_satisfied",
    "still_using_product", "not_interested", "will_call_back", "other",
  ]).optional(),
  cancellation_reason_notes: z.string().max(1000).optional(),
  // Structured trash reason — stored only when status is 'trashed' (see the
  // insert below). Mirrors the agent-facing picker in ChooseAnswerButton.tsx.
  trash_reason: z.enum([
    "wrong_number", "wrong_person", "rude", "uncooperative", "other",
  ]).optional(),
  trash_reason_notes: z.string().max(1000).optional(),
  items: z.array(createOrderItemSchema).optional(),
  notes: z.string().max(2000).optional(),
});

const updateCustomerSchema = z.object({
  customer_name: z.string().max(200).optional(),
  customer_phone: z.string().max(30).optional(),
  customer_city: z.string().max(200).optional(),
  customer_address: z.string().max(500).optional(),
  postal_code: z.string().max(20).optional(),
  street: z.string().max(300).optional(),
  street_number: z.string().max(20).optional(),
  quarter: z.string().max(200).optional(),
  apartment: z.string().max(50).optional(),
  floor: z.string().max(20).optional(),
  block: z.string().max(100).optional(),
  entry: z.string().max(50).optional(),
  delivery_instructions: z.string().max(1000).optional(),
  gift_note: z.string().max(500).optional(),
  delivery_type: z.enum(["home", "speedy_office", "econt_office"]).optional(),
  home_courier: z.enum(["speedy", "econt"]).optional(),
  courier_office_code: z.string().max(50).optional(),
  courier_office_name: z.string().max(300).optional(),
  courier_office_city: z.string().max(200).optional(),
  birthday: z.string().nullable().optional(),
  price: z.number().min(0).max(10000000).optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  product_id: z.string().uuid().nullable().optional(),
  product_name: z.string().max(200).optional(),
  ship_after_date: z.string().nullable().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["pending", "take", "call_again", "confirmed", "shipped", "delivered", "returned", "paid", "trashed", "cancelled"]),
  // Optional structured reason — required when status is being changed to
  // 'cancelled' so the customer lands in the right Cancelled mirror list.
  cancellation_reason: z.enum([
    "no_money", "changed_mind", "wrong_product", "bought_elsewhere",
    "family_refused", "duplicate_order", "price_too_high", "not_satisfied",
    "still_using_product", "not_interested", "will_call_back", "other",
  ]).optional(),
  cancellation_reason_notes: z.string().max(1000).optional(),
  // Structured trash reason — stored only when status is being set to 'trashed'.
  trash_reason: z.enum([
    "wrong_number", "wrong_person", "rude", "uncooperative", "other",
  ]).optional(),
  trash_reason_notes: z.string().max(1000).optional(),
  return_reason: z.enum([
    "not_picked_up", "refused_at_door", "undeliverable_address",
    "damaged_in_transit", "wrong_item_shipped", "changed_mind_after_ship", "other",
  ]).optional(),
  return_reason_notes: z.string().max(1000).optional(),
});

// A "real order" = a lead the customer confirmed (and anything downstream of
// confirm). Pending leads, no-answer/call-again, trashed and cancelled rows
// are NOT orders. This is the single source of truth reused by the order
// write-paths (confirmed_by attribution) and the analytics endpoints.
const REAL_ORDER_STATUSES = ["confirmed", "shipped", "delivered", "paid", "returned"];

// BigArena action-button labels that appear in every pending order's row and
// contain отказ/върни — strip them before any keyword check so they aren't
// mis-read as the order's status. Mirror of the frontend list in
// src/components/BigArenaStatusSync.tsx (keep both in sync).
const BIGARENA_ACTION_LABELS = [
  'принудително отказване', 'върни обратно за повторна обработка',
  'създай поръчка за замяна', 'клонирай поръчка', 'маркирай като изчерпана наличност',
  'промени наложен платеж', 'придвижи за приоритетно изпълнение', 'генерирай пратка',
  'прегенерирай пратка', 'история на статусите', 'добави инфо за куриер',
];
function stripBigArenaActions(s: string): string {
  let out = (s || '').toLowerCase();
  for (const a of BIGARENA_ACTION_LABELS) out = out.split(a).join(' ');
  return out;
}

// BigArena → CRM status mapping. Precise + safe: only genuine terminal statuses
// move an order. Pending / in-movement / processing → null (no change). NOTE:
// the sync endpoint trusts the client's already-mapped target; this mirrors the
// frontend (src/components/BigArenaStatusSync.tsx) for any future server use.
function mapBigArenaStatus(rawStatus: string, fullRowText: string = ""): 'paid' | 'returned' | 'cancelled' | null {
  const s = stripBigArenaActions(`${rawStatus || ''} ${fullRowText || ''}`);

  // Paid — client physically accepted the parcel / merchant got paid.
  if (
    s.includes('приета от клиент') || s.includes('приет от клиент') ||
    s.includes('доставен') || s.includes('доставена') ||
    /дата на изплащане/.test(s) || s.includes('платен')
  ) return 'paid';

  // Cancelled — Отменена / Анулирана (cancelled at warehouse, never shipped → no stock restore).
  if (s.includes('отменен') || s.includes('анулиран')) return 'cancelled';

  // Returned — shipped parcel that came back / was refused / failed delivery.
  // "Неуспешна доставка" counts; a single "неуспешен опит" (attempt) does not.
  if (
    s.includes('върнат') || s.includes('върната') ||
    s.includes('отказана') || s.includes('отказан от клиент') ||
    s.includes('неуспешна доставка') ||
    s.includes('не е потърсена') || s.includes('return')
  ) return 'returned';

  return null;
}

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  description: z.string().max(2000).optional().default(""),
  price: z.number().min(0).max(10000000).optional().default(0),
  cost_price: z.number().min(0).max(10000000).optional().default(0),
  sku: z.string().max(50).nullable().optional().default(null),
  stock_quantity: z.number().int().min(0).max(1000000).optional().default(0),
  low_stock_threshold: z.number().int().min(0).max(100000).optional().default(5),
  photo_url: z.string().url().max(2000).nullable().optional().default(null),
  is_active: z.boolean().optional().default(true),
  category: z.string().max(200).optional().default(""),
  supplier_id: z.string().uuid().nullable().optional().default(null),
});

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required").max(200),
  contact_info: z.string().max(500).optional().default(""),
  email: z.string().max(255).optional().default(""),
  phone: z.string().max(30).optional().default(""),
  address: z.string().max(500).optional().default(""),
});

const restockSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000000),
  supplier_name: z.string().max(200).optional().default(""),
  invoice_number: z.string().max(100).optional().default(""),
  notes: z.string().max(1000).optional().default(""),
});

const createCampaignSchema = z.object({
  campaign_name: z.string().trim().min(1, "Campaign name is required").max(200),
  platform: z.string().max(50).optional().default("meta"),
  budget: z.number().min(0).max(100000000).optional().default(0),
  notes: z.string().max(5000).optional().default(""),
});

const createShiftSchema = z.object({
  name: z.string().trim().min(1, "Shift name is required").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid time format"),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid time format"),
  agent_ids: z.array(z.string().uuid()).optional(),
});

const callLogSchema = z.object({
  context_type: z.enum(["order", "prediction_lead", "standalone"]),
  context_id: z.string().uuid().nullable().optional(),
  outcome: z.string().min(1).max(100),
  notes: z.string().max(5000).optional().default(""),
  // Telemetry — every dial logs start/connect/end so durations are real,
  // not synthesised. All optional so old clients don't break.
  started_at: z.string().datetime().optional(),
  connected_at: z.string().datetime().nullable().optional(),
  ended_at: z.string().datetime().optional(),
  customer_phone: z.string().max(30).optional(),
  connection_state: z.enum(["answered", "no_answer", "busy", "failed", "voicemail"]).optional(),
  // Structured cancel reason — required by UI when outcome=cancelled but the
  // server validates the combination explicitly so we can return a helpful
  // 400 instead of a Zod error.
  cancellation_reason: z.enum([
    "no_money", "changed_mind", "wrong_product", "bought_elsewhere",
    "family_refused", "duplicate_order", "price_too_high", "not_satisfied",
    "still_using_product", "not_interested", "will_call_back", "other",
  ]).optional(),
  cancellation_reason_notes: z.string().max(1000).optional(),
  // Structured trash reason for an in-call 'trash' outcome (the 'wrong_number'
  // outcome is self-describing and derived server-side; see applyOutcomeToOrder).
  trash_reason: z.enum([
    "wrong_number", "wrong_person", "rude", "uncooperative", "other",
  ]).optional(),
});

const personalListCreateSchema = z.object({
  customer_phone: z.string().trim().min(4).max(30),
  customer_name: z.string().max(200).optional(),
  reason: z.string().trim().min(1, "Reason is required").max(1000),
  follow_up_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "follow_up_by must be YYYY-MM-DD").optional(),
});

const personalListExtendSchema = z.object({
  days: z.number().int().min(1).max(60),
});

// Bulk customer-contact correction. Fixes a wrong / duplicated number or name
// across EVERY order for the customer (identified by the current phone, last-8
// normalised) so the call card + Dial are correct everywhere. At least one of
// customer_name / customer_phone must be supplied.
const updateCustomerContactSchema = z.object({
  phone: z.string().trim().min(4, "Current phone is required").max(40),
  customer_name: z.string().trim().max(200).optional(),
  customer_phone: z.string().trim().max(40).optional(),
});

const predictionListSchema = z.object({
  name: z.string().trim().min(1, "List name is required").max(200),
  entries: z.array(z.object({
    name: z.string().max(200).optional().default(""),
    telephone: z.string().max(30).optional().default(""),
    address: z.string().max(500).optional().default(""),
    city: z.string().max(200).optional().default(""),
    product: z.string().max(200).optional().default(""),
  })).min(1, "No entries provided"),
});

const inboundLeadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: z.string().trim().min(1, "Phone is required").max(30),
  status: z.string().max(50).optional().default("pending"),
  source: z.string().max(100).optional().default("landing_page"),
});

// Inbound order from an external storefront (naturatherapy.xk / OpenCart) pushed
// by the elyon_crm_bridge OCMOD. Carries the full order so the CRM has clear data
// about what product, what happened, and where it came from. Monetary values are
// in `currency` (EUR or BGN); the CRM stores EUR.
const opencartItemSchema = z.object({
  name: z.string().trim().min(1).max(400),
  sku: z.string().max(120).optional().default(""),
  quantity: z.coerce.number().int().min(1).max(100000).optional().default(1),
  price: z.coerce.number().min(0).optional().default(0), // per-unit, in `currency`
});

const opencartOrderSchema = z.object({
  // OpenCart order_id — stable external key for idempotent upserts.
  order_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  // "order" = a real placed order (→ Pending in the Assigner);
  // "abandoned" = an incomplete checkout (→ saved as a lead).
  mode: z.enum(["order", "abandoned"]).optional().default("order"),
  status_label: z.string().max(160).optional().default(""), // OpenCart status name, e.g. "Pending"
  customer_name: z.string().trim().max(400).optional().default(""),
  first_name: z.string().max(200).optional().default(""),
  last_name: z.string().max(200).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().max(254).optional().default(""),
  city: z.string().max(200).optional().default(""),
  address: z.string().max(600).optional().default(""),
  postal_code: z.string().max(30).optional().default(""),
  comment: z.string().max(4000).optional().default(""),
  total: z.coerce.number().optional(),
  currency: z.string().max(10).optional().default("EUR"),
  source: z.string().max(120).optional().default("naturatherapy.xk"),
  date_added: z.string().max(40).optional().default(""),
  items: z.array(opencartItemSchema).optional().default([]),
});

const warehouseItemSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  product_id: z.string().uuid("Invalid product ID"),
  quantity: z.number().int().min(1).max(100000).optional().default(1),
  notes: z.string().max(1000).optional().default(""),
});

function parseBody<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.errors.map(e => e.message).join("; ");
    throw new ValidationError(msg);
  }
  return result.data;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Cross-script / website-name product aliases the fuzzy matcher can't bridge —
// typically a Latin/English storefront name vs the Cyrillic catalogue name.
// Maps a normalised (lowercased) name → catalogue SKU. Keep in sync with
// PRODUCT_NAME_ALIASES in src/lib/utils.ts (the fulfilment-export safety net).
const OPENCART_NAME_ALIASES: Record<string, string> = {
  "matcha collagen": "NT0145",               // МАЧА с КОЛАГЕН 175 гр
  "neuro active": "5310416001160",           // НЕВРО АКТИВ - 60капсули
  "prostatol": "NT0004",                     // Простатол Комплекс
  "creatine monohydrate": "NT0103",          // CREATINE powder 200 gr. (beats the free-Tribulus fuzzy hit)
  "diet shake с вкус на шоколад": "NT0100",  // Diet shake chocolate 500g
};

// Storefront bundle/promo line names → real catalogue components, so "Brain 4"
// never lands in the CRM as a fake product. Matched on the normalised
// (lowercased, whitespace-collapsed) line name. Component qty multiplies by the
// line's own quantity. Keep in sync with scripts/backfill-bundle-order-items.mjs,
// which embeds the same map for the historical rewrite.
const OPENCART_BUNDLES: Record<string, { sku: string; qty: number }[]> = {
  "brain 4": [{ sku: "NT0063", qty: 4 }],                                              // 4× Brain active (30cps)
  "brain 2": [{ sku: "NT0063", qty: 2 }],
  "prostatol 4": [{ sku: "NT0004", qty: 4 }],                                          // 4× Простатол Комплекс
  "prostatol 3 + palmetto 1": [{ sku: "NT0004", qty: 3 }, { sku: "NT0055", qty: 1 }],  // 3× Простатол Комплекс + 1× SAW Palmetto
  "diabetol 4": [{ sku: "NT0002", qty: 4 }],                                           // 4× Диабетол Форте
  "curcumactiv 2+1snail": [{ sku: "NT0057", qty: 2 }, { sku: "NT0025", qty: 1 }],      // 2× Curcumactiv (500ml) + 1× Snail Complex
  "creatine monohydrate (1+1) + tribulus terrestris безплатно": [{ sku: "NT0103", qty: 2 }, { sku: "NT0097", qty: 1 }],
  "slim complex + 2x slim fiber - натурални хапчета за отслабване": [{ sku: "NT0053", qty: 1 }, { sku: "NT0054", qty: 2 }],
};
const normBundleKey = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const matchBundle = (rawName: string) => OPENCART_BUNDLES[normBundleKey(rawName)] ?? null;

// Split one bundle line's money across its expanded components: weight by the
// catalogue retail price (fallback: package count), round to cents, and put the
// rounding remainder on the first line so the components sum EXACTLY to the
// bundle line's total — orders.price is never recomputed.
function allocateBundlePrice(
  lineTotal: number,
  comps: { compQty: number; cataloguePrice: number }[],
): { total_price: number; price_per_unit: number }[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const weights = comps.map((c) => (c.cataloguePrice > 0 ? c.cataloguePrice * c.compQty : c.compQty));
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  const totals = comps.map((_c, i) => r2(lineTotal * (weights[i] / wSum)));
  const drift = r2(lineTotal - totals.reduce((s, t) => s + t, 0));
  totals[0] = r2(totals[0] + drift);
  return comps.map((c, i) => ({
    total_price: totals[i],
    price_per_unit: c.compQty > 0 ? r2(totals[i] / c.compQty) : 0,
  }));
}

// Resolve a storefront line-item name to a CRM product id, used when sku/barcode
// and exact name all miss. Curated aliases first (so combos like "Creatine +
// Tribulus free" pick the main product, not the bonus), then the longest
// catalogue name that is a substring of the order name (or vice-versa) — longest
// wins to avoid short-token false hits. Returns null when nothing matches.
function resolveCatalogueProductId(
  rawName: string,
  catalogue: { id: string; name: string | null; sku: string | null }[],
): string | null {
  const key = (rawName || "").toLowerCase().trim();
  if (!key) return null;
  for (const alias in OPENCART_NAME_ALIASES) {
    if (key.includes(alias)) {
      const p = catalogue.find((c) => c.sku === OPENCART_NAME_ALIASES[alias]);
      if (p) return p.id;
    }
  }
  let best: { id: string; len: number } | null = null;
  for (const c of catalogue) {
    const n = (c.name || "").toLowerCase().trim();
    if (!n) continue;
    if (key.includes(n) || n.includes(key)) {
      if (!best || n.length > best.len) best = { id: c.id, len: n.length };
    }
  }
  return best ? best.id : null;
}

// ── Outcome → order-status mapping ──
// Single source of truth: every call outcome that should change the order
// status is mapped here. Returning null means this helper makes no status
// move (e.g. no_answer is handled by the dedicated no-answer block in POST
// /call-logs, which flips the existing order to 'call_again' and opens the
// 3-day Call-Again window — never via this table).
//
// `from` lists every status the order is allowed to be IN before the flip.
// If the order is past these, applyOutcomeToOrder rejects with 409 — e.g.
// you can't "Cancel" something already shipped (warehouse Returned flow
// owns post-shipment refunds).
type OutcomeRule = { to: string; from: string[] };
const OUTCOME_TO_STATUS: Record<string, OutcomeRule | null> = {
  confirmed:      { to: "confirmed", from: ["pending", "take", "call_again"] },
  cancelled:      { to: "cancelled", from: ["pending", "take", "call_again", "confirmed"] },
  trash:          { to: "trashed",   from: ["pending", "take", "call_again"] },
  wrong_number:   { to: "trashed",   from: ["pending", "take", "call_again"] },
  call_again:     { to: "call_again", from: ["pending", "take", "call_again", "confirmed"] },
  no_answer:      null,
  interested:     null,
  not_interested: null,
};

interface ApplyOutcomeArgs {
  orderId: string;
  outcome: string;
  agentId: string;
  cancellationReason?: string;
  cancellationReasonNotes?: string;
  trashReason?: string;
}

interface ApplyOutcomeResult {
  ok: boolean;
  status?: number;
  error?: string;
  newStatus?: string;
  oldStatus?: string;
}

/**
 * Apply a call outcome to an order — flips order.status, records who/why,
 * and lets the prediction-segments trigger move the customer to the right
 * downstream list automatically. Used by POST /api/call-logs and shared by
 * any future endpoint that wants the same atomic outcome→status semantics.
 */
async function applyOutcomeToOrder(
  client: any,
  { orderId, outcome, agentId, cancellationReason, cancellationReasonNotes, trashReason }: ApplyOutcomeArgs,
): Promise<ApplyOutcomeResult> {
  const rule = OUTCOME_TO_STATUS[outcome];
  if (rule === null || rule === undefined) return { ok: true };

  const { data: order, error: fetchErr } = await client
    .from("orders").select("id, status, call_again_since").eq("id", orderId).single();
  if (fetchErr || !order) {
    return { ok: false, status: 404, error: "Order not found" };
  }

  // Idempotent: re-logging a call against an order already in the target
  // status is fine — just don't repeat the side-effects (no toast worth, no
  // column overwrites). Lets managers re-record an outcome for an
  // already-cancelled order without a 409.
  if (order.status === rule.to) {
    return { ok: true, oldStatus: order.status, newStatus: rule.to };
  }

  if (!rule.from.includes(order.status)) {
    return {
      ok: false,
      status: 409,
      error: outcome === "cancelled" && ["shipped", "delivered", "paid", "returned"].includes(order.status)
        ? `This order is already ${order.status}. To refund it, open the order in the Orders list and change the status to Returned (warehouse handles post-shipment refunds).`
        : `Cannot move order from '${order.status}' to '${rule.to}' via outcome '${outcome}'`,
    };
  }

  // Cancellation reason is required only when the helper is actually moving
  // the order INTO 'cancelled' — not when it's already there.
  if (outcome === "cancelled" && !cancellationReason) {
    return { ok: false, status: 400, error: "cancellation_reason is required when outcome is cancelled" };
  }

  const update: Record<string, any> = { status: rule.to };
  // Keep the Call-Again 3-day window in sync with the status:
  //   → into call_again: anchor the window to the first entry (COALESCE).
  //   → out of call_again (confirmed/cancelled/trashed/…): close the window so
  //     the client leaves the Call Again page and isn't held by a cooldown.
  if (rule.to === "call_again") {
    update.call_again_since = order.call_again_since ?? new Date().toISOString();
  } else {
    update.call_again_since = null;
    update.next_call_after = null;
  }
  if (outcome === "cancelled") {
    update.cancellation_reason = cancellationReason;
    update.cancellation_reason_notes = cancellationReasonNotes ?? null;
    update.cancelled_at = new Date().toISOString();
    update.cancelled_by_agent_id = agentId;
  }
  // Capture WHY it was trashed. 'wrong_number' is its own self-describing
  // outcome; a plain 'trash' carries the reason the agent picked. Only set when
  // actually moving INTO trashed (guarded by rule.to), never overwriting.
  if (rule.to === "trashed") {
    update.trash_reason = outcome === "wrong_number" ? "wrong_number" : (trashReason ?? null);
  }

  const { error: updErr } = await client.from("orders").update(update).eq("id", orderId);
  if (updErr) return { ok: false, status: 500, error: updErr.message };

  return { ok: true, oldStatus: order.status, newStatus: rule.to };
}

// CORS headers — origin is set per-request in the serve wrapper below.
const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-webhook-signature",
};

// Browser-call origins allowed to use this function. Server-to-server
// callers (e.g. webhook senders without an Origin header) bypass CORS
// entirely and are gated by the HMAC signature instead.
const ALLOWED_ORIGINS = [
  "https://elyon-xk.com",       // TODO(kosovo): real Kosovo prod domain
  "https://www.elyon-xk.com",   // TODO(kosovo): real Kosovo prod domain
  "https://elyon-kosovo.vercel.app", // TODO(kosovo): set after first `vercel --prod` (Phase 5)
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:3000",
];

function pickAllowedOrigin(origin: string): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Vercel preview deploys: elyon-kosovo-<hash>-gordanas-projects-a53c0208.vercel.app  (TODO(kosovo): confirm team slug after first deploy)
  if (/^https:\/\/elyon-kosovo-[a-z0-9-]+-gordanas-projects-a53c0208\.vercel\.app$/.test(origin)) {
    return origin;
  }
  return null;
}

// ── Agent commission: per-package on every PAID order ───────────────────
// Full spec lives in the elyon-agent-commissions skill. Operator rule (2026-06-04,
// clarified): the bonus is paid PER PACKAGE on every PAID order, credited to the
// confirming agent — regardless of source (prediction list, pending, or manual).
// The ONLY gate is status = paid.
//   • Per PACKAGE, tiered by that line's unit price: <25€→1€, 25–35€→2€, ≥35€→3€.
//   • EVERY package earns — quantity multiplies; there is NO minimum package count.
//   • No prediction-list / role gate. (prediction_list_id still drives the separate
//     "which list made the money" analytics, but NOT the bonus.)
// Both /api/agent-performance and /api/management-insights MUST use these helpers
// so the two payout numbers can never diverge.
function packageBonusRate(unitPrice: number): number {
  if (unitPrice >= 35) return 3;
  if (unitPrice > 25) return 2;
  return 1;
}

// Per-package bonus for ONE order (0 unless PAID). Legacy rows with no order_items
// fall back to price/units as the unit price.
function orderPackageBonus(o: any): number {
  if (!o || o.status !== "paid") return 0;
  const items = o.order_items || [];
  if (items.length > 0) {
    let total = 0;
    for (const it of items) {
      total += packageBonusRate(Number(it.price_per_unit || 0)) * Number(it.quantity || 0);
    }
    return total;
  }
  const units = Number(o.quantity || 0) || 1;
  const unit = Number(o.price || 0) / Math.max(1, units);
  return packageBonusRate(unit) * units;
}

// Sum of per-package bonuses across a set of orders (paid ones only contribute).
function calcAgentBonus(ordersForAgent: any[]): number {
  if (!ordersForAgent?.length) return 0;
  let total = 0;
  for (const o of ordersForAgent) total += orderPackageBonus(o);
  return Math.round(total * 100) / 100;
}

// ── Sales attribution: ONE owner per order = the first agent who confirmed ──
// Credit (sale + bonus) belongs to confirmed_by_*, falling back to the assignee
// only for legacy rows that never recorded a confirmer. A super-admin editing &
// re-confirming an order never overwrites confirmed_by_* (see the status PATCH
// guard), so the first agent keeps the credit. See elyon-agent-commissions.
function salesOwnerId(o: any): string | null {
  return o?.confirmed_by_agent_id ?? o?.assigned_agent_id ?? null;
}
function salesOwnerName(o: any): string | null {
  return o?.confirmed_by_name ?? o?.assigned_agent_name ?? null;
}

// ── TV leaderboard: SEPARATE daily gamification layer ────────────────────────
// This is NOT the paid per-package commission above. It is a CONFIRMED-gated
// daily game that drives the wall-screen board (see migration
// 20260703000000_leaderboard.sql). NEVER reuse calcAgentBonus() here — that one
// is paid-gated and would return 0. Per metric, the bonus = the single HIGHEST
// tier whose `min` <= the agent's value (not a cumulative sum); a negative tier
// bonus is a penalty. Total daily bonus = sum across active metrics.
function tierBonus(value: number, tiers: any[]): number {
  if (!Array.isArray(tiers)) return 0;
  let bonus = 0;
  let bestMin = -Infinity;
  for (const t of tiers) {
    const min = Number(t?.min ?? 0);
    if (value >= min && min >= bestMin) { bestMin = min; bonus = Number(t?.bonus ?? 0); }
  }
  return bonus;
}

function calcLeaderboardBonus(
  stats: { confirmed_count: number; avg_order_value: number; answer_rate: number },
  rules: Record<string, { tiers: any[]; is_active: boolean }>,
): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const [metric, value] of Object.entries(stats)) {
    const rule = rules[metric];
    if (!rule || !rule.is_active) { breakdown[metric] = 0; continue; }
    const b = tierBonus(Number(value) || 0, rule.tiers);
    breakdown[metric] = b;
    total += b;
  }
  return { total: Math.round(total * 100) / 100, breakdown };
}

// Europe/Belgrade day boundary as a UTC ISO instant (DST-correct). The board's
// "today" must reset at Sofia midnight, not the edge function's server-local day.
function sofiaDayStart(now = new Date()): { startISO: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  const n = (t: string) => Number(v(t));
  const day = `${v("year")}-${v("month")}-${v("day")}`;
  // Interpret the Sofia wall-clock as if it were UTC, diff against the real
  // instant to get the current offset, then apply it to Sofia midnight.
  const wallAsUTC = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  const offsetMs = wallAsUTC - now.getTime();
  const sofiaMidnightUTC = Date.UTC(n("year"), n("month") - 1, n("day"), 0, 0, 0);
  return { startISO: new Date(sofiaMidnightUTC - offsetMs).toISOString(), day };
}

// UTC instant of Europe/Belgrade 00:00 for an arbitrary YYYY-MM-DD (DST-correct via a
// noon probe — Sofia is +2 in winter, +3 in summer).
function sofiaMidnight(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", hour: "2-digit", hour12: false }).formatToParts(probe).find((p) => p.type === "hour")!.value);
  const offsetHours = hour - 12;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetHours * 3600 * 1000).toISOString();
}

// [start, end) UTC window for a Sofia calendar day (defaults to today).
function sofiaDayRange(dayParam?: string): { day: string; today: string; startISO: string; endISO: string } {
  const today = sofiaDayStart().day;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam || "") ? (dayParam as string) : today;
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { day, today, startISO: sofiaMidnight(day), endISO: sofiaMidnight(next) };
}

// Fire-and-forget Realtime broadcast so the TV reacts within ~1s when an agent
// confirms. Best-effort: the board also polls, so a failed broadcast is harmless.
async function broadcastLeaderboard(event: string, payload: Record<string, any>): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: "tv-leaderboard", event, payload }] }),
    });
  } catch (_e) { /* never block the request on the broadcast */ }
}

// ── Customer PII redaction (Access & Privacy role flags; see elyon-security) ──
// Masking is applied to API RESPONSES only — all phone search/matching runs
// server-side on the UNMASKED DB columns first, so lookups are unaffected.
// maskName → "Иван П." (first name + surname initials); maskPhone keeps last 3.
// City is intentionally never masked.
const PII_ADDRESS_FIELDS = [
  "customer_address", "address", "street", "street_number", "quarter",
  "apartment", "floor", "block", "entry", "postal_code",
  "courier_office_code", "courier_office_name",
];
function maskPhoneValue(v: any): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 3 ? "•".repeat(d.length) : "•".repeat(d.length - 3) + d.slice(-3);
}
function maskNameValue(v: any): string {
  const parts = String(v ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts[0] + " " + parts.slice(1).map((s) => (s[0] || "") + ".").join(" ");
}
type PiiFlags = { name: boolean; phone: boolean; addr: boolean };
// Redacts a customer-bearing object (order / call row / profile). The bare `name`
// field (prediction leads) is masked only when maskLeadName is set, so we never
// touch unrelated `name` fields (products, lists, agents).
function redactCustomer<T extends Record<string, any>>(obj: T | null | undefined, f: PiiFlags, maskLeadName = false): T | null | undefined {
  if (!obj || typeof obj !== "object") return obj;
  const x: any = { ...obj };
  if (!f.name) {
    if (x.customer_name != null) x.customer_name = maskNameValue(x.customer_name);
    if (maskLeadName && x.name != null) x.name = maskNameValue(x.name);
  }
  if (!f.phone) {
    for (const k of ["customer_phone", "telephone", "caller_number"]) if (x[k] != null) x[k] = maskPhoneValue(x[k]);
  }
  if (!f.addr) {
    for (const k of PII_ADDRESS_FIELDS) if (x[k] != null) x[k] = "•••";
  }
  return x;
}
function redactCustomerList<T extends Record<string, any>>(arr: T[] | null | undefined, f: PiiFlags, maskLeadName = false): T[] {
  return (arr || []).map((o) => redactCustomer(o, f, maskLeadName)!);
}

// ── Cost of goods for one order ──
// unitCost(productId, productName) lets each caller resolve cost by whichever key
// it has (agent-performance keys by product_id, management-insights by name).
// Legacy rows with no order_items fall back to the order's own product/quantity.
function orderCOGS(o: any, unitCost: (productId: any, productName: any) => number): number {
  const items = o?.order_items || [];
  if (items.length > 0) {
    let c = 0;
    for (const it of items) c += unitCost(it.product_id, it.product_name) * (Number(it.quantity) || 1);
    return c;
  }
  return unitCost(o?.product_id, o?.product_name) * (Number(o?.quantity || 0) || 1);
}

// ── Logistics (courier) cost ──
// Every package is < 1 kg, so one flat rate per courier+service. Calibrated from
// the BigArena fee ledger and stored in the editable courier_rates table.
// Deliver = all-in outbound; Return = full round-trip loss (we pay both legs).
const BLENDED_DELIVER_COST = 3.5;  // fallback when the courier wasn't recorded
const BLENDED_RETURN_COST = 6.0;

// BG standard VAT rate. All stored prices are GROSS (VAT-inclusive), so the
// VAT owed on collected cash = gross − gross / (1 + VAT_RATE)  (= gross ÷ 6 at 20%).
const VAT_RATE = 0.20;
type CourierRate = { deliver: number; return_: number };
type RateMap = Record<string, CourierRate>;
const rateKey = (courier: string, service: string) => `${courier}_${service}`;

// Map an order's structured delivery fields to (courier, service). null = unknown.
function resolveCourierService(o: any): { courier: string; service: string } | null {
  const dt = o?.delivery_type;
  if (dt === "speedy_office") return { courier: "speedy", service: "office" };
  if (dt === "econt_office") return { courier: "econt", service: "office" };
  // 'home' (or legacy/empty) = door delivery; courier from home_courier.
  const hc = o?.home_courier;
  if (hc === "speedy" || hc === "econt") return { courier: hc, service: "door" };
  return null;
}

// Modeled courier cost for one order, by its terminal status (each order falls in
// exactly one bucket, so the outbound leg is never double-charged):
//   shipped / delivered / paid → deliver rate
//   returned                   → return rate (round-trip)
//   anything not yet shipped   → 0
function orderLogisticsCost(o: any, rates: RateMap, fallback: CourierRate): number {
  const st = o?.status;
  const shipped = st === "shipped" || st === "delivered" || st === "paid";
  const returned = st === "returned";
  if (!shipped && !returned) return 0;
  const cs = resolveCourierService(o);
  const rate = (cs && rates[rateKey(cs.courier, cs.service)]) || fallback;
  return returned ? rate.return_ : rate.deliver;
}

// Load the editable rate card into a lookup + a blended fallback for unknowns.
async function loadCourierRates(adminClient: any): Promise<{ rates: RateMap; fallback: CourierRate }> {
  const rates: RateMap = {};
  try {
    const { data } = await adminClient.from("courier_rates").select("courier,service,deliver_cost,return_cost");
    for (const r of data || []) {
      rates[rateKey(r.courier, r.service)] = { deliver: Number(r.deliver_cost || 0), return_: Number(r.return_cost || 0) };
    }
  } catch (_e) { /* table missing → pure fallback */ }
  return { rates, fallback: { deliver: BLENDED_DELIVER_COST, return_: BLENDED_RETURN_COST } };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    // Admin client for privileged operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Office deliveries: the order's postal_code must be the courier office's
    // own post code (the one Econt/Speedy assign), so the fulfilment CSV carries
    // a postal_code for offices just like it does for home addresses. Returns
    // the office post code, or null for home deliveries / unknown offices.
    const resolveOfficePostCode = async (
      deliveryType: string | null | undefined,
      officeCode: string | null | undefined,
    ): Promise<string | null> => {
      if (deliveryType !== "speedy_office" && deliveryType !== "econt_office") return null;
      if (!officeCode) return null;
      const courier = deliveryType === "speedy_office" ? "speedy" : "econt";
      const { data } = await adminClient
        .from("courier_offices")
        .select("post_code")
        .eq("courier", courier)
        .eq("office_code", officeCode)
        .maybeSingle();
      return data?.post_code ? String(data.post_code) : null;
    };

    // Snapshot which prediction list a customer was in AT ORDER TIME. Rule-driven
    // segment membership is dynamic (recomputed on every order change), so we must
    // capture it now — it can't be reconstructed later. Matches by last-8 digits
    // (the CRM phone-normalisation canon). Returns nulls when the customer is in no
    // list (the common case for manual / site orders). Never throws — attribution
    // must never block order creation. See migration 20260623000000 and the
    // elyon-agent-commissions skill for why both analytics and bonuses depend on it.
    // Precedence: an explicit uploaded campaign wins over a background segment, so
    // campaign ROI is measured against the list the operator deliberately built.
    const resolvePredictionAttribution = async (
      phone: string | null | undefined,
    ): Promise<{ id: string; type: "segment" | "uploaded"; name: string; category: string | null } | null> => {
      const last8 = String(phone || "").replace(/\D/g, "").slice(-8);
      if (last8.length < 8) return null;
      try {
        // Uploaded campaign list (most recent matching lead) — highest precedence.
        const { data: lead } = await adminClient
          .from("prediction_leads")
          .select("list_id, prediction_lists(name)")
          .ilike("telephone", `%${last8}`)
          .not("list_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lead?.list_id) {
          const name = (lead as any).prediction_lists?.name ?? "Uploaded list";
          return { id: lead.list_id, type: "uploaded", name, category: null };
        }
        // Rule-driven segment (a customer is in at most one — exclusive membership).
        const { data: member } = await adminClient
          .from("prediction_segment_members")
          .select("list_id, prediction_segment_lists(name, category)")
          .ilike("customer_phone", `%${last8}`)
          .limit(1)
          .maybeSingle();
        if (member?.list_id) {
          const lst = (member as any).prediction_segment_lists;
          return { id: member.list_id, type: "segment", name: lst?.name ?? "Segment", category: lst?.category ?? null };
        }
      } catch (_e) {
        // Attribution is best-effort; a lookup failure must not fail the order.
      }
      return null;
    };

    // Best-known customer name for a phone, resolved with the elevated client so it
    // works regardless of who is creating the order. An agent recording a cancel/
    // trash call-outcome only sees their OWN orders via RLS, so the original named
    // purchase (made by someone else) is invisible to them and the name arrives
    // blank — leaving nameless cancelled rows on /orders. We look it up here from
    // any order sharing the phone, then fall back to the prediction segment member.
    // Matches by last-8 digits (the CRM phone-normalisation canon). Never throws.
    const resolveKnownCustomerName = async (
      phone: string | null | undefined,
    ): Promise<string | null> => {
      const last8 = String(phone || "").replace(/\D/g, "").slice(-8);
      if (last8.length < 8) return null;
      try {
        const { data: ord } = await adminClient
          .from("orders")
          .select("customer_name")
          .ilike("customer_phone", `%${last8}`)
          .not("customer_name", "is", null)
          .neq("customer_name", "")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ord?.customer_name?.trim()) return ord.customer_name.trim();

        const { data: member } = await adminClient
          .from("prediction_segment_members")
          .select("customer_name")
          .ilike("customer_phone", `%${last8}`)
          .not("customer_name", "is", null)
          .neq("customer_name", "")
          .limit(1)
          .maybeSingle();
        if (member?.customer_name?.trim()) return member.customer_name.trim();
      } catch (_e) {
        // Best-effort; never block order creation on a name lookup.
      }
      return null;
    };

    // User client for RLS-respecting operations
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    const segments = path.split("/");

    // ── PUBLIC WEBHOOK (HMAC-signed, no Supabase auth) ──
    // Legacy generic webhook
    if (req.method === "POST" && path === "webhook/leads") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`legacy:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let body;
      try { body = parseBody(inboundLeadSchema, JSON.parse(rawBody)); } catch (e: any) { return json({ error: e.message }, 400); }
      const { data: lead, error } = await adminClient
        .from("inbound_leads")
        .insert({ name: body.name, phone: body.phone, status: "pending", source: body.source })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Auto-create order for this lead
      const { data: order } = await adminClient
        .from("orders")
        .insert({
          product_name: "From Landing Page",
          customer_name: body.name,
          customer_phone: body.phone,
          status: "pending",
          source_type: "inbound_lead",
          inbound_lead_id: lead.id,
        })
        .select("id, display_id")
        .single();

      return json({ success: true, id: lead.id, order_id: order?.id });
    }

    // PBX missed-call webhook (HMAC-signed). Logs an inbound call (caller + DID
    // + time) as a missed call so an agent can be assigned to call back.
    if (req.method === "POST" && path === "webhook/missed-call") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`missed-call:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let body: any;
      try { body = JSON.parse(rawBody); } catch { return json({ error: "bad json" }, 400); }
      const caller = String(body.caller_number || "").trim();
      const did = String(body.did || "").trim() || null;
      const uniqueid = String(body.uniqueid || "").trim() || null;
      if (!caller) return json({ error: "caller_number required" }, 400);
      const norm = caller.replace(/\D/g, "").slice(-8); // last-8 match (matches CRM phone-normalisation)
      let linkedOrderId: string | null = null;
      if (norm) {
        const { data: ord } = await adminClient
          .from("orders").select("id").ilike("customer_phone", `%${norm}`)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        linkedOrderId = ord?.id || null;
      }
      const { error } = await adminClient
        .from("missed_calls")
        .upsert({ caller_number: caller, did, uniqueid, linked_order_id: linkedOrderId, linked_phone_norm: norm || null, status: "new" },
          { onConflict: "uniqueid", ignoreDuplicates: true });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // PBX voicemail webhook (HMAC-signed). The caller left a recorded message; the
    // PBX posts its file path so we stamp it onto the matching missed_calls row.
    // The audio lives under the monitor dir and is streamed via elyon-rec.php.
    if (req.method === "POST" && path === "webhook/missed-call-vm") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`missed-call-vm:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let body: any;
      try { body = JSON.parse(rawBody); } catch { return json({ error: "bad json" }, 400); }
      const uniqueid = String(body.uniqueid || "").trim();
      const file = String(body.file || "").trim();
      const seconds = Math.max(0, Math.round(Number(body.seconds) || 0));
      if (!uniqueid) return json({ error: "uniqueid required" }, 400);
      // Same path shape elyon-rec.php / the audio endpoint enforce.
      if (!/^\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._+\-]+\.wav$/.test(file)) return json({ error: "bad file" }, 400);
      const { error } = await adminClient
        .from("missed_calls")
        .update({ voicemail_file: file, voicemail_seconds: seconds })
        .eq("uniqueid", uniqueid);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // ===== PBX health webhook (HMAC-signed). A VPS cron POSTs the box's health
    // (disk/memory/load/lines/trunk/recordings/fail2ban) every few minutes so the
    // CRM keeps trend history + can alert even when nobody has the dashboard open.
    if (req.method === "POST" && path === "webhook/pbx-health") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`pbx-health:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let h: any;
      try { h = JSON.parse(rawBody); } catch { return json({ error: "bad json" }, 400); }
      const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
      const { error } = await adminClient.from("pbx_health_snapshots").insert({
        captured_at: new Date().toISOString(),
        pbx_reachable: h?.ok !== false,
        disk_pct: num(h?.disk?.pct),
        rec_bytes: num(h?.disk?.rec_bytes),
        mem_pct: num(h?.mem?.pct),
        load1: num(h?.load?.["1"]),
        asterisk_up: h?.asterisk?.running === true,
        active_lines: num(h?.lines?.active),
        max_lines: num(h?.lines?.max) ?? 10,
        trunk_reachable: h?.trunk?.reachable === true,
        trunk_rtt_ms: num(h?.trunk?.rtt_ms),
        recordings_today: num(h?.recordings_today?.count),
        newest_rec_age_s: num(h?.recordings_today?.newest_age_seconds),
        banned_ips: num(h?.attacks?.banned_count),
        raw: h,
      });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // ===== Call-quality webhook (HMAC-signed). The Asterisk hangup hook posts the
    // hangup cause + RTP stats per call, so problems like one-way audio ("the agent
    // couldn't hear the client") become visible instead of silent. Upsert by uniqueid.
    if (req.method === "POST" && path === "webhook/call-quality") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`call-quality:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let b: any;
      try { b = JSON.parse(rawBody); } catch { return json({ error: "bad json" }, 400); }
      const uniqueid = String(b.uniqueid || "").trim();
      if (!uniqueid) return json({ error: "uniqueid required" }, 400);
      const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
      const rx = num(b.rxcount), tx = num(b.txcount);
      const loss = num(b.packet_loss_pct);
      // One-way audio: media sent but nothing received back, or heavy loss.
      const oneWay = (tx !== null && tx > 0 && rx === 0) || (loss !== null && loss >= 30);
      // Best-effort link to the call_logs row (same phone last-8, nearest time).
      let callLogId: string | null = null;
      const last8 = String(b.dialed || "").replace(/\D/g, "").slice(-8);
      if (last8) {
        const { data: cl } = await adminClient
          .from("call_logs").select("id,started_at,connected_at")
          .ilike("customer_phone", `%${last8}`)
          .order("created_at", { ascending: false }).limit(5);
        const tMs = b.occurred_at ? new Date(b.occurred_at).getTime() : Date.now();
        let best: any = null, bestDiff = 30 * 60 * 1000;
        for (const c of cl || []) {
          const cMs = new Date(c.connected_at || c.started_at || 0).getTime();
          const d = Math.abs(cMs - tMs);
          if (d <= bestDiff) { bestDiff = d; best = c; }
        }
        callLogId = best?.id || null;
      }
      const { error } = await adminClient.from("call_quality").upsert({
        uniqueid,
        call_log_id: callLogId,
        extension: String(b.extension || "").trim() || null,
        direction: String(b.direction || "").trim() || null,
        dialed: String(b.dialed || "").trim() || null,
        hangup_cause: num(b.hangup_cause),
        hangup_cause_txt: String(b.hangup_cause_txt || "").trim() || null,
        jitter_ms: num(b.jitter_ms),
        packet_loss_pct: loss,
        rtt_ms: num(b.rtt_ms),
        rxcount: rx, txcount: tx,
        one_way_audio: oneWay,
        occurred_at: b.occurred_at || null,
      }, { onConflict: "uniqueid" });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // ===== Recording webhook (HMAC-signed). The Asterisk hangup hook posts one
    // row per call keyed by the Asterisk uniqueid — the permanent, deterministic
    // anchor for recording↔call linkage. We upsert it into call_recordings and
    // stamp recording_uniqueid/recording_file onto the matching call_logs row, so
    // the link is stable forever (no re-derivation, no swaps). Idempotent on
    // uniqueid: re-posting the same call just re-affirms the same link.
    if (req.method === "POST" && path === "webhook/recording") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`recording:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let b: any;
      try { b = JSON.parse(rawBody); } catch { return json({ error: "bad json" }, 400); }
      const uniqueid = String(b.uniqueid || "").trim();
      if (!uniqueid) return json({ error: "uniqueid required" }, 400);
      const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
      const ext = String(b.ext || b.extension || "").trim() || null;
      const file = String(b.file || "").trim() || null;
      const dialedLast8 = String(b.dialed || "").replace(/\D/g, "").slice(-8) || null;
      const startEpoch = num(b.start_epoch ?? b.start);
      const endEpoch = num(b.end_epoch ?? b.end);
      const startedAt = startEpoch ? new Date(startEpoch * 1000).toISOString() : (b.started_at || null);
      const endedAt = endEpoch ? new Date(endEpoch * 1000).toISOString() : (b.ended_at || null);
      const duration = num(b.duration_seconds) ?? ((startEpoch && endEpoch) ? Math.max(0, endEpoch - startEpoch) : null);

      // Resolve the agent behind the extension.
      let agentId: string | null = null;
      if (ext) {
        const { data: te } = await adminClient.from("telephony_extensions").select("user_id").eq("extension", ext).maybeSingle();
        agentId = te?.user_id || null;
      }

      // Deterministically link to a call_logs row: same last-8 phone, near in time,
      // matched one-to-one by the shared matcher (end-anchored / interval-overlap).
      let callLogId: string | null = null;
      if (dialedLast8 && (endEpoch || startEpoch)) {
        const anchorMs = (endEpoch || startEpoch)! * 1000;
        const winStart = new Date(anchorMs - 2 * 24 * 3600 * 1000).toISOString();
        const winEnd = new Date(anchorMs + 1 * 24 * 3600 * 1000).toISOString();
        const { data: cands } = await adminClient
          .from("call_logs")
          .select("id,agent_id,customer_phone,started_at,connected_at,ended_at,created_at")
          .ilike("customer_phone", `%${dialedLast8}`)
          .gte("created_at", winStart).lte("created_at", winEnd)
          .limit(50);
        const rec: RecLite = { file: file || undefined, dialed: dialedLast8 || undefined, ext: ext || undefined, mtime: endEpoch || undefined, start: startEpoch || undefined, uniqueid };
        const extMap = ext && agentId ? { [ext]: agentId } : {};
        const matched = matchRecordingsToCalls([rec], (cands || []) as CallLite[], extMap);
        // matched is call.id -> rec; with a single rec there is at most one entry.
        callLogId = matched.size ? [...matched.keys()][0] : null;
      }

      // Persist the recording index row (authority for this uniqueid).
      const { error: recErr } = await adminClient.from("call_recordings").upsert({
        uniqueid,
        ext,
        dialed_last8: dialedLast8,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: duration,
        file,
        size: num(b.size),
        agent_id: agentId,
        call_log_id: callLogId,
      }, { onConflict: "uniqueid" });
      if (recErr) return json({ error: sanitizeDbError(recErr) }, 400);

      // Stamp the link onto the call_logs row. Move the uniqueid off any stale
      // holder first so the unique index is never violated (idempotent re-link).
      if (callLogId && file) {
        await adminClient.from("call_logs")
          .update({ recording_uniqueid: null, recording_file: null })
          .eq("recording_uniqueid", uniqueid).neq("id", callLogId);
        await adminClient.from("call_logs")
          .update({ recording_uniqueid: uniqueid, recording_file: file })
          .eq("id", callLogId);
      }
      return json({ success: true, linked: !!callLogId });
    }

    // Dynamic webhook by slug: POST /api/webhook/:slug
    // ("opencart" is a reserved slug handled by the OpenCart order bridge below.)
    if (req.method === "POST" && segments[0] === "webhook" && segments.length === 2 && segments[1] !== "leads" && segments[1] !== "opencart") {
      const slug = segments[1];
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`slug:${slug}`) || !checkWebhookRateLimit(`ip:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const { data: webhook } = await adminClient
        .from("webhooks")
        .select("id, product_name, status, total_leads")
        .eq("slug", slug)
        .single();
      if (!webhook) return json({ error: "Webhook not found" }, 404);
      if (webhook.status !== "active") return json({ error: "Webhook is disabled" }, 403);

      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let body;
      try { body = parseBody(inboundLeadSchema, JSON.parse(rawBody)); } catch (e: any) { return json({ error: e.message }, 400); }

      const { data: lead, error } = await adminClient
        .from("inbound_leads")
        .insert({
          name: body.name,
          phone: body.phone,
          status: "pending",
          source: body.source || "webhook",
          webhook_id: webhook.id,
          product_name: webhook.product_name,
        })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Increment total_leads
      await adminClient.from("webhooks").update({ total_leads: (webhook.total_leads || 0) + 1 }).eq("id", webhook.id);

      // Auto-create order for this lead
      const { data: order } = await adminClient
        .from("orders")
        .insert({
          product_name: webhook.product_name,
          customer_name: body.name,
          customer_phone: body.phone,
          status: "pending",
          source_type: "inbound_lead",
          inbound_lead_id: lead.id,
        })
        .select("id, display_id")
        .single();

      return json({ success: true, id: lead.id, order_id: order?.id, product: webhook.product_name });
    }

    // ── OPENCART ORDER BRIDGE (HMAC-signed, no Supabase auth) ──
    // POST /api/webhook/opencart — the elyon_crm_bridge OCMOD on naturatherapy.xk
    // pushes every placed order here (and, optionally, qualified abandoned carts).
    // Idempotent: deduped on (external_source, external_order_id) so the live
    // event, the historical import, and status upgrades all upsert one CRM row.
    if (req.method === "POST" && segments[0] === "webhook" && segments.length === 2 && segments[1] === "opencart") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`opencart:${ip}`)) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const rawBody = await req.text();
      if (!(await verifyWebhookSignature(req, rawBody))) {
        return json({ error: "Invalid or missing signature" }, 401);
      }
      let body;
      try { body = parseBody(opencartOrderSchema, JSON.parse(rawBody)); } catch (e: any) { return json({ error: e.message }, 400); }

      const externalSource = (body.source || "naturatherapy.xk").trim();
      const isAbandoned = body.mode === "abandoned";

      // ── Customer name + phone ──
      const fullName = (body.customer_name
        || `${body.first_name || ""} ${body.last_name || ""}`.trim()).trim();
      const phone = normalizeBgPhone(body.phone);

      // Abandoned carts are only kept as leads when we have a real lead: a full
      // name (first + last) AND a complete phone number. Junk is dropped quietly.
      if (isAbandoned) {
        const hasFullName = fullName.split(/\s+/).filter(Boolean).length >= 2;
        const hasFullPhone = !!phone && phone.replace(/\D/g, "").length >= 11; // +383 + ~8 digits (Kosovo). TODO(kosovo): verify threshold
        if (!hasFullName || !hasFullPhone) {
          return json({ success: true, skipped: "abandoned cart missing full name or phone" });
        }
      }
      if (!phone) return json({ error: "Phone is required" }, 400);

      // ── Money: store EUR. Convert if the storefront sent BGN. ──
      const BGN_PER_EUR = 1.95583;
      const toEur = (v: number) =>
        (body.currency || "EUR").toUpperCase() === "BGN" ? Math.round((v / BGN_PER_EUR) * 100) / 100 : v;

      // ── Match line items to the CRM catalogue (by sku/barcode, then name) ──
      const rawItems = body.items || [];
      // Catalogue snapshot for the alias/fuzzy fallback when sku/barcode/exact-name miss.
      const { data: catalogueRows } = await adminClient.from("products").select("id, name, sku, price");
      const catalogue = catalogueRows || [];
      const matchedItems: { product_id: string | null; product_name: string; quantity: number; price_per_unit: number; total_price: number }[] = [];
      for (const it of rawItems) {
        // Storefront bundles ("Brain 4", "Prostatol 3 + Palmetto 1") become one
        // line per real catalogue component, so reports/commissions/stock all see
        // true products. Only when EVERY component SKU resolves — otherwise the
        // line falls through to the normal single-line path unchanged.
        const bundle = it.name ? matchBundle(it.name) : null;
        if (bundle) {
          const comps = bundle.map((b) => ({ ...b, product: catalogue.find((c: any) => c.sku === b.sku) }));
          if (comps.every((c) => c.product)) {
            const lineQty = Number(it.quantity) || 1;
            const lineTotal = Math.round(lineQty * (toEur(Number(it.price) || 0)) * 100) / 100;
            const expanded = comps.map((c) => ({ ...c, compQty: c.qty * lineQty, cataloguePrice: Number(c.product!.price) || 0 }));
            const money = allocateBundlePrice(lineTotal, expanded);
            expanded.forEach((c, i) => matchedItems.push({
              product_id: c.product!.id,
              product_name: c.product!.name || "",
              quantity: c.compQty,
              price_per_unit: money[i].price_per_unit,
              total_price: money[i].total_price,
            }));
            continue;
          }
        }
        // Leading-multiplier marketing names: "3X Curcumactiv (500ml) - сироп…"
        // is 3 packages of one product. Strip the prefix, resolve the base name,
        // multiply the quantity and divide the per-package price so the line
        // total is unchanged. (x / Cyrillic х / ×, case-insensitive.)
        const multi = it.name ? String(it.name).trim().match(/^(\d{1,2})\s*[xх×]\s+(.+)$/i) : null;
        if (multi) {
          const baseKey = multi[2].toLowerCase().trim();
          const exact = catalogue.find((c: any) => (c.name || "").toLowerCase().trim() === baseKey);
          const resolvedId = exact ? exact.id : resolveCatalogueProductId(multi[2], catalogue);
          const prod = exact || (resolvedId ? catalogue.find((c: any) => c.id === resolvedId) : null);
          if (prod) {
            const mult = parseInt(multi[1], 10);
            const lineQty = Number(it.quantity) || 1;
            const lineTotal = Math.round(lineQty * (toEur(Number(it.price) || 0)) * 100) / 100;
            const q = mult * lineQty;
            matchedItems.push({
              product_id: prod.id,
              product_name: prod.name || "",
              quantity: q,
              price_per_unit: Math.round((lineTotal / q) * 100) / 100,
              total_price: lineTotal,
            });
            continue;
          }
        }
        let productId: string | null = null;
        const sku = (it.sku || "").trim();
        if (sku) {
          const { data: bySku } = await adminClient
            .from("products").select("id").eq("sku", sku).limit(1).maybeSingle();
          if (bySku) productId = bySku.id;
          if (!productId) {
            const { data: byBarcode } = await adminClient
              .from("products").select("id").eq("barcode", sku).limit(1).maybeSingle();
            if (byBarcode) productId = byBarcode.id;
          }
        }
        if (!productId && it.name) {
          const { data: byName } = await adminClient
            .from("products").select("id").ilike("name", it.name.trim()).limit(1).maybeSingle();
          if (byName) productId = byName.id;
        }
        // Last resort: alias + fuzzy catalogue match (Cyrillic vs English names,
        // promo suffixes). Keeps Site orders linked so stock decrements on ship.
        if (!productId && it.name) {
          productId = resolveCatalogueProductId(it.name, catalogue);
        }
        const ppu = toEur(Number(it.price) || 0);
        const qty = Number(it.quantity) || 1;

        // Prefer the official warehouse/catalogue name when we successfully matched
        // a product. Keeps one name per product everywhere (insights group by name,
        // so "Curcumactiv" vs "Curcumactiv (500ml)" would otherwise split rows).
        let displayName = it.name.trim();
        if (productId) {
          const cat = catalogue.find((c: any) => c.id === productId);
          if (cat?.name) displayName = cat.name;
        }

        matchedItems.push({
          product_id: productId,
          product_name: displayName,
          quantity: qty,
          price_per_unit: ppu,
          total_price: Math.round(qty * ppu * 100) / 100,
        });
      }

      const computedTotal = matchedItems.reduce((s, i) => s + i.total_price, 0);
      const totalPrice = body.total != null ? toEur(Number(body.total)) : computedTotal;
      const totalQty = matchedItems.reduce((s, i) => s + i.quantity, 0) || 1;
      const productSummary = matchedItems.length
        ? matchedItems.map((i) => i.product_name).join(", ")
        : (isAbandoned ? "Abandoned cart" : "From naturatherapy.xk");

      // source_type drives the UI badge: 'opencart' = a real Site order,
      // 'opencart_abandoned' = an abandoned-cart lead.
      const sourceType = isAbandoned ? "opencart_abandoned" : "opencart";

      const orderRow: Record<string, any> = {
        product_name: productSummary,
        customer_name: fullName || "—",
        customer_phone: phone,
        customer_city: body.city || "",
        customer_address: body.address || "",
        postal_code: body.postal_code || "",
        price: totalPrice,
        quantity: totalQty,
        status: "pending",
        source_type: sourceType,
        external_source: externalSource,
        external_order_id: body.order_id,
        // Keep unassigned so it surfaces in the Assigner for distribution.
        assigned_agent_id: null,
        assigned_agent_name: null,
        assigned_at: null,
      };

      // ── Upsert on the external ref (idempotent) ──
      const { data: existing } = await adminClient
        .from("orders")
        .select("id")
        .eq("external_source", externalSource)
        .eq("external_order_id", body.order_id)
        .maybeSingle();

      let orderId: string;
      let wasNew = false;
      let didWrite = false; // inserted, or refreshed an untouched pending
      if (existing) {
        // Don't clobber an order an agent has already worked: only refresh while
        // it's still an untouched pending. An abandoned→order upgrade still flows
        // through here and flips source_type/product/total.
        const { data: cur } = await adminClient
          .from("orders").select("status, assigned_agent_id").eq("id", existing.id).maybeSingle();
        if (cur && cur.status === "pending" && !cur.assigned_agent_id) {
          await adminClient.from("orders").update(orderRow).eq("id", existing.id);
          await adminClient.from("order_items").delete().eq("order_id", existing.id);
          didWrite = true;
        }
        orderId = existing.id;
      } else {
        const { data: order, error: orderErr } = await adminClient
          .from("orders").insert(orderRow).select("id, display_id").single();
        if (orderErr) return json({ error: sanitizeDbError(orderErr) }, 400);
        orderId = order.id;
        wasNew = true;
        didWrite = true;
      }

      // ── Line items + provenance, only when we actually (re)wrote the order ──
      if (didWrite) {
        if (matchedItems.length) {
          await adminClient.from("order_items").insert(
            matchedItems.map((i) => ({ ...i, order_id: orderId })),
          );
        }

        // Replace the System provenance note so it always reflects the CURRENT
        // state — an abandoned cart that later completes loses its "abandoned"
        // note and gains the real status. Agent-written notes are left intact.
        const noteBits = [
          `Imported from ${externalSource} (OpenCart order #${body.order_id})`,
          isAbandoned ? "ABANDONED CART — checkout not completed" : (body.status_label ? `Status: ${body.status_label}` : ""),
          body.email ? `Email: ${body.email}` : "",
          body.date_added ? `Order date: ${body.date_added}` : "",
          body.comment ? `Customer comment: ${body.comment}` : "",
        ].filter(Boolean);
        await adminClient
          .from("order_notes")
          .delete()
          .eq("order_id", orderId)
          .eq("author_name", "System")
          .ilike("text", "Imported from %");
        await adminClient.from("order_notes").insert({
          order_id: orderId,
          text: noteBits.join("\n"),
          author_id: null,
          author_name: "System",
        });
      }

      if (wasNew) {
        await adminClient.from("order_history").insert({
          order_id: orderId,
          to_status: "pending",
          changed_by: null,
          changed_by_name: "System (naturatherapy.xk)",
        });
      }

      return json({ success: true, order_id: orderId, created: wasNew, mode: body.mode });
    }

    // ── PUBLIC TV LEADERBOARD (token-gated, no Supabase auth) ──
    // Aggregates-only, no PII. Drives the always-on wall screen. The token is
    // validated server-side BEFORE the auth gate so a wall TV needs no login.
    // Returns today's (Europe/Belgrade) per-agent confirmed count, AVG order value,
    // answer rate, and the computed daily game bonus + rank.
    if (req.method === "GET" && path === "leaderboard") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!checkWebhookRateLimit(`leaderboard:${ip}`)) return json({ error: "Rate limit exceeded" }, 429);
      const key = url.searchParams.get("key") || "";
      if (!key) return json({ error: "Unauthorized" }, 401);
      const { data: tok } = await adminClient
        .from("leaderboard_access_tokens")
        .select("id").eq("token", key).eq("is_active", true).maybeSingle();
      if (!tok) return json({ error: "Unauthorized" }, 401);

      // ?mode=prediction|pending. Two different sales motions, different bonuses.
      // Default = prediction (the live motion today; pendings aren't flowing yet).
      const mode = url.searchParams.get("mode") === "pending" ? "pending" : "prediction";
      // ?day=YYYY-MM-DD lets the TV page browse previous days; default = today (Sofia).
      const { day, today, startISO, endISO } = sofiaDayRange(url.searchParams.get("day") || "");
      const isToday = day === today;

      // Roster + bonus rules are per-mode. Roster (if set) is an exact whitelist.
      const { data: rosterRows } = await adminClient
        .from("leaderboard_roster").select("agent_id").eq("roster_date", day).eq("mode", mode);
      const rosterIds = new Set((rosterRows || []).map((r: any) => r.agent_id));

      // Eligible call-agents; admins/managers are shown but never earn.
      const { data: agentRoleRows } = await adminClient
        .from("user_roles").select("user_id").in("role", ["agent", "pending_agent", "prediction_agent", "inbound_agent"]);
      const agentRoleIds = new Set((agentRoleRows || []).map((r: any) => r.user_id));
      const { data: superRoles } = await adminClient
        .from("user_roles").select("user_id").in("role", ["admin", "manager"]);
      const superIds = new Set((superRoles || []).map((r: any) => r.user_id));

      const { data: ruleRows } = await adminClient
        .from("leaderboard_bonus_rules").select("metric,tiers,is_active").eq("mode", mode);
      const rules: Record<string, { tiers: any[]; is_active: boolean }> = {};
      for (const r of ruleRows || []) rules[r.metric] = { tiers: r.tiers || [], is_active: !!r.is_active };

      // Orders confirmed that day, scoped to the mode's source:
      //  • prediction = cold lists (prediction_list_id set OR source_type=prediction_lead)
      //  • pending    = warm inbound orders the customer placed (inbound_lead / opencart)
      let oq = adminClient.from("orders")
        .select("id,status,price,quantity,confirmed_by_agent_id,confirmed_by_name,assigned_agent_id,assigned_agent_name,confirmed_at,order_items(price_per_unit,quantity)")
        .gte("confirmed_at", startISO).lt("confirmed_at", endISO)
        .in("status", REAL_ORDER_STATUSES);
      oq = mode === "prediction"
        ? oq.or("prediction_list_id.not.is.null,source_type.eq.prediction_lead")
        : oq.in("source_type", ["inbound_lead", "opencart"]);
      const { data: orders } = await oq;

      // Calls scoped to the motion via context_type.
      const { data: calls } = await adminClient
        .from("call_logs").select("agent_id")
        .gte("created_at", startISO).lt("created_at", endISO)
        .eq("context_type", mode === "prediction" ? "prediction_lead" : "order");

      const { data: logins } = await adminClient
        .from("shift_login_logs").select("user_id").eq("shift_date", day);

      const activeIds = new Set<string>();
      for (const o of orders || []) { const id = salesOwnerId(o); if (id) activeIds.add(id); }
      for (const c of calls || []) { if (c.agent_id) activeIds.add(c.agent_id); }
      for (const l of logins || []) { if (l.user_id) activeIds.add(l.user_id); }

      let displayIds: string[];
      if (rosterIds.size > 0) displayIds = [...rosterIds];
      else displayIds = [...activeIds].filter((id) => agentRoleIds.has(id) || superIds.has(id));
      const display = new Set(displayIds);

      const nameById: Record<string, string> = {};
      if (displayIds.length) {
        const { data: profs } = await adminClient.from("profiles").select("user_id,full_name").in("user_id", displayIds);
        for (const p of profs || []) nameById[p.user_id] = p.full_name;
      }

      type Agg = { user_id: string; full_name: string; confirmed_count: number; total_price: number; packages: number; package_bonus: number; calls: number };
      const agg: Record<string, Agg> = {};
      for (const id of displayIds) agg[id] = { user_id: id, full_name: nameById[id] || "Agent", confirmed_count: 0, total_price: 0, packages: 0, package_bonus: 0, calls: 0 };

      for (const o of orders || []) {
        const id = salesOwnerId(o);
        if (!id || !display.has(id)) continue;
        const a = agg[id];
        if (a.full_name === "Agent") a.full_name = salesOwnerName(o) || a.full_name;
        if (o.status === "returned") continue; // returns reverse themselves
        a.confirmed_count++;
        a.total_price += Number(o.price || 0);
        const its = o.order_items || [];
        a.packages += its.length ? its.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0) : (Number(o.quantity || 0) || 1);
        a.package_bonus += its.length
          ? its.reduce((s: number, it: any) => s + packageBonusRate(Number(it.price_per_unit || 0)) * Number(it.quantity || 0), 0)
          : packageBonusRate(Number(o.price || 0) / Math.max(1, Number(o.quantity || 0) || 1)) * (Number(o.quantity || 0) || 1);
      }
      for (const c of calls || []) { const id = c.agent_id; if (id && display.has(id)) agg[id].calls++; }

      const tiersFor = (m: string) => (rules[m]?.is_active ? rules[m].tiers : []);
      const targetTiers = tiersFor("revenue_target");
      const topTarget = targetTiers.reduce((mx: number, t: any) => Math.max(mx, Number(t?.min) || 0), 0);

      // PREDICTION targets are a TEAM total per day (not per-agent). Compute the
      // team's combined revenue (non-super agents) once; the team-tier bonus is
      // shared — every active agent earns it when the TEAM reaches a target.
      let teamRevenueRaw = 0;
      for (const a of Object.values(agg)) if (!superIds.has(a.user_id)) teamRevenueRaw += a.total_price;
      const teamRevenue = Math.round(teamRevenueRaw * 100) / 100;
      const teamTargetBonus = mode === "prediction" ? tierBonus(teamRevenue, targetTiers) : 0;
      const teamTargetPct = topTarget > 0 ? Math.round((teamRevenue / topTarget) * 1000) / 10 : 0;

      const agents = Object.values(agg).map((a) => {
        const confirmed = a.confirmed_count; // net of returns
        const avg = confirmed > 0 ? Math.round((a.total_price / confirmed) * 100) / 100 : 0;
        const revenue = Math.round(a.total_price * 100) / 100;
        const soldRate = a.calls > 0 ? Math.round((confirmed / a.calls) * 1000) / 10 : 0;
        const pkg = Math.round(a.package_bonus * 100) / 100; // already reversed for returns
        const isSuper = superIds.has(a.user_id);
        let total = 0; let breakdown: Record<string, number>;
        if (mode === "prediction") {
          // Cold lists: per-package + a SHARED team-target bonus (the team total
          // reaching €1500/€2500/€4000). No conversion/avg bonus on cold calls.
          total = isSuper ? 0 : Math.round((pkg + teamTargetBonus) * 100) / 100;
          breakdown = isSuper ? { package: 0, target: 0 } : { package: pkg, target: teamTargetBonus };
        } else {
          // Warm pendings: per-package + confirmed milestones + avg (10+ orders gate).
          const volume = tierBonus(confirmed, tiersFor("confirmed_count"));
          const avgBonus = confirmed >= 10 ? tierBonus(avg, tiersFor("avg_order_value")) : 0;
          total = isSuper ? 0 : Math.round((pkg + volume + avgBonus) * 100) / 100;
          breakdown = isSuper ? { package: 0, volume: 0, avg: 0 } : { package: pkg, volume, avg: avgBonus };
        }
        return {
          user_id: a.user_id, full_name: a.full_name, is_super: isSuper,
          confirmed_count: confirmed, packages: a.packages,
          avg_order_value: avg, revenue, target_pct: teamTargetPct, sold_rate: soldRate, calls: a.calls,
          bonus: total, bonus_breakdown: breakdown,
        };
      });
      if (mode === "prediction") agents.sort((x, y) => y.revenue - x.revenue || y.bonus - x.bonus);
      else agents.sort((x, y) => y.bonus - x.bonus || y.confirmed_count - x.confirmed_count || y.avg_order_value - x.avg_order_value);
      const ranked = agents.map((a, i) => ({ ...a, rank: i + 1 }));

      return json({
        generated_at: new Date().toISOString(), mode, day, today, is_today: isToday,
        target: topTarget, team_revenue: teamRevenue, team_target_pct: teamTargetPct, team_target_bonus: teamTargetBonus,
        agents: ranked,
      });
    }

    // Verify auth using getClaims for signing-keys compatibility
    const token = (authHeader || "").replace("Bearer ", "");
    if (!token) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: claimsData, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const user = { id: claimsData.claims.sub as string, email: (claimsData.claims.email as string) || "" };

    // Get user roles (support multiple roles)
    const { data: roleRows } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    const isAdmin = roles.includes("admin");
    const isManager = roles.includes("manager");
    const isAgent = roles.includes("agent") || roles.includes("pending_agent") || roles.includes("prediction_agent") || roles.includes("inbound_agent");
    const isWarehouse = roles.includes("warehouse");
    const isAdsAdmin = roles.includes("ads_admin");
    const isAdminOrManager = isAdmin || isManager;
    const isInboundAgent = roles.includes("inbound_agent");
    const isDualRole = isAdmin && isAgent;

    // The edge function now ENFORCES the same role_permissions + role_privacy that
    // the Settings UI writes (it used to be frontend-only). Admin-first, fail-safe
    // deny. Two tiny indexed lookups, same cost profile as the user_roles fetch.
    const [rpRes, privRes] = await Promise.all([
      adminClient.from("role_permissions").select("module_key, can_view, can_edit").in("role", roles.length ? roles : ["__none__"]),
      adminClient.from("role_privacy").select("show_customer_phone, show_customer_name, show_customer_address, show_order_history, show_segment_members, can_hear_recordings, can_hear_own_recordings").in("role", roles.length ? roles : ["__none__"]),
    ]);
    const rpRows = rpRes.data || [];
    const privRows = privRes.data || [];
    const canViewModule = (m: string) => isAdmin || rpRows.some((r: any) => r.module_key === m && r.can_view);
    const canEditModule = (m: string) => isAdmin || rpRows.some((r: any) => r.module_key === m && r.can_edit);
    // Operational roles keep their existing order-write access (RLS scopes them);
    // managers/ads_admin are read-only unless the orders.can_edit toggle is on.
    const canMutateOrders = isAdmin || isAgent || isWarehouse || canEditModule("orders");
    const privCan = (flag: string) => isAdmin || privRows.some((r: any) => r[flag] === true);
    const piiFlags: PiiFlags = { name: privCan("show_customer_name"), phone: privCan("show_customer_phone"), addr: privCan("show_customer_address") };
    const showOrderHistory = privCan("show_order_history");
    const showSegmentMembers = privCan("show_segment_members");
    const canHearRecordings = privCan("can_hear_recordings");          // hear ALL recordings (admin/manager/inbound_agent)
    const canHearOwnRecordings = privCan("can_hear_own_recordings");   // hear ONLY recordings attached to your own calls

    // ============================================================
    // ROUTING
    // ============================================================

    // ── TV LEADERBOARD ADMIN (roster / bonus rules / access tokens) ──
    // Admin/manager only. The public board is the separate token-gated
    // GET /api/leaderboard handler above (before the auth gate).
    if (path === "leaderboard/admin" && req.method === "GET") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const mode = url.searchParams.get("mode") === "pending" ? "pending" : "prediction";
      const { day } = sofiaDayStart();
      const [rosterRes, rulesRes, tokRes] = await Promise.all([
        adminClient.from("leaderboard_roster").select("agent_id").eq("roster_date", day).eq("mode", mode),
        adminClient.from("leaderboard_bonus_rules").select("metric,tiers,is_active").eq("mode", mode).order("metric"),
        adminClient.from("leaderboard_access_tokens").select("id,label,token,is_active,created_at").order("created_at", { ascending: false }),
      ]);
      return json({
        mode, roster_date: day,
        roster: (rosterRes.data || []).map((r: any) => r.agent_id),
        rules: rulesRes.data || [],
        tokens: tokRes.data || [],
      });
    }

    if (path === "leaderboard/roster" && req.method === "POST") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const mode = body?.mode === "pending" ? "pending" : "prediction";
      const ids: string[] = Array.isArray(body?.agent_ids) ? body.agent_ids.filter((x: any) => typeof x === "string") : [];
      const { day } = sofiaDayStart();
      await adminClient.from("leaderboard_roster").delete().eq("roster_date", day).eq("mode", mode);
      if (ids.length) {
        const rows = ids.map((agent_id) => ({ roster_date: day, mode, agent_id, added_by: user.id }));
        const { error } = await adminClient.from("leaderboard_roster").insert(rows);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
      }
      return json({ success: true, roster_date: day, mode, roster: ids });
    }

    if (path === "leaderboard/rules" && req.method === "POST") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const mode = body?.mode === "pending" ? "pending" : "prediction";
      const metric = String(body?.metric || "");
      if (!["confirmed_count", "avg_order_value", "conversion_rate", "revenue_target"].includes(metric)) return json({ error: "Invalid metric" }, 400);
      const tiers = Array.isArray(body?.tiers)
        ? body.tiers.map((t: any) => ({ min: Number(t?.min) || 0, bonus: Number(t?.bonus) || 0 }))
        : [];
      const is_active = body?.is_active !== false;
      const { error } = await adminClient.from("leaderboard_bonus_rules")
        .upsert({ metric, mode, tiers, is_active, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: "mode,metric" });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    if (path === "leaderboard/token" && req.method === "POST") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body: any; try { body = await req.json(); } catch { body = {}; }
      const action = String(body?.action || "create");
      if (action === "revoke") {
        const id = String(body?.id || "");
        if (!id) return json({ error: "id required" }, 400);
        await adminClient.from("leaderboard_access_tokens").update({ is_active: false }).eq("id", id);
        return json({ success: true });
      }
      if (action === "rotate") {
        await adminClient.from("leaderboard_access_tokens").update({ is_active: false }).eq("is_active", true);
      }
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const label = (typeof body?.label === "string" && body.label.trim()) ? body.label.trim().slice(0, 80) : "TV";
      const { data, error } = await adminClient.from("leaderboard_access_tokens")
        .insert({ token, label, is_active: true, created_by: user.id })
        .select("id,label,token,is_active,created_at").single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true, token: data });
    }

    // GET /api/voip/credentials — returns ONLY the caller's OWN SIP extension +
    // secret (never anyone else's). Auto-assigns the lowest free pool extension
    // on first use. This replaces the shared, hardcoded extension/secret that
    // used to ship in the JS bundle, and lets every account register as its own
    // line (concurrent calls are still capped at 4 by the A1 trunk).
    if (req.method === "GET" && path === "voip/credentials") {
      let { data: mine } = await adminClient
        .from("telephony_extensions")
        .select("extension, sip_secret, primary_caller_id, secondary_caller_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!mine) {
        // Atomically claim the lowest free pool extension. The `.is(user_id,null)`
        // guard on UPDATE makes concurrent claims safe (loser retries).
        for (let attempt = 0; attempt < 8 && !mine; attempt++) {
          const { data: free } = await adminClient
            .from("telephony_extensions")
            .select("extension")
            .is("user_id", null)
            .order("extension", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!free) break; // pool exhausted
          const { data: claimed } = await adminClient
            .from("telephony_extensions")
            .update({ user_id: user.id, label: user.email || "agent" })
            .eq("extension", free.extension)
            .is("user_id", null)
            .select("extension, sip_secret, primary_caller_id, secondary_caller_id")
            .maybeSingle();
          if (claimed) mine = claimed;
        }
      }

      if (!mine) {
        return json({ error: "No phone extension available — ask an admin to add more lines." }, 409);
      }

      return json({
        extension: mine.extension,
        secret: mine.sip_secret,
        ws_url: "wss://pbx.elyoncall.com/ws",
        // Main green Dial uses primary (default the .100 local for everyone).
        primary_caller_id: mine.primary_caller_id || "+35924234100",
        // Topbar "Dial new number" uses secondary — an owned MOBILE by default so
        // ad-hoc outreach shows a mobile, not the office line. Per-agent override
        // wins when set; otherwise this global mobile default applies.
        secondary_caller_id: mine.secondary_caller_id || "+359882040529",
      });
    }

    // ===== Recordings (admin/manager only) — list + on-demand signed stream URLs.
    // Audio streams straight from the PBX recordings service via a short-lived
    // HMAC-signed URL (no byte-proxying through the function). The HMAC secret is
    // shared with /etc/asterisk/elyon-rec.key (env REC_SHARED_SECRET).
    const recSign = async (payload: string, exp: number): Promise<string> => {
      const secret = Deno.env.get("REC_SHARED_SECRET") || "";
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const b = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${payload}|${exp}`)));
      return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    };
    const REC_HOST = "https://pbx.elyoncall.com/elyon-rec.php";

    // True iff `file` is provably one of THIS user's own recordings — used to gate
    // the own-scoped agent path (can_hear_own_recordings) without ever exposing
    // another agent's audio. Anything not provably theirs → false (fail-closed).
    //
    // PRIMARY signal is the recording's EXTENSION: every MixMonitor filename is
    // out-<HHMMSS>-<ext>-<cid>-to-<dialed>-<uniqueid>.wav, and ext ↔ agent is 1:1
    // (telephony_extensions.user_id UNIQUE). This is the ground truth that the
    // call was made on the agent's own line, and — crucially — it works for the
    // common same-day case where the recording hasn't been anchored into
    // call_recordings / call_logs yet (recording_file still NULL; the row is
    // matched live at read-time). The anchored DB authorities are kept as
    // fallbacks for any non-standard filename.
    const agentOwnsRecording = async (file: string, userId: string): Promise<boolean> => {
      if (!file) return false;
      const base = (file.split("/").pop() || "");
      const extMatch = base.match(/^out-\d{6}-(\d+)-/);
      const ext = extMatch ? extMatch[1] : null;
      if (ext) {
        const { data: te } = await adminClient.from("telephony_extensions").select("user_id").eq("extension", ext).maybeSingle();
        if (te?.user_id === userId) return true;
      }
      const [recRes, logRes] = await Promise.all([
        adminClient.from("call_recordings").select("agent_id").eq("file", file),
        adminClient.from("call_logs").select("id").eq("recording_file", file).eq("agent_id", userId).limit(1),
      ]);
      if ((recRes.data || []).some((r: any) => r.agent_id === userId)) return true;
      if ((logRes.data || []).length > 0) return true;
      return false;
    };

    // GET /api/recordings — list recordings, ENRICHED with the matching call log
    // (agent name, customer name, outcome, exact call time). The PBX filename only
    // has the dialed number + time; we match it to a call_logs row by dialed number
    // (last 8 digits) + nearest call time (±20 min).
    if (req.method === "GET" && path === "recordings") {
      if (!canHearRecordings && !canHearOwnRecordings) return json({ error: "Forbidden" }, 403);
      const exp = Math.floor(Date.now() / 1000) + 120;
      const sig = await recSign("list", exp);
      let recordings: any[] = [];
      try {
        const r = await fetch(`${REC_HOST}?mode=list&exp=${exp}&sig=${sig}`);
        if (!r.ok) return json({ error: "Recordings service error" }, 502);
        recordings = await r.json();
      } catch (_e) {
        return json({ error: "Recordings service unavailable" }, 502);
      }

      // Own-scoped agents (can_hear_own_recordings, NOT hear-all): keep only
      // recordings made on their own extension(s) before enrichment. The audio
      // endpoint re-verifies ownership before signing any URL — this is just so
      // an own-scoped caller never even sees another agent's recording metadata.
      if (!canHearRecordings) {
        const { data: myExts } = await adminClient.from("telephony_extensions").select("extension").eq("user_id", user.id);
        const mine = new Set((myExts || []).map((x: any) => x.extension).filter(Boolean));
        recordings = recordings.filter((r: any) => r.ext && mine.has(r.ext));
      }

      const since = new Date(Date.now() - 95 * 24 * 3600 * 1000).toISOString();
      const { data: logs } = await adminClient
        .from("call_logs")
        .select("id,agent_id,customer_phone,started_at,connected_at,ended_at,context_type,context_id,outcome")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(8000);
      // Agent behind each recording extension (keeps two agents who called the
      // same number apart in the deterministic matcher).
      const recExts = [...new Set(recordings.map((r: any) => r.ext).filter(Boolean))];
      const extToAgent: Record<string, string> = {};
      if (recExts.length) {
        const { data: te } = await adminClient.from("telephony_extensions").select("extension,user_id").in("extension", recExts);
        for (const x of te || []) if (x.extension && x.user_id) extToAgent[x.extension] = x.user_id;
      }
      // Deterministic one-to-one matching (end-anchored / interval-overlap) — the
      // same matcher Call History uses, so no long-call misses or swaps here either.
      const callToRec = matchRecordingsToCalls(recordings as RecLite[], (logs || []) as CallLite[], extToAgent);
      const logById = new Map<string, any>((logs || []).map((l: any) => [l.id, l] as [string, any]));
      const recFileToLog = new Map<string, any>();
      for (const [callId, rec] of callToRec) if (rec.file) recFileToLog.set(rec.file, logById.get(callId) || null);
      const matches = recordings.map((rec: any) => ({ rec, log: rec.file ? (recFileToLog.get(rec.file) || null) : null }));
      const agentIds = [...new Set(matches.filter((m) => m.log).map((m) => m.log.agent_id))];
      const orderIds = [...new Set(matches.filter((m) => m.log?.context_type === "order").map((m) => m.log.context_id))];
      const leadIds = [...new Set(matches.filter((m) => m.log?.context_type === "prediction_lead").map((m) => m.log.context_id))];
      const agentMap: Record<string, string> = {};
      if (agentIds.length) { const { data: p } = await adminClient.from("profiles").select("user_id,full_name").in("user_id", agentIds); for (const x of p || []) agentMap[x.user_id] = x.full_name; }
      const orderMap: Record<string, any> = {};
      if (orderIds.length) { const { data: o } = await adminClient.from("orders").select("id,customer_name,customer_phone").in("id", orderIds); for (const x of o || []) orderMap[x.id] = x; }
      const leadMap: Record<string, any> = {};
      if (leadIds.length) { const { data: l2 } = await adminClient.from("prediction_leads").select("id,name,telephone").in("id", leadIds); for (const x of l2 || []) leadMap[x.id] = x; }
      const enriched = matches.map(({ rec, log }) => {
        let agent_name: string | null = null, customer_name: string | null = null, customer_phone: string | null = null, outcome: string | null = null, call_at: string | null = null;
        if (log) {
          agent_name = agentMap[log.agent_id] || null;
          outcome = log.outcome || null;
          call_at = log.connected_at || log.started_at || null;
          if (log.context_type === "order") { const o = orderMap[log.context_id]; customer_name = o?.customer_name || null; customer_phone = o?.customer_phone || log.customer_phone || null; }
          else if (log.context_type === "prediction_lead") { const l3 = leadMap[log.context_id]; customer_name = l3?.name || null; customer_phone = l3?.telephone || log.customer_phone || null; }
          else { customer_phone = log.customer_phone || null; }
        }
        return { ...rec, agent_name, customer_name, customer_phone, outcome, call_at };
      });
      return json({ recordings: enriched });
    }

    // GET /api/recordings/audio?file=YYYY/MM/DD/x.wav — short-lived signed URL the
    // browser uses directly (play/download). Audio never passes through the function.
    if (req.method === "GET" && path === "recordings/audio") {
      if (!canHearRecordings && !canHearOwnRecordings) return json({ error: "Forbidden" }, 403);
      const file = url.searchParams.get("file") || "";
      if (!/^\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._+\-]+\.wav$/.test(file)) return json({ error: "bad file" }, 400);
      // Own-scoped agents may only obtain a URL for a recording attached to one of
      // THEIR OWN calls. This is the hard boundary — the PBX signs whatever this
      // endpoint authorizes, so a crafted/guessed foreign file path is denied here.
      if (!canHearRecordings && !(await agentOwnsRecording(file, user.id))) return json({ error: "Forbidden" }, 403);
      const exp = Math.floor(Date.now() / 1000) + 300;
      const sig = await recSign(file, exp);
      return json({ url: `${REC_HOST}?file=${encodeURIComponent(file)}&exp=${exp}&sig=${sig}` });
    }

    // ============================================================
    // VOIP / TELEPHONY HEALTH (superadmin only)
    // The PBX/VPS has no presence in the CRM today; these endpoints give the
    // superadmin live server + line + trunk + recording + call-quality visibility,
    // trends, and an incidents[] feed for the in-CRM alert banner.
    // ============================================================
    const HEALTH_HOST = "https://pbx.elyoncall.com/elyon-health.php";

    // Pull the PBX's live health JSON (HMAC-signed; same scheme as recordings).
    const fetchPbxHealth = async (): Promise<any> => {
      const exp = Math.floor(Date.now() / 1000) + 60;
      const sig = await recSign("health", exp);
      try {
        const r = await fetch(`${HEALTH_HOST}?mode=health&exp=${exp}&sig=${sig}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { ok: false, error: `pbx ${r.status}` };
        return await r.json();
      } catch (_e) {
        return { ok: false, error: "unreachable" };
      }
    };

    // Recording filenames carry only the dialed number + time; match to call_logs
    // by last-8 digits within ±20 min (the same rule Call History uses). Files
    // under 2 KB are failed/empty recordings — drop them.
    const fetchRecordingsList = async (): Promise<any[]> => {
      const exp = Math.floor(Date.now() / 1000) + 120;
      const sig = await recSign("list", exp);
      try {
        const r = await fetch(`${REC_HOST}?mode=list&exp=${exp}&sig=${sig}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return [];
        const arr = await r.json();
        return Array.isArray(arr) ? arr.filter((x: any) => (x.size || 0) > 2000) : [];
      } catch (_e) { return []; }
    };

    // GET /api/voip/health — live PBX pull + today's DB-derived call/recording/
    // quality stats + computed incidents[] (drives the page AND the alert banner).
    if (req.method === "GET" && path === "voip/health") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const sinceIso = dayStart.toISOString();

      const [pbx, recs, logsRes, qualRes, lastSnapRes] = await Promise.all([
        fetchPbxHealth(),
        fetchRecordingsList(),
        adminClient.from("call_logs")
          .select("id,customer_phone,started_at,connected_at,ended_at,connection_state,total_seconds,outcome")
          .gte("created_at", sinceIso).limit(5000),
        adminClient.from("call_quality")
          .select("one_way_audio,packet_loss_pct,hangup_cause").gte("captured_at", sinceIso).limit(5000),
        adminClient.from("pbx_health_snapshots").select("captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const logs = logsRes.data || [];
      const quals = qualRes.data || [];

      const answered = logs.filter((l: any) => l.connection_state === "answered" || l.connected_at);
      const outboundSeconds = logs.reduce((s: number, l: any) => s + (l.total_seconds || 0), 0);

      // Recording coverage: answered calls today with NO matched recording. Uses
      // the same deterministic one-to-one matcher as Call History, so long calls
      // are no longer mislabelled "unrecorded".
      const matchedToday = matchRecordingsToCalls(recs as RecLite[], answered as CallLite[]);
      const answeredCount = answered.length;
      const recordedCount = answered.filter((l: any) => matchedToday.has(l.id)).length;
      const coveragePct = answeredCount ? Math.round((recordedCount / answeredCount) * 100) : 100;
      const oneWayToday = quals.filter((q: any) => q.one_way_audio).length;

      // Incidents (thresholds) → banner + Issues tab.
      const incidents: { level: "critical" | "warning"; code: string; message: string }[] = [];
      if (pbx?.ok === false) incidents.push({ level: "critical", code: "pbx_unreachable", message: "PBX health endpoint unreachable" });
      if (pbx?.trunk && pbx.trunk.reachable === false) incidents.push({ level: "critical", code: "trunk_down", message: "A1 trunk unreachable — outbound calling is down" });
      const diskPct = Number(pbx?.disk?.pct);
      if (!isNaN(diskPct) && diskPct >= 85) incidents.push({ level: diskPct >= 92 ? "critical" : "warning", code: "disk_high", message: `Disk ${diskPct}% full` });
      const memPct = Number(pbx?.mem?.pct);
      if (!isNaN(memPct) && memPct >= 92) incidents.push({ level: "warning", code: "mem_high", message: `Memory ${memPct}% used` });
      if (pbx?.asterisk && pbx.asterisk.running === false) incidents.push({ level: "critical", code: "asterisk_down", message: "Asterisk is not running" });
      const newestAge = Number(pbx?.recordings_today?.newest_age_seconds);
      const hr = new Date().getHours();
      if (!isNaN(newestAge) && hr >= 9 && hr < 19 && newestAge > 3 * 3600) incidents.push({ level: "warning", code: "recordings_stalled", message: "No new recording in 3h during working hours" });
      const banned = Number(pbx?.attacks?.banned_count);
      if (!isNaN(banned) && banned >= 10) incidents.push({ level: "warning", code: "attacks", message: `${banned} IPs currently banned (fail2ban)` });
      if (answeredCount >= 10 && coveragePct < 80) incidents.push({ level: "warning", code: "low_coverage", message: `Only ${coveragePct}% of answered calls recorded today` });
      if (oneWayToday > 0) incidents.push({ level: "warning", code: "one_way_audio", message: `${oneWayToday} call(s) with one-way audio today` });

      return json({
        pbx,
        snapshot_age_seconds: lastSnapRes.data ? Math.round((Date.now() - new Date(lastSnapRes.data.captured_at).getTime()) / 1000) : null,
        today: {
          calls: logs.length,
          answered: answeredCount,
          no_answer: logs.filter((l: any) => l.connection_state === "no_answer").length,
          outbound_minutes: Math.round(outboundSeconds / 60),
          recording_coverage_pct: coveragePct,
          answered_recorded: recordedCount,
          answered_unrecorded: answeredCount - recordedCount,
          one_way_audio: oneWayToday,
        },
        incidents,
      });
    }

    // GET /api/voip/health/history?range=24h|7d|30d — trend series from snapshots.
    if (req.method === "GET" && path === "voip/health/history") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const range = url.searchParams.get("range") || "24h";
      const hours = range === "30d" ? 720 : range === "7d" ? 168 : 24;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { data } = await adminClient
        .from("pbx_health_snapshots")
        .select("captured_at,disk_pct,mem_pct,load1,active_lines,trunk_reachable,recordings_today,banned_ips,rec_bytes")
        .gte("captured_at", since).order("captured_at", { ascending: true }).limit(5000);
      return json({ snapshots: data || [] });
    }

    // GET /api/voip/recording-coverage?range=7d — the GAP LIST: answered calls
    // with NO recording, each tagged with the likely reason. Answers "why are
    // some calls not recorded".
    if (req.method === "GET" && path === "voip/recording-coverage") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const range = url.searchParams.get("range") || "7d";
      const days = range === "30d" ? 30 : range === "24h" ? 1 : 7;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const [recs, logsRes] = await Promise.all([
        fetchRecordingsList(),
        adminClient.from("call_logs")
          .select("id,agent_id,customer_phone,started_at,connected_at,ended_at,connection_state,outcome")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
      ]);
      const logs = logsRes.data || [];
      const byPhone: Record<string, any[]> = {};
      for (const r of recs) {
        const p = String(r.dialed || "").replace(/\D/g, "").slice(-8);
        if (p) (byPhone[p] = byPhone[p] || []).push(r);
      }
      const answered = logs.filter((l: any) => l.connection_state === "answered" || l.connected_at);
      // Deterministic one-to-one matcher decides "recorded"; byPhone is only used
      // to classify WHY an unmatched call has no recording.
      const matchedGap = matchRecordingsToCalls(recs as RecLite[], answered as CallLite[]);
      const gaps: any[] = [];
      let recorded = 0;
      for (const l of answered) {
        if (matchedGap.has(l.id)) { recorded++; continue; }
        const p = String(l.customer_phone || "").replace(/\D/g, "").slice(-8);
        const cands = (p && byPhone[p]) || [];
        let reason = "no_recording_on_pbx";
        if (!p) reason = "unmatchable_phone";
        else if (cands.length) reason = "outside_time_window"; // a recording for this number exists but didn't match this call
        gaps.push({ id: l.id, agent_id: l.agent_id, customer_phone: l.customer_phone, call_at: l.connected_at || l.started_at, outcome: l.outcome, reason });
      }
      const agentIds = [...new Set(gaps.map((g) => g.agent_id).filter(Boolean))];
      const amap: Record<string, string> = {};
      if (agentIds.length) { const { data } = await adminClient.from("profiles").select("user_id,full_name").in("user_id", agentIds); for (const a of data || []) amap[a.user_id] = a.full_name; }
      for (const g of gaps) g.agent_name = amap[g.agent_id] || null;
      return json({
        answered: answered.length, recorded, unrecorded: gaps.length,
        coverage_pct: answered.length ? Math.round((recorded / answered.length) * 100) : 100,
        gaps: gaps.slice(0, 200),
      });
    }

    // GET /api/voip/minutes?range=7d&group=agent|day — outbound minutes from our
    // own call telemetry (the authoritative A1 figure comes from A1's portal).
    if (req.method === "GET" && path === "voip/minutes") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const range = url.searchParams.get("range") || "7d";
      const group = url.searchParams.get("group") || "day";
      const days = range === "30d" ? 30 : range === "24h" ? 1 : 7;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const { data: logs } = await adminClient.from("call_logs")
        .select("agent_id,total_seconds,talk_seconds,started_at,connected_at")
        .gte("created_at", since).limit(20000);
      const rows = logs || [];
      const totalSeconds = rows.reduce((s: number, l: any) => s + (l.total_seconds || 0), 0);
      const talkSeconds = rows.reduce((s: number, l: any) => s + (l.talk_seconds || 0), 0);
      const buckets: Record<string, number> = {};
      if (group === "agent") {
        for (const l of rows) { const k = l.agent_id || "unknown"; buckets[k] = (buckets[k] || 0) + (l.total_seconds || 0); }
        const ids = Object.keys(buckets).filter((k) => k !== "unknown");
        const amap: Record<string, string> = {};
        if (ids.length) { const { data } = await adminClient.from("profiles").select("user_id,full_name").in("user_id", ids); for (const a of data || []) amap[a.user_id] = a.full_name; }
        const series = Object.entries(buckets).map(([k, v]) => ({ key: amap[k] || k, minutes: Math.round(v / 60) })).sort((a, b) => b.minutes - a.minutes);
        return json({ total_minutes: Math.round(totalSeconds / 60), talk_minutes: Math.round(talkSeconds / 60), group, series });
      }
      for (const l of rows) { const d = (l.started_at || l.connected_at || "").slice(0, 10) || "unknown"; buckets[d] = (buckets[d] || 0) + (l.total_seconds || 0); }
      const series = Object.entries(buckets).map(([k, v]) => ({ key: k, minutes: Math.round(v / 60) })).sort((a, b) => a.key.localeCompare(b.key));
      return json({ total_minutes: Math.round(totalSeconds / 60), talk_minutes: Math.round(talkSeconds / 60), group: "day", series });
    }

    // ===== Per-agent caller-ID (superadmin) — default +35924234100 for everyone;
    // admins can assign any owned DID to an agent. Stored in telephony_extensions;
    // a 2-min PBX sync applies it (predial hook presents it, whitelisted).
    const OWNED_DIDS: { value: string; label: string }[] = [
      { value: "+35924234100", label: "02 423 4100 — Sofia (default)" },
      { value: "+35924232487", label: "02 423 2487 — Sofia" },
      { value: "+35924236423", label: "02 423 6423 — Sofia" },
      { value: "+35924236975", label: "02 423 6975 — Sofia" },
      { value: "+35924237082", label: "02 423 7082 — Sofia" },
      { value: "+35924238192", label: "02 423 8192 — Sofia" },
      { value: "+35924238345", label: "02 423 8345 — Sofia" },
      { value: "+35924238863", label: "02 423 8863 — Sofia" },
      { value: "+35924239172", label: "02 423 9172 — Sofia" },
      { value: "+35924239675", label: "02 423 9675 — Sofia" },
      { value: "+359882040529", label: "088 204 0529 — mobile" },
      { value: "+359882240572", label: "088 224 0572 — mobile" },
      { value: "+359882255198", label: "088 225 5198 — mobile" },
      { value: "+359882257053", label: "088 225 7053 — mobile" },
      { value: "+359882265270", label: "088 226 5270 — mobile" },
      { value: "+359882447210", label: "088 244 7210 — mobile" },
      { value: "+359882471250", label: "088 247 1250 — mobile" },
      { value: "+359882522057", label: "088 252 2057 — mobile" },
      { value: "+359882526629", label: "088 252 6629 — mobile" },
      { value: "+359882646781", label: "088 264 6781 — mobile" },
    ];

    // GET /api/voip/agents — list agents with an assigned extension + their caller-ID + DID options.
    if (req.method === "GET" && path === "voip/agents") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data: exts } = await adminClient
        .from("telephony_extensions")
        .select("extension,user_id,primary_caller_id,label")
        .not("user_id", "is", null)
        .order("extension");
      const userIds = (exts || []).map((e: any) => e.user_id);
      const { data: profs } = await adminClient
        .from("profiles")
        .select("user_id,full_name,email")
        .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      const pmap: Record<string, any> = {};
      (profs || []).forEach((p: any) => { pmap[p.user_id] = p; });
      const agents = (exts || []).map((e: any) => ({
        user_id: e.user_id,
        extension: e.extension,
        primary_caller_id: e.primary_caller_id,
        full_name: pmap[e.user_id]?.full_name || e.label || "—",
        email: pmap[e.user_id]?.email || "",
      }));
      return json({ agents, dids: OWNED_DIDS });
    }

    // PUT /api/voip/agents/:userId/caller-id — superadmin sets an agent's outbound caller-ID.
    if (req.method === "PUT" && segments[0] === "voip" && segments[1] === "agents" && segments[3] === "caller-id") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const targetUser = segments[2];
      let body: any; try { body = await req.json(); } catch { body = {}; }
      const cid = String(body.caller_id || "").trim();
      if (!OWNED_DIDS.some((d) => d.value === cid)) return json({ error: "Caller ID must be one of the owned numbers" }, 400);
      const { data: updated, error } = await adminClient
        .from("telephony_extensions")
        .update({ primary_caller_id: cid })
        .eq("user_id", targetUser)
        .select("extension")
        .maybeSingle();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      if (!updated) return json({ error: "Agent has no telephony extension assigned" }, 404);
      await audit(adminClient, user.id, user.email, "voip.caller_id.set", { target_type: "user", target_id: targetUser, payload: { extension: updated.extension, caller_id: cid } });
      return json({ success: true });
    }

    // GET /api/missed-calls — admin/manager: all; agent: calls assigned to them
    // PLUS unassigned calls from customers they own (they're the last agent to have
    // called / handled that caller's order). Enriched with "who contacted this caller
    // last" (a previous call OR the agent who handled their last order) so missed
    // calls land with the agent who already has the relationship. The agent filter is
    // applied AFTER enrichment because it depends on last_agent_id (see below).
    // Matching is by last-8 digits (phone canon).
    if (req.method === "GET" && path === "missed-calls") {
      let q = adminClient.from("missed_calls").select("*").order("occurred_at", { ascending: false }).limit(300);
      const statusF = url.searchParams.get("status");
      if (statusF) q = q.eq("status", statusF);
      const { data, error } = await q;
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      const missed = data || [];

      const last8 = (p: any) => String(p || "").replace(/\D/g, "").slice(-8);
      const norms = new Set(missed.map((m: any) => m.linked_phone_norm || last8(m.caller_number)).filter(Boolean));

      // Most recent agent-initiated CALL to each caller (call_logs is bounded at the
      // current scale; the (customer_phone, started_at DESC) index keeps it cheap).
      const callByNorm: Record<string, { agent_id: string; at: string; outcome: string | null }> = {};
      if (norms.size) {
        const { data: logs } = await adminClient
          .from("call_logs")
          .select("agent_id, customer_phone, started_at, outcome")
          .not("customer_phone", "is", null)
          .not("agent_id", "is", null)
          .order("started_at", { ascending: false })
          .limit(5000);
        for (const l of logs || []) {
          const n = last8(l.customer_phone);
          if (!n || !norms.has(n) || callByNorm[n]) continue; // desc order → first seen is latest
          callByNorm[n] = { agent_id: l.agent_id, at: l.started_at, outcome: l.outcome ?? null };
        }
      }
      const callAgentIds = new Set(Object.values(callByNorm).map((v) => v.agent_id));
      const nameById: Record<string, string> = {};
      if (callAgentIds.size) {
        const { data: profs } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", [...callAgentIds]);
        for (const p of profs || []) nameById[p.user_id] = p.full_name;
      }

      // The caller's last order (via the already-linked order) — used as the
      // FALLBACK agent + to show the customer's name.
      const orderIds = [...new Set(missed.map((m: any) => m.linked_order_id).filter(Boolean))];
      const orderById: Record<string, any> = {};
      if (orderIds.length) {
        const { data: ords } = await adminClient
          .from("orders")
          .select("id, customer_name, confirmed_by_agent_id, confirmed_by_name, assigned_agent_id, assigned_agent_name, created_at, display_id")
          .in("id", orderIds);
        for (const o of ords || []) orderById[o.id] = o;
      }

      const enriched = missed.map((m: any) => {
        const n = m.linked_phone_norm || last8(m.caller_number);
        const call = callByNorm[n];
        const ord = m.linked_order_id ? orderById[m.linked_order_id] : null;
        const callAgentName = call ? (nameById[call.agent_id] || null) : null;

        let last_agent_name: string | null = null, last_agent_id: string | null = null,
          last_agent_at: string | null = null, last_agent_source: string | null = null,
          last_agent_detail: string | null = null;
        // Call-log FIRST: whoever last *called* this number owns the relationship,
        // even if someone else placed the last order. Only fall back to the order
        // when there is no call at all.
        if (callAgentName) {
          last_agent_name = callAgentName; last_agent_id = call!.agent_id; last_agent_at = call!.at;
          last_agent_source = "call"; last_agent_detail = call!.outcome;
        } else if (ord && (ord.confirmed_by_name || ord.assigned_agent_name)) {
          last_agent_name = ord.confirmed_by_name || ord.assigned_agent_name;
          last_agent_id = ord.confirmed_by_agent_id || ord.assigned_agent_id || null;
          last_agent_at = ord.created_at || null;
          last_agent_source = "order"; last_agent_detail = ord.display_id || null;
        }
        return {
          ...m,
          customer_name: ord?.customer_name || null,
          last_agent_name, last_agent_id, last_agent_at, last_agent_source, last_agent_detail,
        };
      });

      // Agents see calls assigned to them, plus unassigned calls from customers they
      // own (last_agent_id === them). Calls assigned to someone else stay hidden.
      // Admins/managers see everything.
      const visible = isAdminOrManager
        ? enriched
        : enriched.filter((m: any) =>
            m.assigned_agent_id === user.id ||
            (!m.assigned_agent_id && m.last_agent_id === user.id));
      return json({ missed_calls: redactCustomerList(visible, piiFlags) });
    }

    // POST /api/missed-calls/bulk-assign — assign many at once to one agent.
    if (req.method === "POST" && path === "missed-calls/bulk-assign") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let b: any; try { b = await req.json(); } catch { b = {}; }
      const ids = Array.isArray(b.ids) ? b.ids.filter((x: any) => typeof x === "string") : [];
      const agentId = String(b.agent_id || "");
      if (!ids.length || !agentId) return json({ error: "ids[] and agent_id required" }, 400);
      const { data: prof } = await adminClient.from("profiles").select("full_name").eq("user_id", agentId).maybeSingle();
      const { error } = await adminClient.from("missed_calls")
        .update({ assigned_agent_id: agentId, assigned_agent_name: prof?.full_name || null, status: "assigned" })
        .in("id", ids);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true, count: ids.length });
    }

    // POST /api/missed-calls/:id/assign — admin/manager assign to an agent.
    if (req.method === "POST" && segments[0] === "missed-calls" && segments[2] === "assign") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const id = segments[1];
      let b: any; try { b = await req.json(); } catch { b = {}; }
      const agentId = String(b.agent_id || "");
      if (!agentId) return json({ error: "agent_id required" }, 400);
      const { data: prof } = await adminClient.from("profiles").select("full_name").eq("user_id", agentId).maybeSingle();
      const { error } = await adminClient.from("missed_calls")
        .update({ assigned_agent_id: agentId, assigned_agent_name: prof?.full_name || null, status: "assigned" })
        .eq("id", id);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // POST /api/missed-calls/:id/status — set status (admin/manager any; agent only their own).
    if (req.method === "POST" && segments[0] === "missed-calls" && segments[2] === "status") {
      const id = segments[1];
      let b: any; try { b = await req.json(); } catch { b = {}; }
      const status = String(b.status || "");
      if (!["new", "assigned", "called_back", "ignored"].includes(status)) return json({ error: "bad status" }, 400);
      let q = adminClient.from("missed_calls").update({ status }).eq("id", id);
      if (!isAdminOrManager) q = q.eq("assigned_agent_id", user.id);
      const { error } = await q;
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // GET /api/missed-calls/:id/voicemail-url — short-lived signed URL for the
    // caller's recorded message. Admin/manager any; an agent only for a call
    // assigned to them. Reuses the elyon-rec.php signing (same as call recordings).
    if (req.method === "GET" && segments[0] === "missed-calls" && segments[2] === "voicemail-url") {
      const id = segments[1];
      const { data: mc } = await adminClient
        .from("missed_calls").select("voicemail_file, assigned_agent_id").eq("id", id).maybeSingle();
      if (!mc) return json({ error: "not found" }, 404);
      if (!canHearRecordings && mc.assigned_agent_id !== user.id) return json({ error: "Forbidden" }, 403);
      const file = String(mc.voicemail_file || "");
      if (!/^\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._+\-]+\.wav$/.test(file)) return json({ error: "no voicemail" }, 404);
      const exp = Math.floor(Date.now() / 1000) + 300;
      const sig = await recSign(file, exp);
      return json({ url: `${REC_HOST}?file=${encodeURIComponent(file)}&exp=${exp}&sig=${sig}` });
    }

    // POST /api/users/create (admin only)
    if (req.method === "POST" && path === "users/create") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "users.create", 10)) return json({ error: "Rate limit exceeded — try again in a minute" }, 429);
      let body;
      try { body = parseBody(createUserSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const { email, password, full_name } = body;
      const rolesToAssign: string[] = body.roles || (body.role ? [body.role] : []);

      if (rolesToAssign.length === 0) {
        return json({ error: "At least one role is required" }, 400);
      }
      const validRoles = ["admin", "manager", "agent", "pending_agent", "prediction_agent", "warehouse", "ads_admin"];
      if (rolesToAssign.some((r: string) => !validRoles.includes(r))) {
        return json({ error: `Roles must be one of: ${validRoles.join(", ")}` }, 400);
      }
      // Managers can only create pending_agent and prediction_agent
      if (isManager && !isAdmin) {
        const allowedForManager = ["pending_agent", "prediction_agent"];
        if (rolesToAssign.some((r: string) => !allowedForManager.includes(r))) {
          return json({ error: "Managers can only create Pending Agent or Prediction Agent users" }, 400);
        }
      }

      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (createErr) return json({ error: sanitizeDbError(createErr) }, 400);

      // Assign all roles
      for (const r of rolesToAssign) {
        await adminClient.from("user_roles").insert({ user_id: newUser.user.id, role: r });
      }

      await audit(adminClient, user.id, user.email, "user.create", {
        target_type: "user",
        target_id: newUser.user.id,
        target_name: email,
        payload: { full_name, roles: rolesToAssign },
      });
      return json({ success: true, user_id: newUser.user.id });
    }

    // PUT /api/users/:id/roles (admin only - set roles array)
    if (req.method === "PUT" && segments[0] === "users" && segments[2] === "roles") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const userId = segments[1];
      const body = await req.json();
      const { roles: newRoles } = body;

      if (!newRoles || !Array.isArray(newRoles) || newRoles.length === 0) {
        return json({ error: "At least one role is required" }, 400);
      }
      const validRoles = ["admin", "manager", "agent", "pending_agent", "prediction_agent", "warehouse", "ads_admin"];
      if (newRoles.some((r: string) => !validRoles.includes(r))) {
        return json({ error: `Roles must be one of: ${validRoles.join(", ")}` }, 400);
      }
      // Managers can only set agent-level roles
      if (isManager && !isAdmin) {
        const allowedForManager = ["pending_agent", "prediction_agent"];
        if (newRoles.some((r: string) => !allowedForManager.includes(r))) {
          return json({ error: "Managers can only assign Pending Agent or Prediction Agent roles" }, 400);
        }
      }
      // Prevent admin from changing own roles
      if (userId === user.id) {
        return json({ error: "Cannot change your own roles" }, 400);
      }

      // Delete existing roles and insert new ones.
      // Upsert because the admin_grant_all_roles trigger may already have
      // inserted some of these rows (when 'admin' is in newRoles, the trigger
      // backfills every other role for that user).
      await adminClient.from("user_roles").delete().eq("user_id", userId);
      for (const r of newRoles) {
        await adminClient
          .from("user_roles")
          .upsert({ user_id: userId, role: r }, { onConflict: "user_id,role" });
      }

      await audit(adminClient, user.id, user.email, "user.set_roles", {
        target_type: "user",
        target_id: userId,
        payload: { roles: newRoles },
      });
      return json({ success: true, roles: newRoles });
    }

    // PATCH /api/users/:id/role (legacy - admin only)
    if (req.method === "PATCH" && segments[0] === "users" && segments[2] === "role") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const userId = segments[1];
      const body = await req.json();
      const { role: newRole } = body;
      if (!newRole || !["admin", "agent", "warehouse"].includes(newRole)) {
        return json({ error: "Role must be admin or agent" }, 400);
      }
      if (userId === user.id) {
        return json({ error: "Cannot change your own role" }, 400);
      }
      // Replace all roles with the single one (legacy behavior)
      await adminClient.from("user_roles").delete().eq("user_id", userId);
      await adminClient.from("user_roles").insert({ user_id: userId, role: newRole });
      await audit(adminClient, user.id, user.email, "user.set_role_legacy", {
        target_type: "user",
        target_id: userId,
        payload: { role: newRole },
      });
      return json({ success: true });
    }

    // POST /api/users/:id/toggle-active (admin only)
    if (req.method === "POST" && segments[0] === "users" && segments[2] === "toggle-active") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const userId = segments[1];
      // Prevent admin from suspending themselves
      if (userId === user.id) {
        return json({ error: "Cannot suspend yourself" }, 400);
      }
      const { data: profile } = await adminClient
        .from("profiles")
        .select("is_active")
        .eq("user_id", userId)
        .single();
      if (!profile) return json({ error: "User not found" }, 404);

      await adminClient
        .from("profiles")
        .update({ is_active: !profile.is_active })
        .eq("user_id", userId);

      await audit(adminClient, user.id, user.email, "user.toggle_active", {
        target_type: "user",
        target_id: userId,
        payload: { is_active: !profile.is_active },
      });
      return json({ success: true, is_active: !profile.is_active });
    }

    // DELETE /api/users/:id (admin only)
    if (req.method === "DELETE" && segments[0] === "users" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "users.delete", 10)) return json({ error: "Rate limit exceeded — try again in a minute" }, 429);
      const userId = segments[1];
      // Prevent admin from deleting themselves
      if (userId === user.id) {
        return json({ error: "Cannot delete yourself" }, 400);
      }
      // Capture name before deletion so the audit row is human-readable.
      const { data: deletedProfile } = await adminClient
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", userId)
        .single();

      // Delete role, profile, then auth user
      await adminClient.from("user_roles").delete().eq("user_id", userId);
      await adminClient.from("profiles").delete().eq("user_id", userId);
      const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
      if (delErr) return json({ error: sanitizeDbError(delErr) }, 400);

      await audit(adminClient, user.id, user.email, "user.delete", {
        target_type: "user",
        target_id: userId,
        target_name: deletedProfile?.full_name || deletedProfile?.email || null,
      });
      return json({ success: true });
    }

    // GET /api/users (admin only)
    if (req.method === "GET" && path === "users") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const { data: users } = await adminClient
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      // Get all roles in one query (multiple roles per user)
      const userIds = (users || []).map((u: any) => u.user_id);
      const { data: allRoles } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds.length > 0 ? userIds : ["__none__"]);

      const roleMap: Record<string, string[]> = {};
      for (const r of allRoles || []) {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
        roleMap[r.user_id].push(r.role);
      }

      // Get stats for each user
      const enriched = await Promise.all(
        (users || []).map(async (u: any) => {
          const { count: ordersProcessed } = await adminClient
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("assigned_agent_id", u.user_id);

          const { count: leadsProcessed } = await adminClient
            .from("prediction_leads")
            .select("id", { count: "exact", head: true })
            .eq("assigned_agent_id", u.user_id);

          const userRoles = roleMap[u.user_id] || ["agent"];
          return {
            ...u,
            roles: userRoles,
            role: userRoles.includes("admin") ? "admin" : userRoles[0] || "agent", // legacy compat
            orders_processed: ordersProcessed || 0,
            leads_processed: leadsProcessed || 0,
          };
        })
      );

      return json(enriched);
    }

    // GET /api/users/agents (list active assignable users - agents and admins)
    if (req.method === "GET" && path === "users/agents") {
      const { data: allUsers } = await adminClient
        .from("profiles")
        .select("user_id, full_name, email")
        .eq("is_active", true);

      // Get all roles for active users
      const userIds = (allUsers || []).map((u: any) => u.user_id);
      const { data: allRoles } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds.length > 0 ? userIds : ["__none__"]);

      const roleMap: Record<string, string[]> = {};
      for (const r of allRoles || []) {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
        roleMap[r.user_id].push(r.role);
      }

      // Filter to users with agent OR admin role (assignable users)
      const assignableUsers = (allUsers || [])
        .filter((u: any) => {
          const roles = roleMap[u.user_id] || [];
          return roles.includes("agent") || roles.includes("pending_agent") || roles.includes("prediction_agent") || roles.includes("admin");
        })
        .map((u: any) => ({
          ...u,
          roles: roleMap[u.user_id] || [],
        }));

      return json(assignableUsers);
    }

    // POST /api/orders (create order — admin/manager/agent)
    if (req.method === "POST" && path === "orders") {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(createOrderSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      // Determine status: agents can only set confirmed or call_again
      const status = body.status || "pending";
      // If agent (not admin), auto-assign to self
      const { data: agentProfile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
      const agentName = agentProfile?.full_name || user.email;

      const assignToSelf = !isAdminOrManager;
      const assignedAgentId = assignToSelf ? user.id : null;
      const assignedAgentName = assignToSelf ? agentName : null;

      // Calculate total from items if provided
      const hasItems = body.items && body.items.length > 0;
      let totalPrice = body.price || 0;
      let totalQty = body.quantity || 1;
      let productSummary = body.product_name;

      if (hasItems) {
        totalPrice = body.items.reduce((s: number, i: any) => s + (i.quantity * i.price_per_unit), 0);
        totalQty = body.items.reduce((s: number, i: any) => s + i.quantity, 0);
        // Build nice "Name xN" summary for the denormalized field
        productSummary = body.items
          .map((i: any) => (i.quantity > 1 ? `${i.product_name} x${i.quantity}` : i.product_name))
          .join(", ");
      }

      // Office orders take the courier office's own post code; home orders keep
      // whatever the agent entered from the settlement picker.
      const officePostCode = await resolveOfficePostCode(body.delivery_type ?? "home", body.courier_office_code);
      const resolvedPostalCode = officePostCode ?? body.postal_code;

      // Snapshot the prediction list the customer was in (drives list-ROI
      // analytics + per-package agent bonuses). Stamped for ALL statuses so a
      // cancelled prediction order still counts toward that list's cancels.
      const predictionAttr = await resolvePredictionAttribution(body.customer_phone);

      // Backfill a blank name from any order/segment sharing the phone. Stops
      // cancel/trash call-outcome records (where the agent couldn't see the
      // original named order via RLS) from landing nameless on /orders.
      let resolvedCustomerName = body.customer_name;
      if ((!resolvedCustomerName || !resolvedCustomerName.trim()) && body.customer_phone) {
        resolvedCustomerName = (await resolveKnownCustomerName(body.customer_phone)) || resolvedCustomerName;
      }

      const { data: order, error: orderErr } = await adminClient
        .from("orders")
        .insert({
          product_id: body.product_id,
          product_name: productSummary,
          customer_name: resolvedCustomerName,
          customer_phone: body.customer_phone,
          customer_city: body.customer_city,
          customer_address: body.customer_address,
          postal_code: resolvedPostalCode,
          street: body.street ?? "",
          street_number: body.street_number ?? "",
          quarter: body.quarter ?? "",
          apartment: body.apartment ?? "",
          floor: body.floor ?? "",
          block: body.block ?? "",
          entry: body.entry ?? "",
          delivery_instructions: body.delivery_instructions ?? "",
          gift_note: body.gift_note ?? "",
          delivery_type: body.delivery_type ?? "home",
          home_courier: body.home_courier ?? null,
          courier_office_code: body.courier_office_code ?? "",
          courier_office_name: body.courier_office_name ?? "",
          courier_office_city: body.courier_office_city ?? "",
          birthday: body.birthday,
          ship_after_date: body.ship_after_date ?? null,
          price: totalPrice,
          quantity: totalQty,
          status,
          // Store the structured cancel reason on the order when the agent
          // creates it as cancelled, so the segment trigger can route the
          // customer to the right Cancelled mirror list.
          cancellation_reason: status === "cancelled" ? (body.cancellation_reason ?? null) : null,
          cancellation_reason_notes: status === "cancelled" ? (body.cancellation_reason_notes ?? null) : null,
          // Synthetic cancelled records (logged from the Calls page) are created
          // straight as 'cancelled' — stamp WHEN and WHO so reports/exports have a
          // real cancellation timestamp + attribution (the BEFORE trigger also
          // guarantees cancelled_at, this keeps the agent and is explicit here).
          cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
          cancelled_by_agent_id: status === "cancelled" ? user.id : null,
          // Symmetric with the cancel reason above: store the structured trash
          // reason when the agent records the call outcome directly as 'trashed'.
          trash_reason: status === "trashed" ? (body.trash_reason ?? null) : null,
          trash_reason_notes: status === "trashed" ? (body.trash_reason_notes ?? null) : null,
          source_type: "manual",
          prediction_list_id: predictionAttr?.id ?? null,
          prediction_list_type: predictionAttr?.type ?? null,
          prediction_list_name: predictionAttr?.name ?? null,
          prediction_list_category: predictionAttr?.category ?? null,
          assigned_agent_id: assignedAgentId,
          assigned_agent_name: assignedAgentName,
          assigned_at: assignToSelf ? new Date().toISOString() : null,
          // Credit the confirmer (the real creator, even an admin) so analytics
          // attribute the order correctly and never to "Unknown operator".
          confirmed_by_agent_id: REAL_ORDER_STATUSES.includes(status) ? user.id : null,
          confirmed_by_name: REAL_ORDER_STATUSES.includes(status) ? agentName : null,
          confirmed_at: REAL_ORDER_STATUSES.includes(status) ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (orderErr) return json({ error: sanitizeDbError(orderErr) }, 400);

      // TV leaderboard: nudge the wall screen the instant an order is confirmed.
      if (REAL_ORDER_STATUSES.includes(status)) {
        await broadcastLeaderboard("confirmed", { agent_id: user.id, order_id: order.id });
      }

      // Insert order items
      if (hasItems) {
        const orderItems = body.items.map((i: any) => ({
          order_id: order.id,
          product_id: i.product_id || null,
          product_name: i.product_name,
          quantity: i.quantity,
          price_per_unit: i.price_per_unit,
          total_price: Math.round(i.quantity * i.price_per_unit * 100) / 100,
        }));
        await adminClient.from("order_items").insert(orderItems);
      }

      // Add notes if provided
      if (body.notes && body.notes.trim()) {
        await adminClient.from("order_notes").insert({
          order_id: order.id,
          text: body.notes.trim(),
          author_id: user.id,
          author_name: agentName,
        });
      }

      // Log creation in order history
      await adminClient.from("order_history").insert({
        order_id: order.id,
        to_status: status,
        changed_by: user.id,
        changed_by_name: agentName,
      });
      // Add source note — but only for real sales orders.
      // For synthetic cancelled/trashed records created from the Calls page
      // (to log the outcome + reason), we don't want to pollute the notes
      // with "Manual Order Created". The actual reason is already recorded
      // via cancellation_reason_notes / notes.
      if (!["cancelled", "trashed"].includes(status)) {
        await adminClient.from("order_notes").insert({
          order_id: order.id,
          text: "Manual Order Created",
          author_id: user.id,
          author_name: "System",
        });
      }

      return json(order);
    }

    // GET /api/orders
    if (req.method === "GET" && path === "orders") {
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");
      const agentId = url.searchParams.get("agent_id");
      const source = url.searchParams.get("source");
      // Calling-bucket only: skip orders parked by a recent no-answer
      // (next_call_after still in the future). The admin Orders list never
      // sets this, so parked pendings still show there.
      const readyOnly = url.searchParams.get("ready_only") === "1";
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const priceMin = url.searchParams.get("price_min");
      const priceMax = url.searchParams.get("price_max");
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = parseInt(url.searchParams.get("limit") || "20");

      // Only admins/managers may use the elevated client. Agents are always
      // restricted by RLS — search must not bypass row-level access controls.
      const isGlobalSearch = false;
      const client = isAdminOrManager ? adminClient : supabase;

      let query = client
        .from("orders")
        .select("*, order_items(id, product_id, product_name, quantity, price_per_unit, total_price)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (status && status !== "all") {
        // Supports a single status or a comma-separated list (multi-select filter).
        const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 1) query = query.in("status", statuses);
        else if (statuses.length === 1) query = query.eq("status", statuses[0]);
      }
      if (agentId && agentId !== "all") query = query.eq("assigned_agent_id", agentId);
      if (source && source !== "all") query = query.eq("source_type", source);
      if (from) query = query.gte("created_at", from);
      if (to) query = query.lte("created_at", to);
      if (priceMin) {
        const n = Number(priceMin);
        if (Number.isFinite(n)) query = query.gte("price", n);
      }
      if (priceMax) {
        const n = Number(priceMax);
        if (Number.isFinite(n)) query = query.lte("price", n);
      }
      if (search) {
        const s = sanitizeSearch(search);
        if (s) query = query.or(`display_id.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,product_name.ilike.%${s}%`);
      }
      if (readyOnly) {
        const nowIso = new Date().toISOString();
        query = query.or(`next_call_after.is.null,next_call_after.lte.${nowIso}`);
      }

      const { data: orders, count, error } = await query;
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Who last acted on each order (confirmed / cancelled / call_again / …).
      // Every order has at least its creation row in order_history, so this is
      // always populated. Drives the Orders list "Handled By" column.
      const pageOrderIds = (orders || []).map((o: any) => o.id);
      const lastActionBy: Record<string, string> = {};
      if (pageOrderIds.length) {
        const { data: hist } = await adminClient
          .from("order_history")
          .select("order_id, changed_by_name, changed_at")
          .in("order_id", pageOrderIds)
          .order("changed_at", { ascending: false });
        for (const h of hist || []) {
          if (!lastActionBy[h.order_id] && h.changed_by_name) lastActionBy[h.order_id] = h.changed_by_name;
        }
      }

      // Add is_owned flag for agents
      const enrichedOrders = (orders || []).map((o: any) => ({
        ...o,
        is_owned: isAdminOrManager || o.assigned_agent_id === user.id,
        last_action_by: lastActionBy[o.id] || o.assigned_agent_name || null,
      }));

      return json({ orders: redactCustomerList(enrichedOrders, piiFlags), total: count, page, limit });
    }

    // GET /api/orders/unassigned-pending (admin only - for assigner)
    if (req.method === "GET" && path === "orders/unassigned-pending") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      const { data: orders, error } = await adminClient
        .from("orders")
        .select("*")
        .eq("status", "pending")
        .is("assigned_agent_id", null)
        .order("created_at", { ascending: false });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(orders || []);
    }

    // GET /api/orders/assigned (admin only - all assigned orders for assigner)
    if (req.method === "GET" && path === "orders/assigned") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      const { data: orders, error } = await adminClient
        .from("orders")
        .select("*")
        .not("assigned_agent_id", "is", null)
        .order("assigned_at", { ascending: false });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(orders || []);
    }

    // POST /api/orders/bulk-unassign (admin only)
    if (req.method === "POST" && path === "orders/bulk-unassign") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "orders.bulk", 20)) return json({ error: "Rate limit exceeded — try again in a minute" }, 429);
      const body = await req.json();
      const { order_ids } = body;
      if (!order_ids?.length) return json({ error: "order_ids required" }, 400);

      const { error: updateErr } = await adminClient
        .from("orders")
        .update({
          assigned_agent_id: null,
          assigned_agent_name: null,
          assigned_at: null,
          assigned_by: null,
        })
        .in("id", order_ids);
      if (updateErr) return json({ error: sanitizeDbError(updateErr) }, 400);

      await audit(adminClient, user.id, user.email, "order.bulk_unassign", {
        target_type: "order",
        target_name: `${order_ids.length} orders`,
        payload: { order_ids, count: order_ids.length },
      });
      return json({ success: true, unassigned: order_ids.length });
    }

    // POST /api/orders/bulk-assign (admin only)
    if (req.method === "POST" && path === "orders/bulk-assign") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "orders.bulk", 20)) return json({ error: "Rate limit exceeded — try again in a minute" }, 429);
      const body = await req.json();
      const { order_ids, agent_id } = body;
      if (!order_ids?.length || !agent_id) return json({ error: "order_ids and agent_id required" }, 400);

      const { data: agentProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", agent_id)
        .single();
      if (!agentProfile) return json({ error: "Agent not found" }, 404);

      const { data: adminProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();

      const { error: updateErr } = await adminClient
        .from("orders")
        .update({
          assigned_agent_id: agent_id,
          assigned_agent_name: agentProfile.full_name,
          assigned_at: new Date().toISOString(),
          assigned_by: adminProfile?.full_name || "Admin",
        })
        .in("id", order_ids);
      if (updateErr) return json({ error: sanitizeDbError(updateErr) }, 400);

      await audit(adminClient, user.id, user.email, "order.bulk_assign", {
        target_type: "order",
        target_name: `${order_ids.length} orders → ${agentProfile.full_name}`,
        payload: { order_ids, agent_id, agent_name: agentProfile.full_name, count: order_ids.length },
      });

      // One summary ping to the agent (not one per order).
      if (agent_id !== user.id) {
        await notifyUsers(adminClient, [agent_id], {
          type: "assignment",
          title: "New orders assigned to you",
          message: `${order_ids.length} order${order_ids.length === 1 ? "" : "s"} assigned to you — open Assigned to Me.`,
          link: "/assigned",
        });
      }

      return json({ success: true, assigned: order_ids.length });
    }

    // POST /api/presence/heartbeat — any authenticated user pings this every
    // ~45s while the app is open. Bumps profiles.last_seen_at so agents/online
    // can tell who is actually here right now.
    if (req.method === "POST" && path === "presence/heartbeat") {
      await adminClient
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("user_id", user.id);
      return json({ ok: true });
    }

    // GET /api/agents/online (admin only - active agents with load info)
    if (req.method === "GET" && path === "agents/online") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      // An agent is "online" if they pinged the heartbeat in the last 2 min.
      const ONLINE_WINDOW_MS = 2 * 60 * 1000;

      // Get active users with agent or admin role
      const { data: allUsers } = await adminClient
        .from("profiles")
        .select("user_id, full_name, email, last_seen_at")
        .eq("is_active", true);

      const userIds = (allUsers || []).map((u: any) => u.user_id);
      const { data: allRoles } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds.length > 0 ? userIds : ["__none__"]);

      const roleMap: Record<string, string[]> = {};
      for (const r of allRoles || []) {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
        roleMap[r.user_id].push(r.role);
      }

      const agents = (allUsers || []).filter((u: any) => {
        const roles = roleMap[u.user_id] || [];
        return roles.includes("agent") || roles.includes("pending_agent") || roles.includes("prediction_agent") || roles.includes("admin");
      });

      // Get assigned active order counts per agent
      const agentIds = agents.map((a: any) => a.user_id);
      const { data: orderCounts } = await adminClient
        .from("orders")
        .select("assigned_agent_id")
        .in("assigned_agent_id", agentIds.length > 0 ? agentIds : ["__none__"])
        .in("status", ["pending", "take", "call_again"]);

      const countMap: Record<string, number> = {};
      for (const o of orderCounts || []) {
        countMap[o.assigned_agent_id] = (countMap[o.assigned_agent_id] || 0) + 1;
      }

      // Check TODAY's shifts only. The previous query forgot to filter on
      // shifts.date, so it surfaced shift times from any day. The !inner join
      // + .eq("shifts.date", today) restricts to assignments whose shift is
      // today.
      const today = new Date().toISOString().split("T")[0];
      const { data: todayShifts } = await adminClient
        .from("shift_assignments")
        .select("user_id, shifts!inner(start_time, end_time, date)")
        .in("user_id", agentIds.length > 0 ? agentIds : ["__none__"])
        .eq("shifts.date", today);

      const shiftMap: Record<string, any> = {};
      for (const sa of todayShifts || []) {
        shiftMap[sa.user_id] = sa.shifts;
      }

      const nowMs = Date.now();
      const result = agents.map((a: any) => {
        const lastSeen = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
        const isOnline = lastSeen > 0 && (nowMs - lastSeen) < ONLINE_WINDOW_MS;
        return {
          user_id: a.user_id,
          full_name: a.full_name,
          email: a.email,
          roles: roleMap[a.user_id] || [],
          active_leads: countMap[a.user_id] || 0,
          shift: shiftMap[a.user_id] || null,
          last_seen_at: a.last_seen_at || null,
          is_online: isOnline,
        };
      });

      return json(result);
    }
    // POST /api/orders/bulk-status-update (admin/manager/warehouse)
    if (req.method === "POST" && path === "orders/bulk-status-update") {
      if (!(isAdmin || isWarehouse || canEditModule("orders"))) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "orders.bulk", 20)) return json({ error: "Rate limit exceeded — try again in a minute" }, 429);
      const body = await req.json();
      const { order_ids, new_status } = body;
      if (!order_ids?.length || !new_status) return json({ error: "order_ids and new_status required" }, 400);

      const validStatuses = ["shipped", "paid", "cancelled", "returned"];
      if (!validStatuses.includes(new_status)) return json({ error: `Status must be one of: ${validStatuses.join(", ")}` }, 400);

      // Fetch current orders to apply safety rules
      const { data: currentOrders, error: fetchErr } = await adminClient
        .from("orders")
        .select("id, status, display_id")
        .in("id", order_ids);
      if (fetchErr) return json({ error: sanitizeDbError(fetchErr) }, 400);

      const skipped: string[] = [];
      const toUpdate: string[] = [];

      for (const order of currentOrders || []) {
        // Safety: don't update cancelled orders to paid
        if (order.status === "cancelled" && new_status === "paid") {
          skipped.push(order.display_id);
          continue;
        }
        // Paid only allowed from shipped or confirmed
        if (new_status === "paid" && !["shipped", "confirmed"].includes(order.status)) {
          skipped.push(order.display_id);
          continue;
        }
        // Don't update already-same-status
        if (order.status === new_status) {
          skipped.push(order.display_id);
          continue;
        }
        toUpdate.push(order.id);
      }

      if (toUpdate.length > 0) {
        // Stock deduction when bulk-setting to "shipped"
        if (new_status === "shipped") {
          for (const oid of toUpdate) {
            const prev = (currentOrders || []).find((o: any) => o.id === oid);
            if (prev?.status === "shipped") continue; // already shipped
            
            const { data: orderItems } = await adminClient.from("order_items").select("*").eq("order_id", oid);
            if (orderItems && orderItems.length > 0) {
              // Multi-product stock check
              let stockOk = true;
              for (const item of orderItems) {
                if (!item.product_id) continue;
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
                if (product && product.stock_quantity < item.quantity) {
                  skipped.push(prev?.display_id || oid);
                  stockOk = false;
                  break;
                }
              }
              if (!stockOk) {
                // Remove from toUpdate
                const idx = toUpdate.indexOf(oid);
                if (idx > -1) toUpdate.splice(idx, 1);
                continue;
              }
              // Deduct stock
              for (const item of orderItems) {
                if (!item.product_id) continue;
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
                if (product) {
                  const newQty = product.stock_quantity - item.quantity;
                  await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", item.product_id);
                  await adminClient.from("inventory_logs").insert({
                    product_id: item.product_id,
                    change_amount: -item.quantity,
                    previous_stock: product.stock_quantity,
                    new_stock: newQty,
                    reason: "order_deduction",
                    movement_type: "order_deduction",
                    user_id: user.id,
                    notes: `Bulk shipped — ${item.product_name}`,
                  });
                }
              }
            } else {
              // Legacy single-product: check order's product_id
              const { data: fullOrder } = await adminClient.from("orders").select("product_id, quantity, display_id").eq("id", oid).single();
              if (fullOrder?.product_id) {
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", fullOrder.product_id).single();
                const orderQty = fullOrder.quantity || 1;
                if (product && product.stock_quantity < orderQty) {
                  skipped.push(prev?.display_id || oid);
                  const idx = toUpdate.indexOf(oid);
                  if (idx > -1) toUpdate.splice(idx, 1);
                  continue;
                }
                if (product) {
                  const newQty = product.stock_quantity - orderQty;
                  await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", fullOrder.product_id);
                  await adminClient.from("inventory_logs").insert({
                    product_id: fullOrder.product_id,
                    change_amount: -orderQty,
                    previous_stock: product.stock_quantity,
                    new_stock: newQty,
                    reason: "order_deduction",
                    movement_type: "order_deduction",
                    user_id: user.id,
                    notes: `Bulk shipped — ${fullOrder.display_id}`,
                  });
                }
              }
            }
          }
        }

        // Stock return when bulk-setting to "returned"
        if (new_status === "returned") {
          for (const oid of toUpdate) {
            const prev = (currentOrders || []).find((o: any) => o.id === oid);
            if (prev?.status === "returned") continue; // already returned

            const { data: orderItems } = await adminClient.from("order_items").select("*").eq("order_id", oid);
            if (orderItems && orderItems.length > 0) {
              for (const item of orderItems) {
                if (!item.product_id) continue;
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
                if (product) {
                  const newQty = product.stock_quantity + item.quantity;
                  await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", item.product_id);
                  await adminClient.from("inventory_logs").insert({
                    product_id: item.product_id,
                    change_amount: item.quantity,
                    previous_stock: product.stock_quantity,
                    new_stock: newQty,
                    reason: "order_return",
                    movement_type: "order_return",
                    user_id: user.id,
                    notes: `Bulk returned — ${item.product_name} x${item.quantity}`,
                  });
                }
              }
            } else {
              const { data: fullOrder } = await adminClient.from("orders").select("product_id, quantity, display_id, product_name").eq("id", oid).single();
              if (fullOrder?.product_id) {
                const orderQty = fullOrder.quantity || 1;
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", fullOrder.product_id).single();
                if (product) {
                  const newQty = product.stock_quantity + orderQty;
                  await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", fullOrder.product_id);
                  await adminClient.from("inventory_logs").insert({
                    product_id: fullOrder.product_id,
                    change_amount: orderQty,
                    previous_stock: product.stock_quantity,
                    new_stock: newQty,
                    reason: "order_return",
                    movement_type: "order_return",
                    user_id: user.id,
                    notes: `Bulk returned — ${fullOrder.display_id}`,
                  });
                }
              }
            }
          }
        }

        if (toUpdate.length > 0) {
          const { error: updateErr } = await adminClient
            .from("orders")
            .update({ status: new_status, updated_at: new Date().toISOString() })
            .in("id", toUpdate);
          if (updateErr) return json({ error: sanitizeDbError(updateErr) }, 400);

          // Log in order_history
          const { data: adminProfile } = await adminClient
            .from("profiles")
            .select("full_name")
            .eq("user_id", user.id)
            .single();

          // Bulk-confirming credits the confirmer, but never overwrites an
          // existing one (the .is(null) guard) — so a CSV flip to shipped/paid
          // leaves the original confirmer intact.
          // The *only* way to change confirmed_by after it is set is the
          // privileged POST /orders/:id/attribution endpoint (admin-only).
          if (new_status === "confirmed") {
            await adminClient
              .from("orders")
              .update({
                confirmed_by_agent_id: user.id,
                confirmed_by_name: adminProfile?.full_name || "System",
                confirmed_at: new Date().toISOString(),
              })
              .in("id", toUpdate)
              .is("confirmed_by_name", null);
            // TV leaderboard: bulk confirm changes today's counts — refresh the
            // board (no per-agent celebration for bulk operations).
            await broadcastLeaderboard("refresh", { bulk: true });
          }

          const historyRows = toUpdate.map(oid => {
            const prev = (currentOrders || []).find((o: any) => o.id === oid);
            return {
              order_id: oid,
              from_status: prev?.status || null,
              to_status: new_status,
              changed_by: user.id,
              changed_by_name: adminProfile?.full_name || "System",
            };
          });
          await adminClient.from("order_history").insert(historyRows);
        }
      }

      await audit(adminClient, user.id, user.email, "order.bulk_status_update", {
        target_type: "order",
        target_name: `${toUpdate.length} → ${new_status}`,
        payload: { new_status, updated_ids: toUpdate, skipped_ids: skipped, count: toUpdate.length },
      });
      return json({ success: true, updated: toUpdate.length, skipped: skipped.length, skipped_ids: skipped });
    }

    // POST /api/orders/bigarena-sync — daily upload of BigArena tracking export (CSV/XLSX)
    // Client sends clean parsed array (never raw file) after preview. Ref = numeric part of display_id.
    // Only transitions *shipped* (or delivered) orders to paid/returned. Full audit + provenance notes.
    if (req.method === "POST" && path === "orders/bigarena-sync") {
      if (!isAdminOrManager && !isWarehouse) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "orders.bigarena-sync", 8)) return json({ error: "Rate limit exceeded — try again in a minute" }, 429);

      const body = await req.json();
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      const meta = body?.meta || {};
      if (updates.length === 0) return json({ error: "updates[] required" }, 400);
      if (updates.length > 1000) return json({ error: "Too many rows (max 1000 per upload)" }, 400);

      const filename = (meta.filename || 'bigarena-upload').toString().slice(0, 120);

      // Normalize refs (keep only digits, match the fulfilment CSV export convention)
      const work = updates.map((u: any) => ({
        ref: String(u.ref || '').replace(/\D/g, ''),
        rawStatus: String(u.rawStatus || ''),
        target: (u.targetStatus === 'paid' || u.targetStatus === 'returned' || u.targetStatus === 'cancelled') ? u.targetStatus : null,
      })).filter(w => w.ref && w.target);

      if (work.length === 0) return json({ success: true, updated: { paid: 0, returned: 0 }, skipped: [], note: 'No valid ref+target after normalization' });

      const uniqueRefs = [...new Set(work.map(w => w.ref))];

      // Batch candidate fetch (ilike on display_id is safe for small batches; we filter exact numeric in JS)
      const orClauses = uniqueRefs.map(r => `display_id.ilike.%${r}%`).join(',');
      const { data: candidates, error: candErr } = await adminClient
        .from("orders")
        .select("id, display_id, status, customer_name")
        .or(orClauses);
      if (candErr) return json({ error: sanitizeDbError(candErr) }, 400);

      // Exact numeric match + only eligible current statuses
      const refToOrder: Record<string, any> = {};
      for (const o of (candidates || [])) {
        const num = String(o.display_id || '').replace(/\D/g, '');
        if (uniqueRefs.includes(num) && (o.status === 'shipped' || o.status === 'delivered')) {
          refToOrder[num] = o; // last wins if weird dupes (should not happen)
        }
      }

      const toPaidIds: string[] = [];
      const toReturnedIds: string[] = [];
      const toCancelledIds: string[] = [];
      const skipped: any[] = [];
      const matchedRefs: string[] = [];

      for (const w of work) {
        const order = refToOrder[w.ref];
        if (!order) {
          skipped.push({ ref: w.ref, reason: 'not_found_or_not_shipped' });
          continue;
        }
        if (order.status === w.target) {
          skipped.push({ ref: w.ref, display_id: order.display_id, reason: 'already_' + w.target });
          continue;
        }
        matchedRefs.push(w.ref);
        if (w.target === 'paid') toPaidIds.push(order.id);
        else if (w.target === 'cancelled') toCancelledIds.push(order.id);
        else toReturnedIds.push(order.id);
      }

      const updated: { paid: number; returned: number; cancelled: number } = { paid: 0, returned: 0, cancelled: 0 };

      // Helper to write a provenance note (non-fatal)
      const addProvenanceNote = async (orderId: string, ref: string, raw: string, toStatus: string) => {
        try {
          await adminClient.from("order_notes").insert({
            order_id: orderId,
            text: `BigArena sync (${filename}): "${raw}" → ${toStatus} (ref ${ref})`,
            author_id: user.id,
            author_name: "BigArena Sync",
          });
        } catch (e) { /* best effort */ }
      };

      // Process PAID group (no stock impact, just status + history)
      if (toPaidIds.length > 0) {
        const { error: upErr } = await adminClient
          .from("orders")
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .in("id", toPaidIds);
        if (upErr) return json({ error: sanitizeDbError(upErr) }, 400);

        const { data: prof } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
        const actorName = prof?.full_name || "System";

        const hist = toPaidIds.map(id => {
          const o = Object.values(refToOrder).find((x: any) => x.id === id);
          return { order_id: id, from_status: o?.status || 'shipped', to_status: 'paid', changed_by: user.id, changed_by_name: actorName };
        });
        await adminClient.from("order_history").insert(hist);

        // Provenance notes + count
        for (const id of toPaidIds) {
          const o = Object.values(refToOrder).find((x: any) => x.id === id) as any;
          const w = work.find(ww => refToOrder[ww.ref]?.id === id);
          if (o && w) await addProvenanceNote(id, w.ref, w.rawStatus, 'paid');
        }
        updated.paid = toPaidIds.length;
      }

      // Process RETURNED group (full stock restore + logs, exactly like bulk)
      if (toReturnedIds.length > 0) {
        for (const oid of toReturnedIds) {
          const { data: orderItems } = await adminClient.from("order_items").select("*").eq("order_id", oid);
          if (orderItems && orderItems.length > 0) {
            for (const item of orderItems) {
              if (!item.product_id) continue;
              const { data: prod } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
              if (prod) {
                const newQty = (prod.stock_quantity || 0) + (item.quantity || 1);
                await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", item.product_id);
                await adminClient.from("inventory_logs").insert({
                  product_id: item.product_id,
                  change_amount: item.quantity || 1,
                  previous_stock: prod.stock_quantity,
                  new_stock: newQty,
                  reason: "order_return",
                  movement_type: "order_return",
                  user_id: user.id,
                  notes: `BigArena sync returned — ${item.product_name} x${item.quantity}`,
                });
              }
            }
          } else {
            // Legacy single-product path
            const { data: full } = await adminClient.from("orders").select("product_id, quantity, display_id, product_name").eq("id", oid).single();
            if (full?.product_id) {
              const qty = full.quantity || 1;
              const { data: prod } = await adminClient.from("products").select("stock_quantity, name").eq("id", full.product_id).single();
              if (prod) {
                const newQty = (prod.stock_quantity || 0) + qty;
                await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", full.product_id);
                await adminClient.from("inventory_logs").insert({
                  product_id: full.product_id,
                  change_amount: qty,
                  previous_stock: prod.stock_quantity,
                  new_stock: newQty,
                  reason: "order_return",
                  movement_type: "order_return",
                  user_id: user.id,
                  notes: `BigArena sync returned — ${full.display_id}`,
                });
              }
            }
          }
        }

        const { error: upErr } = await adminClient
          .from("orders")
          .update({ status: 'returned', updated_at: new Date().toISOString(), returned_at: new Date().toISOString() })
          .in("id", toReturnedIds);
        if (upErr) return json({ error: sanitizeDbError(upErr) }, 400);

        const { data: prof } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
        const actorName = prof?.full_name || "System";

        const hist = toReturnedIds.map(id => {
          const o = Object.values(refToOrder).find((x: any) => x.id === id);
          return { order_id: id, from_status: o?.status || 'shipped', to_status: 'returned', changed_by: user.id, changed_by_name: actorName };
        });
        await adminClient.from("order_history").insert(hist);

        for (const id of toReturnedIds) {
          const o = Object.values(refToOrder).find((x: any) => x.id === id) as any;
          const w = work.find(ww => refToOrder[ww.ref]?.id === id);
          if (o && w) await addProvenanceNote(id, w.ref, w.rawStatus, 'returned');
        }
        updated.returned = toReturnedIds.length;
      }

      // Process CANCELLED group (BigArena "Отменена"/"Анулирана" — cancelled at the
      // warehouse, never went out → NO stock restore, just status + history + note).
      if (toCancelledIds.length > 0) {
        const { error: upErr } = await adminClient
          .from("orders")
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .in("id", toCancelledIds);
        if (upErr) return json({ error: sanitizeDbError(upErr) }, 400);

        const { data: prof } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
        const actorName = prof?.full_name || "System";

        const hist = toCancelledIds.map(id => {
          const o = Object.values(refToOrder).find((x: any) => x.id === id);
          return { order_id: id, from_status: o?.status || 'shipped', to_status: 'cancelled', changed_by: user.id, changed_by_name: actorName };
        });
        await adminClient.from("order_history").insert(hist);

        for (const id of toCancelledIds) {
          const o = Object.values(refToOrder).find((x: any) => x.id === id) as any;
          const w = work.find(ww => refToOrder[ww.ref]?.id === id);
          if (o && w) await addProvenanceNote(id, w.ref, w.rawStatus, 'cancelled');
        }
        updated.cancelled = toCancelledIds.length;
      }

      await audit(adminClient, user.id, user.email, "order.bigarena_status_sync", {
        target_type: "order",
        target_name: `${filename} (${matchedRefs.length} matched)`,
        payload: {
          filename,
          updated,
          skipped_count: skipped.length,
          matched_refs: matchedRefs,
          total_submitted: updates.length,
        },
      });

      return json({
        success: true,
        updated,
        skipped,
        matched: matchedRefs.length,
        unmatchedRefs: uniqueRefs.filter(r => !matchedRefs.includes(r)),
      });
    }

    // GET /api/orders/:id
    const reservedOrderPaths = ["stats", "assigned", "unassigned-pending", "bulk-assign", "bulk-unassign", "bulk-status-update", "bigarena-sync"];
    if (req.method === "GET" && segments[0] === "orders" && segments.length === 2 && !reservedOrderPaths.includes(segments[1])) {
      const orderId = segments[1];
      const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      if (error || !order) return json({ error: "Order not found" }, 404);

      // Get order items
      const { data: orderItems } = await adminClient
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      // Get history and notes
      const { data: history } = await supabase
        .from("order_history")
        .select("*")
        .eq("order_id", orderId)
        .order("changed_at", { ascending: false });

      const { data: notes } = await supabase
        .from("order_notes")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });

      // Check phone duplicates
      const { data: dupes } = await adminClient.rpc("check_phone_duplicates", {
        _phone: order.customer_phone,
        _exclude_order_id: order.id,
      });

      // Mask customer identity per role; hide the status timeline + duplicate-order
      // lookups when the role can't see order history (e.g. investor managers).
      return json({
        ...redactCustomer(order, piiFlags),
        order_items: orderItems || [],
        history: showOrderHistory ? history : [],
        notes,
        phone_duplicates: showOrderHistory ? dupes : [],
      });
    }

    // PATCH /api/orders/:id/customer (update editable fields)
    if (req.method === "PATCH" && segments[0] === "orders" && segments[2] === "customer") {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const orderId = segments[1];
      let body;
      try { body = parseBody(updateCustomerSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      // Check if order is in a locked status for product/price edits
      const hasProductFields = body.price !== undefined || body.quantity !== undefined || body.product_id !== undefined || body.product_name !== undefined;
      if (hasProductFields) {
        const { data: currentOrder } = await supabase.from("orders").select("status").eq("id", orderId).single();
        if (currentOrder) {
          const lockedStatuses = ["shipped", "delivered", "paid"];
          if (lockedStatuses.includes(currentOrder.status)) {
            return json({ error: "Product and price locked because order is Shipped, Delivered, or Paid." }, 400);
          }
        }
      }

      const updates: Record<string, any> = {};
      if (body.customer_name !== undefined) updates.customer_name = body.customer_name;
      if (body.customer_phone !== undefined) updates.customer_phone = body.customer_phone;
      if (body.customer_city !== undefined) updates.customer_city = body.customer_city;
      if (body.customer_address !== undefined) updates.customer_address = body.customer_address;
      if (body.postal_code !== undefined) updates.postal_code = body.postal_code;
      if (body.street !== undefined) updates.street = body.street;
      if (body.street_number !== undefined) updates.street_number = body.street_number;
      if (body.quarter !== undefined) updates.quarter = body.quarter;
      if (body.apartment !== undefined) updates.apartment = body.apartment;
      if (body.floor !== undefined) updates.floor = body.floor;
      if (body.block !== undefined) updates.block = body.block;
      if (body.entry !== undefined) updates.entry = body.entry;
      if (body.delivery_instructions !== undefined) updates.delivery_instructions = body.delivery_instructions;
      if (body.gift_note !== undefined) updates.gift_note = body.gift_note;
      if (body.delivery_type !== undefined) updates.delivery_type = body.delivery_type;
      if (body.home_courier !== undefined) updates.home_courier = body.home_courier;
      if (body.courier_office_code !== undefined) updates.courier_office_code = body.courier_office_code;
      if (body.courier_office_name !== undefined) updates.courier_office_name = body.courier_office_name;
      if (body.courier_office_city !== undefined) updates.courier_office_city = body.courier_office_city;
      if (body.birthday !== undefined) updates.birthday = body.birthday;
      if (body.price !== undefined) updates.price = body.price;
      if (body.quantity !== undefined) updates.quantity = body.quantity;
      if (body.product_id !== undefined) updates.product_id = body.product_id;
      if (body.product_name !== undefined) updates.product_name = body.product_name;
      if (body.ship_after_date !== undefined) updates.ship_after_date = body.ship_after_date;

      // Office orders: keep postal_code equal to the courier office's own post
      // code. Re-resolve whenever the delivery method or the office changed.
      if (body.delivery_type !== undefined || body.courier_office_code !== undefined) {
        const { data: cur } = await adminClient
          .from("orders").select("delivery_type, courier_office_code").eq("id", orderId).single();
        const dt = body.delivery_type ?? cur?.delivery_type;
        const code = body.courier_office_code ?? cur?.courier_office_code;
        const pc = await resolveOfficePostCode(dt, code);
        if (pc) updates.postal_code = pc;
      }

      const { data, error } = await supabase
        .from("orders")
        .update(updates)
        .eq("id", orderId)
        .select()
        .single();

      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/orders/:id/status
    if (req.method === "PATCH" && segments[0] === "orders" && segments[2] === "status") {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const orderId = segments[1];
      let body;
      try { body = parseBody(updateStatusSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const newStatus = body.status;

      // Get current order
      const { data: order } = await adminClient
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      if (!order) return json({ error: "Order not found" }, 404);

      // Permission check for non-admins
      const agentAllowed = ["pending", "take", "call_again", "confirmed"];
      const warehouseAllowed = ["confirmed", "shipped", "delivered", "paid"];
      if (!isAdminOrManager) {
        if (isWarehouse && warehouseAllowed.includes(newStatus)) {
          // Warehouse users can set confirmed/shipped
        } else if (!agentAllowed.includes(newStatus)) {
          return json({ error: `You can only set status to: ${agentAllowed.join(", ")}` }, 403);
        }
      }

      // Validation: require fields for certain statuses (only for non-admins).
      // Superadmins (isAdmin) can force any status change without meeting the usual
      // completeness requirements. This is intentional for cleaning up legacy data.
      //
      // Extra leniency: if the order is already shipped (or further) and we're only
      // doing post-shipment status changes (returned/paid/cancelled), admins can
      // always do it even on very old/incomplete records.
      const isPostShipmentAdminEdit =
        isAdmin &&
        ["shipped", "delivered", "paid", "returned"].includes(order.status) &&
        ["returned", "paid", "cancelled"].includes(newStatus);

      const requiresComplete = ["confirmed", "shipped", "returned", "paid", "cancelled"];
      if (!isPostShipmentAdminEdit && !isAdmin && requiresComplete.includes(newStatus)) {
        const hasName = !!order.customer_name?.trim();
        const hasPhone = !!order.customer_phone?.trim();
        const hasCity = !!order.customer_city?.trim() || !!order.courier_office_city?.trim();

        let hasDeliveryInfo = false;
        const dt = order.delivery_type;

        if (dt === 'home') {
          hasDeliveryInfo = !!order.customer_address?.trim();
        } else if (dt === 'speedy_office' || dt === 'econt_office') {
          hasDeliveryInfo = !!order.courier_office_code?.trim() || !!order.courier_office_name?.trim();
        } else {
          // Legacy / unknown delivery type (very old orders). Accept either style.
          hasDeliveryInfo = !!order.customer_address?.trim() ||
                            !!order.courier_office_code?.trim() ||
                            !!order.courier_office_name?.trim();
        }

        if (!hasName || !hasPhone || !hasCity || !hasDeliveryInfo) {
          return json({ 
            error: "Name, Telephone, City, and delivery information (Address or Courier Office) must be filled before changing to this status" 
          }, 400);
        }
      }

      // Stock deduction on SHIPPED (not confirmed) — supports multi-product orders
      if (newStatus === "shipped" && order.status !== "shipped") {
        // Check for order_items first (multi-product)
        const { data: orderItems } = await adminClient.from("order_items").select("*").eq("order_id", orderId);

        if (orderItems && orderItems.length > 0) {
          // Multi-product: deduct stock for each item
          for (const item of orderItems) {
            if (!item.product_id) continue;
            const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
            if (product && product.stock_quantity < item.quantity) {
              return json({ error: `Insufficient stock: ${product.name} has ${product.stock_quantity} available, but order requires ${item.quantity}` }, 400);
            }
          }
          // All stock checks passed, now deduct
          for (const item of orderItems) {
            if (!item.product_id) continue;
            const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
            if (product) {
              const newQty = product.stock_quantity - item.quantity;
              await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", item.product_id);
              await adminClient.from("inventory_logs").insert({
                product_id: item.product_id,
                change_amount: -item.quantity,
                previous_stock: product.stock_quantity,
                new_stock: newQty,
                reason: "order_deduction",
                movement_type: "order_deduction",
                user_id: user.id,
                notes: `Order ${order.display_id} shipped — ${item.product_name}`,
              });
            }
          }
        } else if (order.product_id) {
          // Legacy single-product fallback
          const orderQty = order.quantity || 1;
          const { data: product } = await adminClient
            .from("products")
            .select("stock_quantity, name")
            .eq("id", order.product_id)
            .single();
          if (product && product.stock_quantity < orderQty) {
            return json({ error: `Insufficient stock: ${product.name} has ${product.stock_quantity} available, but order requires ${orderQty}` }, 400);
          }
          if (product && product.stock_quantity >= orderQty) {
            const newQty = product.stock_quantity - orderQty;
            await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", order.product_id);
            await adminClient.from("inventory_logs").insert({
              product_id: order.product_id,
              change_amount: -orderQty,
              previous_stock: product.stock_quantity,
              new_stock: newQty,
              reason: "order_deduction",
              movement_type: "order_deduction",
              user_id: user.id,
              notes: `Order ${order.display_id} shipped`,
            });
          }
        }
      }

      // Stock return on RETURNED — add products back to inventory
      if (newStatus === "returned" && order.status !== "returned") {
        const { data: orderItems } = await adminClient.from("order_items").select("*").eq("order_id", orderId);

        if (orderItems && orderItems.length > 0) {
          for (const item of orderItems) {
            if (!item.product_id) continue;
            const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
            if (product) {
              const newQty = product.stock_quantity + item.quantity;
              await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", item.product_id);
              await adminClient.from("inventory_logs").insert({
                product_id: item.product_id,
                change_amount: item.quantity,
                previous_stock: product.stock_quantity,
                new_stock: newQty,
                reason: "order_return",
                movement_type: "order_return",
                user_id: user.id,
                notes: `Order ${order.display_id} returned — ${item.product_name} x${item.quantity}`,
              });
            }
          }
        } else if (order.product_id) {
          const orderQty = order.quantity || 1;
          const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", order.product_id).single();
          if (product) {
            const newQty = product.stock_quantity + orderQty;
            await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", order.product_id);
            await adminClient.from("inventory_logs").insert({
              product_id: order.product_id,
              change_amount: orderQty,
              previous_stock: product.stock_quantity,
              new_stock: newQty,
              reason: "order_return",
              movement_type: "order_return",
              user_id: user.id,
              notes: `Order ${order.display_id} returned — ${order.product_name} x${orderQty}`,
            });
          }
        }
      }

      // Get profile name
      const { data: profile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();

      // Update status — also write structured reason fields when present
      // so the customer lands in the right Cancelled / Returned mirror list.
      const update: Record<string, any> = { status: newStatus };
      if (newStatus === "cancelled") {
        if (body.cancellation_reason) update.cancellation_reason = body.cancellation_reason;
        if (body.cancellation_reason_notes !== undefined) update.cancellation_reason_notes = body.cancellation_reason_notes;
        if (!order.cancelled_at) update.cancelled_at = new Date().toISOString();
        if (!order.cancelled_by_agent_id) update.cancelled_by_agent_id = user.id;
      }
      if (newStatus === "returned") {
        if (body.return_reason) update.return_reason = body.return_reason;
        if (body.return_reason_notes !== undefined) update.return_reason_notes = body.return_reason_notes;
        if (!order.returned_at) update.returned_at = new Date().toISOString();
      }
      if (newStatus === "trashed") {
        if (body.trash_reason) update.trash_reason = body.trash_reason;
        if (body.trash_reason_notes !== undefined) update.trash_reason_notes = body.trash_reason_notes;
      }
      // First time this order becomes a real order, credit the confirmer.
      // Never overwrite an existing value (normal status flows), so shipped/paid
      // keep the original agent who confirmed it.
      // The only supported way to change the original sales credit later is the
      // admin-only POST /orders/:id/attribution endpoint.
      if (REAL_ORDER_STATUSES.includes(newStatus) && !order.confirmed_by_name) {
        update.confirmed_by_agent_id = user.id;
        update.confirmed_by_name = profile?.full_name || user.email;
        update.confirmed_at = new Date().toISOString();
      }
      const { error: updateErr } = await adminClient
        .from("orders")
        .update(update)
        .eq("id", orderId);
      if (updateErr) return json({ error: sanitizeDbError(updateErr) }, 400);

      // TV leaderboard: only nudge on a FRESH confirm (this is when confirmed_at
      // is set to today). Later flips (confirmed→shipped→paid) don't change
      // today's confirmed count, so they don't celebrate.
      if (REAL_ORDER_STATUSES.includes(newStatus) && !order.confirmed_by_name) {
        await broadcastLeaderboard("confirmed", { agent_id: user.id, order_id: orderId });
      }

      // Log history
      await adminClient.from("order_history").insert({
        order_id: orderId,
        from_status: order.status,
        to_status: newStatus,
        changed_by: user.id,
        changed_by_name: profile?.full_name || user.email,
      });

      // Sync status to linked inbound lead
      if (order.inbound_lead_id) {
        const inboundStatusMap: Record<string, string> = {
          pending: "pending", take: "contacted", call_again: "contacted",
          confirmed: "converted", shipped: "converted", delivered: "converted",
          paid: "converted", returned: "rejected", trashed: "rejected", cancelled: "rejected",
        };
        const inboundStatus = inboundStatusMap[newStatus] || "contacted";
        await adminClient.from("inbound_leads").update({ status: inboundStatus }).eq("id", order.inbound_lead_id);
      }

      return json({ success: true });
    }

    // POST /api/orders/:id/attribution — privileged admin-only manual correction
    // of the original sales credit (confirmed_by_*). This is the escape hatch
    // the user requested so super-admins can fix mis-attributed orders or
    // re-assign credit when needed, while normal status flows keep the
    // original confirmer immutable.
    if (req.method === "POST" && segments[0] === "orders" && segments[2] === "attribution") {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      const orderId = segments[1];
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      const targetAgentId: string | null = body?.confirmed_by_agent_id ?? null;

      const { data: order } = await adminClient
        .from("orders")
        .select("id, confirmed_by_name")
        .eq("id", orderId)
        .single();
      if (!order) return json({ error: "Order not found" }, 404);

      let newConfirmedById: string | null = null;
      let newConfirmedByName: string | null = null;
      let newConfirmedAt: string | null = null;

      if (targetAgentId) {
        const { data: profile } = await adminClient
          .from("profiles")
          .select("full_name")
          .eq("user_id", targetAgentId)
          .single();
        if (!profile) return json({ error: "Target agent not found" }, 404);

        newConfirmedById = targetAgentId;
        newConfirmedByName = profile.full_name || "Admin";
        newConfirmedAt = new Date().toISOString();
      }

      const { error: updErr } = await adminClient
        .from("orders")
        .update({
          confirmed_by_agent_id: newConfirmedById,
          confirmed_by_name: newConfirmedByName,
          confirmed_at: newConfirmedAt,
        })
        .eq("id", orderId);
      if (updErr) return json({ error: sanitizeDbError(updErr) }, 400);

      // Audit + history entry so the change is fully traceable
      const { data: adminProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();

      await adminClient.from("order_history").insert({
        order_id: orderId,
        from_status: null,
        to_status: null,
        changed_by: user.id,
        changed_by_name: `${adminProfile?.full_name || user.email} — Manual attribution correction (was: ${order.confirmed_by_name || 'none'})`,
      });

      await audit(adminClient, user.id, user.email, "order.attribution_correction", {
        target_type: "order",
        target_id: orderId,
        payload: {
          previous_confirmed_by: order.confirmed_by_name,
          new_confirmed_by_agent_id: newConfirmedById,
          new_confirmed_by_name: newConfirmedByName,
        },
      });

      return json({ success: true, confirmed_by_name: newConfirmedByName });
    }

    // POST /api/orders/:id/assign
    if (req.method === "POST" && segments[0] === "orders" && segments[2] === "assign") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      const orderId = segments[1];
      const body = await req.json();
      const { agent_id } = body;

      const { data: agentProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", agent_id)
        .single();
      if (!agentProfile) return json({ error: "Agent not found" }, 404);

      const { data: adminProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();

      await adminClient
        .from("orders")
        .update({
          assigned_agent_id: agent_id,
          assigned_agent_name: agentProfile.full_name,
          assigned_at: new Date().toISOString(),
          assigned_by: adminProfile?.full_name || "Admin",
        })
        .eq("id", orderId);

      // Ping the assigned agent (unless they assigned it to themselves).
      if (agent_id !== user.id) {
        await notifyUsers(adminClient, [agent_id], {
          type: "assignment",
          title: "New order assigned to you",
          message: "An order was assigned to you — open Assigned to Me to start.",
          link: "/assigned",
        });
      }

      return json({ success: true });
    }

    // ============================================================
    // ORDER ITEMS CRUD
    // ============================================================

    // POST /api/orders/:id/items (add product to order)
    if (req.method === "POST" && segments[0] === "orders" && segments[2] === "items") {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const orderId = segments[1];
      const body = await req.json();
      const productId = body.product_id || null;
      const productName = body.product_name || "";
      const quantity = body.quantity || 1;
      const pricePerUnit = body.price_per_unit || 0;
      const totalPrice = quantity * pricePerUnit;

      // Check order is editable
      const { data: currentOrder } = await supabase.from("orders").select("status, display_id").eq("id", orderId).single();
      if (!currentOrder) return json({ error: "Order not found" }, 404);
      const lockedStatuses = ["shipped", "delivered", "paid"];
      if (lockedStatuses.includes(currentOrder.status)) {
        return json({ error: "Cannot modify products — order is locked." }, 400);
      }

      const { data: item, error: itemErr } = await adminClient
        .from("order_items")
        .insert({ order_id: orderId, product_id: productId, product_name: productName, quantity, price_per_unit: pricePerUnit, total_price: totalPrice })
        .select()
        .single();
      if (itemErr) return json({ error: sanitizeDbError(itemErr) }, 400);

      // Recalculate order total from all items
      const { data: allItems } = await adminClient.from("order_items").select("total_price").eq("order_id", orderId);
      const orderTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0);
      await adminClient.from("orders").update({ price: orderTotal }).eq("id", orderId);

      // Log timeline
      const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
      await adminClient.from("order_history").insert({
        order_id: orderId,
        from_status: currentOrder.status,
        to_status: currentOrder.status,
        changed_by: user.id,
        changed_by_name: `${profile?.full_name || user.email} — Product added: ${productName} (Qty ${quantity})`,
      });

      return json(item);
    }

    // PATCH /api/order-items/:id (update order item)
    if (req.method === "PATCH" && segments[0] === "order-items" && segments.length === 2) {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const itemId = segments[1];
      const body = await req.json();

      // Get current item to find its order
      const { data: currentItem } = await adminClient.from("order_items").select("*, orders(status, id, display_id)").eq("id", itemId).single();
      if (!currentItem) return json({ error: "Item not found" }, 404);

      const lockedStatuses = ["shipped", "delivered", "paid"];
      if (lockedStatuses.includes(currentItem.orders?.status)) {
        return json({ error: "Cannot modify products — order is locked." }, 400);
      }

      const updates: Record<string, any> = {};
      if (body.product_id !== undefined) updates.product_id = body.product_id;
      if (body.product_name !== undefined) updates.product_name = body.product_name;
      if (body.quantity !== undefined) updates.quantity = body.quantity;
      if (body.price_per_unit !== undefined) updates.price_per_unit = body.price_per_unit;

      // Recalculate total_price for this item
      const qty = body.quantity ?? currentItem.quantity;
      const ppu = body.price_per_unit ?? currentItem.price_per_unit;
      updates.total_price = qty * ppu;

      const { data: updatedItem, error: updateErr } = await adminClient
        .from("order_items")
        .update(updates)
        .eq("id", itemId)
        .select()
        .single();
      if (updateErr) return json({ error: sanitizeDbError(updateErr) }, 400);

      // Recalculate order total
      const orderId = currentItem.order_id;
      const { data: allItems } = await adminClient.from("order_items").select("total_price").eq("order_id", orderId);
      const orderTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0);
      await adminClient.from("orders").update({ price: orderTotal }).eq("id", orderId);

      // Log timeline
      const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
      await adminClient.from("order_history").insert({
        order_id: orderId,
        from_status: currentItem.orders?.status,
        to_status: currentItem.orders?.status,
        changed_by: user.id,
        changed_by_name: `${profile?.full_name || user.email} — Product updated: ${updates.product_name || currentItem.product_name}`,
      });

      return json(updatedItem);
    }

    // DELETE /api/order-items/:id (remove product from order)
    if (req.method === "DELETE" && segments[0] === "order-items" && segments.length === 2) {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const itemId = segments[1];

      const { data: currentItem } = await adminClient.from("order_items").select("*, orders(status, id, display_id)").eq("id", itemId).single();
      if (!currentItem) return json({ error: "Item not found" }, 404);

      const lockedStatuses = ["shipped", "delivered", "paid"];
      if (lockedStatuses.includes(currentItem.orders?.status)) {
        return json({ error: "Cannot modify products — order is locked." }, 400);
      }

      const orderId = currentItem.order_id;
      const removedName = currentItem.product_name;

      await adminClient.from("order_items").delete().eq("id", itemId);

      // Recalculate order total
      const { data: allItems } = await adminClient.from("order_items").select("total_price").eq("order_id", orderId);
      const orderTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0);
      await adminClient.from("orders").update({ price: orderTotal }).eq("id", orderId);

      // Log timeline
      const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
      await adminClient.from("order_history").insert({
        order_id: orderId,
        from_status: currentItem.orders?.status,
        to_status: currentItem.orders?.status,
        changed_by: user.id,
        changed_by_name: `${profile?.full_name || user.email} — Product removed: ${removedName}`,
      });

      return json({ success: true });
    }

    // PUT /api/orders/:id/items (atomic sync – overwrite all items, recalculate total, return updated order)
    if (req.method === "PUT" && segments[0] === "orders" && segments[2] === "items") {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const orderId = segments[1];
      const body = await req.json();
      const newItems: any[] = body.items;
      if (!Array.isArray(newItems)) return json({ error: "items array is required" }, 400);

      // Check order exists and is editable
      const { data: currentOrder } = await supabase.from("orders").select("status, display_id").eq("id", orderId).single();
      if (!currentOrder) return json({ error: "Order not found" }, 404);
      const lockedStatuses = ["shipped", "delivered", "paid"];
      if (lockedStatuses.includes(currentOrder.status)) {
        return json({ error: "Cannot modify products — order is locked." }, 400);
      }

      // Delete all existing items
      await adminClient.from("order_items").delete().eq("order_id", orderId);

      // Insert new items
      let orderTotal = 0;
      const insertedItems: any[] = [];
      for (const ni of newItems) {
        const qty = Math.max(1, ni.quantity || 1);
        const ppu = Math.max(0, ni.price_per_unit || 0);
        const tp = Math.round(qty * ppu * 100) / 100;
        orderTotal += tp;
        const { data: inserted } = await adminClient.from("order_items")
          .insert({ order_id: orderId, product_id: ni.product_id || null, product_name: ni.product_name || "", quantity: qty, price_per_unit: ppu, total_price: tp })
          .select().single();
        if (inserted) insertedItems.push(inserted);
      }

      orderTotal = Math.round(orderTotal * 100) / 100;

      // Update order total + product summary fields
      // Build nice "Name xN" summary so legacy fallbacks and lists show clean output
      const summaryName = insertedItems
        .map(i => (i.quantity > 1 ? `${i.product_name} x${i.quantity}` : i.product_name))
        .filter(Boolean)
        .join(", ");
      const summaryQty = insertedItems.reduce((s: number, i: any) => s + i.quantity, 0);
      await adminClient.from("orders").update({
        price: orderTotal,
        product_name: summaryName || currentOrder.display_id,
        quantity: summaryQty || 1,
      }).eq("id", orderId);

      // Timeline log
      const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
      await adminClient.from("order_history").insert({
        order_id: orderId,
        from_status: currentOrder.status,
        to_status: currentOrder.status,
        changed_by: user.id,
        changed_by_name: `${profile?.full_name || user.email} — Products synced (${insertedItems.length} items, total ${orderTotal})`,
      });

      // Return full updated order
      const { data: updatedOrder } = await adminClient.from("orders").select("*").eq("id", orderId).single();
      return json({ ...updatedOrder, order_items: insertedItems });
    }

    // POST /api/orders/:id/notes
    if (req.method === "POST" && segments[0] === "orders" && segments[2] === "notes") {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      const orderId = segments[1];
      const body = await req.json();
      if (!body.text?.trim()) return json({ error: "Note text is required" }, 400);

      const { data: profile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();

      const { data: note, error } = await supabase
        .from("order_notes")
        .insert({
          order_id: orderId,
          text: body.text.trim(),
          author_id: user.id,
          author_name: profile?.full_name || user.email || "Unknown",
        })
        .select()
        .single();

      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(note);
    }

    // GET /api/dashboard-stats?period=today|yesterday|month&agent_id=xxx
    if (req.method === "GET" && path === "dashboard-stats") {
      const period = url.searchParams.get("period") || "today";
      const agentFilter = url.searchParams.get("agent_id");

      const now = new Date();
      const todayStr = now.toISOString().substring(0, 10);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().substring(0, 10);
      const monthStart = todayStr.substring(0, 7) + "-01";

      let fromDate: string, toDate: string;
      if (period === "yesterday") {
        fromDate = yesterdayStr + "T00:00:00Z";
        toDate = yesterdayStr + "T23:59:59Z";
      } else if (period === "month") {
        fromDate = monthStart + "T00:00:00Z";
        toDate = now.toISOString();
      } else {
        fromDate = todayStr + "T00:00:00Z";
        toDate = now.toISOString();
      }

      // PostgREST default page size is 1000. Paginate so a single high-volume
      // day doesn't silently truncate the dashboard.
      const paginate = async <T,>(makeQuery: () => any, pageSize = 1000): Promise<T[]> => {
        const all: T[] = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await makeQuery().range(from, from + pageSize - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < pageSize) break;
        }
        return all;
      };

      // Helper to compute metrics for a given agent filter
      async function computeMetrics(effectiveAgentId: string | null) {
        const orders = await paginate<any>(() => {
          let q = adminClient.from("orders").select("id, status, price, created_at, assigned_agent_id").gte("created_at", fromDate).lte("created_at", toDate)
            .or("source_type.is.null,source_type.neq.monadon_legacy"); // exclude Monadon legacy (another company's revenue)
          if (effectiveAgentId) q = q.eq("assigned_agent_id", effectiveAgentId);
          return q;
        });
        const leads = await paginate<any>(() => {
          let q = adminClient.from("prediction_leads").select("id, status, created_at, assigned_agent_id, product").gte("created_at", fromDate).lte("created_at", toDate);
          if (effectiveAgentId) q = q.eq("assigned_agent_id", effectiveAgentId);
          return q;
        });
        const calls = await paginate<any>(() => {
          let q = adminClient.from("call_logs").select("id, agent_id, created_at").gte("created_at", fromDate).lte("created_at", toDate);
          if (effectiveAgentId) q = q.eq("agent_id", effectiveAgentId);
          return q;
        });

        const lead_count = leads.length;
        // deals_won: orders only
        const deals_won = orders.filter((o: any) => ["confirmed", "shipped", "delivered", "paid"].includes(o.status)).length;
        const deals_lost = orders.filter((o: any) => ["returned", "cancelled", "trashed"].includes(o.status)).length;
        const total_value = orders.filter((o: any) => ["confirmed", "shipped", "delivered", "paid"].includes(o.status)).reduce((sum: number, o: any) => sum + Number(o.price || 0), 0);
        const tasks_completed = calls.length;
        // total_orders: orders only
        const total_orders = orders.length;

        // Source breakdown
        const orders_from_standard = orders.filter((o: any) => ["confirmed", "shipped", "delivered", "paid"].includes(o.status)).length;
        const orders_from_leads = 0;

        const dailyBreakdown: Record<string, { leads: number; deals_won: number; deals_lost: number; orders: number; calls: number }> = {};
        for (const o of orders) {
          const day = o.created_at.substring(0, 10);
          if (!dailyBreakdown[day]) dailyBreakdown[day] = { leads: 0, deals_won: 0, deals_lost: 0, orders: 0, calls: 0 };
          dailyBreakdown[day].orders++;
          if (["confirmed", "shipped", "delivered", "paid"].includes(o.status)) dailyBreakdown[day].deals_won++;
          if (["returned", "cancelled", "trashed"].includes(o.status)) dailyBreakdown[day].deals_lost++;
        }
        for (const l of leads) {
          const day = l.created_at.substring(0, 10);
          if (!dailyBreakdown[day]) dailyBreakdown[day] = { leads: 0, deals_won: 0, deals_lost: 0, orders: 0, calls: 0 };
          dailyBreakdown[day].leads++;
        }
        for (const c of calls) {
          const day = c.created_at.substring(0, 10);
          if (!dailyBreakdown[day]) dailyBreakdown[day] = { leads: 0, deals_won: 0, deals_lost: 0, orders: 0, calls: 0 };
          dailyBreakdown[day].calls++;
        }

        const statusCounts: Record<string, number> = {};
        for (const o of orders) {
          statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        }

        // Products sold: line items on this agent's WON orders. order_items
        // carries a denormalised product_name + quantity, so no join needed.
        // Legacy imported orders have no items and simply contribute nothing.
        const wonIds = orders
          .filter((o: any) => ["confirmed", "shipped", "delivered", "paid"].includes(o.status))
          .map((o: any) => o.id);
        const products_sold: Record<string, number> = {};
        let units_sold = 0;
        for (let i = 0; i < wonIds.length; i += 200) {
          const chunk = wonIds.slice(i, i + 200);
          const items = await paginate<any>(() =>
            adminClient.from("order_items").select("product_name, quantity, order_id").in("order_id", chunk));
          for (const it of items) {
            const qty = Number(it.quantity || 0);
            units_sold += qty;
            const name = ((it.product_name as string) || "").trim() || "—";
            products_sold[name] = (products_sold[name] || 0) + qty;
          }
        }

        return { lead_count, deals_won, deals_lost, total_value, tasks_completed, total_orders, daily: dailyBreakdown, statusCounts, orders_from_standard, orders_from_leads, products_sold, units_sold };
      }

      if (!isAdminOrManager) {
        // Pure agent: personal stats only
        const metrics = await computeMetrics(user.id);
        return json({ ...metrics, period, from: fromDate, to: toDate });
      }

      // Admin or dual-role: compute admin-level metrics (with optional agent filter)
      const effectiveAgentId = agentFilter || null;
      const adminMetrics = await computeMetrics(effectiveAgentId);

      // For dual-role users, also compute personal metrics
      let personalMetrics = null;
      if (isDualRole && !agentFilter) {
        personalMetrics = await computeMetrics(user.id);
      }

      return json({
        ...adminMetrics,
        personalMetrics,
        isDualRole,
        period, from: fromDate, to: toDate,
      });
    }

    // GET /api/ceo-dashboard-stats?period=today|yesterday|month|custom&from=&to=&agent_id=
    if (req.method === "GET" && path === "ceo-dashboard-stats") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const period = url.searchParams.get("period") || "month";
      const agentFilter = url.searchParams.get("agent_id") || null;
      const customFrom = url.searchParams.get("from");
      const customTo = url.searchParams.get("to");

      const now = new Date();
      const todayStr = now.toISOString().substring(0, 10);
      const monthStart = todayStr.substring(0, 7) + "-01";

      let fromDate: string, toDate: string;
      if (customFrom && customTo) {
        fromDate = customFrom + "T00:00:00Z";
        toDate = customTo + "T23:59:59Z";
      } else if (period === "today") {
        fromDate = todayStr + "T00:00:00Z";
        toDate = now.toISOString();
      } else if (period === "yesterday") {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        fromDate = y.toISOString().substring(0, 10) + "T00:00:00Z";
        toDate = y.toISOString().substring(0, 10) + "T23:59:59Z";
      } else if (period === "all") {
        // "All time" — span everything so created_at-bounded queries are unbounded.
        fromDate = "1970-01-01T00:00:00Z";
        toDate = now.toISOString();
      } else {
        fromDate = monthStart + "T00:00:00Z";
        toDate = now.toISOString();
      }

      // PostgREST caps each SELECT at 1000 rows by default, so once the orders
      // table grows past that the dashboard would compute its KPIs from a
      // truncated sample. Paginate via .range() to fetch everything.
      const paginate = async <T,>(makeQuery: () => any, pageSize = 1000): Promise<T[]> => {
        const all: T[] = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await makeQuery().range(from, from + pageSize - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < pageSize) break;
        }
        return all;
      };

      // Financial KPIs are scoped to the selected period by created_at — the
      // same axis as the funnel/snapshot below — so "Today" means orders that
      // came in today and where they stand now. "All time" (from = 1970) gives
      // the lifetime view. (We deliberately do NOT key off updated_at: a bulk
      // backfill bumps it, which would wrongly pull every order into "today".)
      const financialOrders = await paginate<any>(() => {
        let q = adminClient.from("orders").select("id, status, price, quantity, created_at, updated_at, assigned_agent_id, assigned_agent_name, order_items(price_per_unit, quantity, total_price, product_id), product_id")
          .gte("created_at", fromDate).lte("created_at", toDate)
          .or("source_type.is.null,source_type.neq.monadon_legacy"); // exclude Monadon legacy (another company's revenue)
        if (agentFilter) q = q.eq("assigned_agent_id", agentFilter);
        return q;
      });

      // Fetch period orders by created_at for trend/funnel data
      const periodOrders = await paginate<any>(() => {
        let q = adminClient.from("orders").select("id, status, price, quantity, created_at, updated_at, assigned_agent_id, assigned_agent_name, product_id").gte("created_at", fromDate).lte("created_at", toDate)
          .or("source_type.is.null,source_type.neq.monadon_legacy"); // exclude Monadon legacy (another company's revenue)
        if (agentFilter) q = q.eq("assigned_agent_id", agentFilter);
        return q;
      });

      // Fetch products for cost_price lookup
      const { data: allProducts } = await adminClient.from("products").select("id, cost_price");
      const costMap: Record<string, number> = {};
      for (const p of allProducts || []) costMap[p.id] = Number(p.cost_price || 0);

      // === 1. FINANCIAL KPIs (from ALL orders, not date-filtered) ===
      const confirmedCount = financialOrders.filter((o: any) => o.status === "confirmed").length;
      const shippedCount = financialOrders.filter((o: any) => o.status === "shipped").length;
      const paidOrders = financialOrders.filter((o: any) => o.status === "paid");
      const paidCount = paidOrders.length;
      const paidAmount = paidOrders.reduce((s: number, o: any) => s + Number(o.price || 0), 0);
      const returnedCount = financialOrders.filter((o: any) => o.status === "returned").length;
      const returnedAmount = financialOrders.filter((o: any) => o.status === "returned").reduce((s: number, o: any) => s + Number(o.price || 0), 0);

      // Gross Revenue: shipped + paid
      const revenueOrders = financialOrders.filter((o: any) => ["shipped", "paid"].includes(o.status));
      const revenue = revenueOrders.reduce((s: number, o: any) => s + Number(o.price || 0), 0);

      // Outstanding: shipped only (not paid, not returned)
      const outstandingOrders = financialOrders.filter((o: any) => o.status === "shipped");
      const outstanding = outstandingOrders.reduce((s: number, o: any) => s + Number(o.price || 0), 0);

      // Profit: paid orders only (revenue - cost)
      let totalCost = 0;
      for (const o of paidOrders) {
        const items = o.order_items || [];
        if (items.length > 0) {
          for (const it of items) {
            const cp = costMap[it.product_id] || 0;
            totalCost += cp * (it.quantity || 1);
          }
        } else if (o.product_id) {
          totalCost += (costMap[o.product_id] || 0) * (o.quantity || 1);
        }
      }
      const profit = paidAmount - totalCost;

      // === 2. FUNNEL (from period orders — created in this period) ===
      const taken = periodOrders.filter((o: any) => o.status === "take").length;
      const allTaken = periodOrders.filter((o: any) => ["take", "call_again", "confirmed", "shipped", "delivered", "returned", "paid"].includes(o.status)).length;
      const confirmed = periodOrders.filter((o: any) => ["confirmed", "shipped", "delivered", "returned", "paid"].includes(o.status)).length;
      const paid = periodOrders.filter((o: any) => o.status === "paid").length;
      const shipped = periodOrders.filter((o: any) => ["shipped", "delivered", "returned", "paid"].includes(o.status)).length;
      const returned = periodOrders.filter((o: any) => o.status === "returned").length;
      const pending = periodOrders.filter((o: any) => o.status === "pending").length;

      const conversionRate = allTaken > 0 ? Math.round((paid / allTaken) * 10000) / 100 : 0;
      const confirmationRate = allTaken > 0 ? Math.round((confirmed / allTaken) * 10000) / 100 : 0;
      const returnRate = shipped > 0 ? Math.round((returned / shipped) * 10000) / 100 : 0;

      // === 3. DAILY REVENUE TREND (paid only, by created_at) ===
      const dailyRevenue: Record<string, { revenue: number; orders: number; leads: number }> = {};
      for (const o of periodOrders) {
        const day = o.created_at.substring(0, 10);
        if (!dailyRevenue[day]) dailyRevenue[day] = { revenue: 0, orders: 0, leads: 0 };
        dailyRevenue[day].orders++;
        if (o.status === "paid") dailyRevenue[day].revenue += Number(o.price || 0);
      }
      // Also add prediction leads count
      const pLeads = await paginate<any>(() => {
        let q = adminClient.from("prediction_leads").select("id, created_at").gte("created_at", fromDate).lte("created_at", toDate);
        if (agentFilter) q = q.eq("assigned_agent_id", agentFilter);
        return q;
      });
      for (const l of pLeads || []) {
        const day = l.created_at.substring(0, 10);
        if (!dailyRevenue[day]) dailyRevenue[day] = { revenue: 0, orders: 0, leads: 0 };
        dailyRevenue[day].leads++;
      }

      // === 4. AGENT RANKINGS (from ALL financial orders) ===
      const agentMap: Record<string, { name: string; paidRevenue: number; paidCount: number; takenCount: number; shippedCount: number; returnedCount: number }> = {};
      for (const o of financialOrders) {
        const agentName = o.assigned_agent_name || "Unassigned";
        const agentId = o.assigned_agent_id || "none";
        if (!agentMap[agentId]) agentMap[agentId] = { name: agentName, paidRevenue: 0, paidCount: 0, takenCount: 0, shippedCount: 0, returnedCount: 0 };
        if (["take", "call_again", "confirmed", "shipped", "delivered", "returned", "paid"].includes(o.status)) agentMap[agentId].takenCount++;
        if (o.status === "paid") { agentMap[agentId].paidRevenue += Number(o.price || 0); agentMap[agentId].paidCount++; }
        if (["shipped", "delivered", "returned", "paid"].includes(o.status)) agentMap[agentId].shippedCount++;
        if (o.status === "returned") agentMap[agentId].returnedCount++;
      }
      const agentRankings = Object.values(agentMap)
        .filter((a: any) => a.name !== "Unassigned")
        .sort((a: any, b: any) => b.paidRevenue - a.paidRevenue)
        .map((a: any) => ({
          name: a.name,
          paidRevenue: a.paidRevenue,
          paidCount: a.paidCount,
          conversionPct: a.takenCount > 0 ? Math.round((a.paidCount / a.takenCount) * 10000) / 100 : 0,
          returnPct: a.shippedCount > 0 ? Math.round((a.returnedCount / a.shippedCount) * 10000) / 100 : 0,
        }));

      // === 5. RISK ALERTS ===
      const alerts: { type: string; level: string; message: string }[] = [];
      const totalShippedForAlerts = financialOrders.filter((o: any) => ["shipped", "delivered", "returned", "paid"].includes(o.status)).length;
      const totalReturnedForAlerts = financialOrders.filter((o: any) => o.status === "returned").length;
      const totalTakenForAlerts = financialOrders.filter((o: any) => ["take", "call_again", "confirmed", "shipped", "delivered", "returned", "paid"].includes(o.status)).length;
      const overallReturnRate = totalShippedForAlerts > 0 ? Math.round((totalReturnedForAlerts / totalShippedForAlerts) * 10000) / 100 : 0;
      const overallConversionRate = totalTakenForAlerts > 0 ? Math.round((paidCount / totalTakenForAlerts) * 10000) / 100 : 0;
      const totalPending = financialOrders.filter((o: any) => o.status === "pending").length;
      if (overallReturnRate > 20) alerts.push({ type: "return_rate", level: "red", message: `Return rate is ${overallReturnRate}% (above 20%)` });
      if (overallConversionRate < 10 && totalTakenForAlerts > 5) alerts.push({ type: "conversion", level: "red", message: `Conversion rate is ${overallConversionRate}% (below 10%)` });
      if (outstanding > revenue * 2 && outstanding > 0) alerts.push({ type: "outstanding", level: "yellow", message: `Outstanding balance (${outstanding.toFixed(2)}) is very high` });
      if (totalPending > totalTakenForAlerts * 0.5 && totalPending > 10) alerts.push({ type: "pending", level: "yellow", message: `${totalPending} orders still pending` });

      // === 6. TODAY SNAPSHOT (orders with status *transitions* recorded today) ===
      // Precise "daily operational activity": counts orders that had a real transition
      // (especially to 'paid' or 'returned') on this calendar day, per order_history.
      // This is what powers accurate "we processed these via BigArena file today".
      const todayStart = todayStr + "T00:00:00Z";
      const historyToday = await paginate<any>(() =>
        adminClient.from("order_history")
          .select("order_id, to_status")
          .gte("changed_at", todayStart)
          .in("to_status", ["confirmed", "shipped", "paid", "returned"])
      );
      const todayOrderIds = new Set(historyToday.map((h: any) => h.order_id));
      const todayOrders = financialOrders.filter((o: any) => todayOrderIds.has(o.id));

      // For the 'paid' and 'returns' in snapshot, we can further refine to only those
      // whose *latest* relevant transition today was to that status (avoids any edge double-counting).
      const paidTransitionIdsToday = new Set(
        historyToday.filter((h: any) => h.to_status === 'paid').map((h: any) => h.order_id)
      );
      const returnedTransitionIdsToday = new Set(
        historyToday.filter((h: any) => h.to_status === 'returned').map((h: any) => h.order_id)
      );

      const todaySnapshot = {
        taken: todayOrders.length,
        confirmed: todayOrders.filter((o: any) => ["confirmed", "shipped", "delivered", "returned", "paid"].includes(o.status)).length,
        paid: todayOrders.filter((o: any) => paidTransitionIdsToday.has(o.id) && o.status === "paid").length,
        revenue: todayOrders.filter((o: any) => paidTransitionIdsToday.has(o.id) && o.status === "paid")
          .reduce((s: number, o: any) => s + Number(o.price || 0), 0),
        returns: todayOrders.filter((o: any) => returnedTransitionIdsToday.has(o.id) && o.status === "returned").length,
      };

      return json({
        revenue, profit, outstanding, totalCost, paidCount, paidAmount,
        confirmedCount, shippedCount, returnedCount, returnedAmount,
        funnel: { allTaken, confirmed, paid, shipped, returned, pending, conversionRate, confirmationRate, returnRate },
        dailyRevenue,
        agentRankings,
        topAgent: agentRankings[0] || null,
        alerts,
        todaySnapshot,
        period, from: fromDate, to: toDate,
      });
    }

    // GET /api/orders/stats
    if (req.method === "GET" && path === "orders/stats") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");

      // Paginate past PostgREST's 1000-row default so the counts reflect EVERY
      // matching order, not just the first page (this endpoint backs the Dashboard).
      const orders: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = adminClient
          .from("orders")
          .select("status, created_at, assigned_agent_id, assigned_agent_name")
          .or("source_type.is.null,source_type.neq.monadon_legacy") // exclude Monadon legacy from status counts
          .range(offset, offset + 999);
        if (from) query = query.gte("created_at", from);
        if (to) query = query.lte("created_at", to);
        const { data, error } = await query;
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        if (!data || data.length === 0) break;
        orders.push(...data);
        if (data.length < 1000) break;
      }

      // Status counts — orders only (do NOT mix prediction_leads into order stats)
      const statusCounts: Record<string, number> = {};
      const agentCounts: Record<string, number> = {};
      const dailyCounts: Record<string, number> = {};
      
      for (const o of orders || []) {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        if (o.assigned_agent_name) {
          agentCounts[o.assigned_agent_name] = (agentCounts[o.assigned_agent_name] || 0) + 1;
        }
        const day = o.created_at.substring(0, 10);
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      }

      const total = orders?.length || 0;
      return json({ statusCounts, agentCounts, dailyCounts, total });
    }

    // ============================================================
    // PRODUCTS
    // ============================================================

    // GET /api/products
    if (req.method === "GET" && path === "products") {
      const { data, error } = await supabase
        .from("products")
        .select("*, suppliers:supplier_id(id, name)")
        .order("created_at", { ascending: false });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      // Suggested selling price = max(cost×3, current price, €15). Computed
      // server-side and exposed to everyone (it's the agent-facing default,
      // never €0). The raw cost_price is sensitive → admins only.
      const PRICE_MULTIPLIER = 3;
      const PRICE_FLOOR = 15;
      const result = (data || []).map((p: any) => {
        const cost = Number(p.cost_price || 0);
        const price = Number(p.price || 0); // website retail = the agents' default
        // Default the agent sees = website retail price when set; otherwise the
        // cost×3 / €15 floor so it's never €0. Agents can edit down (discounts).
        const suggested_price = price > 0 ? price : Math.max(cost * PRICE_MULTIPLIER, PRICE_FLOOR);
        const out: any = { ...p, suggested_price };
        if (!isAdmin) delete out.cost_price; // call agents/managers never see cost
        return out;
      });
      return json(result);
    }

    // POST /api/products
    if (req.method === "POST" && path === "products") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(createProductSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      const { data, error } = await adminClient
        .from("products")
        .insert({
          name: body.name,
          description: body.description,
          price: body.price,
          cost_price: isAdmin ? body.cost_price : 0, // cost is admin-only
          sku: body.sku,
          stock_quantity: body.stock_quantity,
          low_stock_threshold: body.low_stock_threshold,
          photo_url: body.photo_url,
          is_active: body.is_active,
          category: body.category,
          supplier_id: body.supplier_id,
        })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/products/:id
    if (req.method === "PATCH" && segments[0] === "products" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const productId = segments[1];
      const body = await req.json();
      // cost_price is admin-only — managers can edit everything else.
      if (!isAdmin && "cost_price" in body) delete body.cost_price;

      // If stock_quantity is changing, log it
      if (body.stock_quantity !== undefined) {
        const { data: current } = await adminClient
          .from("products")
          .select("stock_quantity")
          .eq("id", productId)
          .single();
        if (current && current.stock_quantity !== body.stock_quantity) {
          await adminClient.from("inventory_logs").insert({
            product_id: productId,
            change_amount: body.stock_quantity - current.stock_quantity,
            previous_stock: current.stock_quantity,
            new_stock: body.stock_quantity,
            reason: "manual",
            movement_type: "manual_adjust",
            user_id: user.id,
          });
        }
      }

      const { data, error } = await adminClient
        .from("products")
        .update(body)
        .eq("id", productId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/products/:id/inventory-logs
    if (req.method === "GET" && segments[0] === "products" && segments[2] === "inventory-logs") {
      const productId = segments[1];
      const { data, error } = await adminClient
        .from("inventory_logs")
        .select("*")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // ============================================================
    // PREDICTION LISTS & LEADS
    // ============================================================

    // GET /api/prediction-lists
    if (req.method === "GET" && path === "prediction-lists") {
      const { data, error } = await supabase
        .from("prediction_lists")
        .select("*")
        .order("uploaded_at", { ascending: false });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // POST /api/prediction-lists (upload)
    if (req.method === "POST" && path === "prediction-lists") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(predictionListSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const { name, entries } = body;

      const { data: list, error: listErr } = await adminClient
        .from("prediction_lists")
        .insert({
          name: name.trim(),
          uploaded_by: user.id,
          total_records: entries.length,
          assigned_count: 0,
        })
        .select()
        .single();
      if (listErr) return json({ error: sanitizeDbError(listErr) }, 400);

      // Insert leads
      const leads = entries.map((e: any) => ({
        list_id: list.id,
        name: e.name || "",
        telephone: e.telephone || "",
        address: e.address || "",
        city: e.city || "",
        product: e.product || "",
      }));

      const { error: leadsErr } = await adminClient.from("prediction_leads").insert(leads);
      if (leadsErr) return json({ error: sanitizeDbError(leadsErr) }, 400);

      return json(list);
    }

    // GET /api/prediction-lists/:id
    if (req.method === "GET" && segments[0] === "prediction-lists" && segments.length === 2) {
      const listId = segments[1];
      const { data: list } = await supabase
        .from("prediction_lists")
        .select("*")
        .eq("id", listId)
        .single();
      if (!list) return json({ error: "List not found" }, 404);

      const { data: leads } = await adminClient
        .from("prediction_leads")
        .select("*")
        .eq("list_id", listId)
        .order("created_at", { ascending: true })
        .limit(5000);

      return json({ ...list, entries: leads || [] });
    }

    // POST /api/prediction-lists/:id/assign (bulk assign)
    if (req.method === "POST" && segments[0] === "prediction-lists" && segments[2] === "assign") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const listId = segments[1];
      const body = await req.json();
      const { agent_id, lead_ids } = body;

      const { data: agentProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", agent_id)
        .single();
      if (!agentProfile) return json({ error: "Agent not found" }, 404);

      const { error } = await adminClient
        .from("prediction_leads")
        .update({
          assigned_agent_id: agent_id,
          assigned_agent_name: agentProfile.full_name,
        })
        .in("id", lead_ids)
        .eq("list_id", listId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Update assigned count
      const { count } = await adminClient
        .from("prediction_leads")
        .select("id", { count: "exact", head: true })
        .eq("list_id", listId)
        .not("assigned_agent_id", "is", null);

      await adminClient
        .from("prediction_lists")
        .update({ assigned_count: count || 0 })
        .eq("id", listId);

      return json({ success: true, assigned_count: count });
    }

    // GET /api/prediction-leads/my (agent's assigned leads)
    if (req.method === "GET" && path === "prediction-leads/my") {
      const search = url.searchParams.get("search");

      // Agents are always restricted to their own assigned leads — no global
      // search bypass via adminClient.
      let query: any;
      if (isAdminOrManager) {
        query = adminClient
          .from("prediction_leads")
          .select("*, prediction_lists(name), prediction_lead_items(*)")
          .not("assigned_agent_id", "is", null);
      } else {
        query = supabase
          .from("prediction_leads")
          .select("*, prediction_lists(name), prediction_lead_items(*)")
          .eq("assigned_agent_id", user.id);
      }

      if (search) {
        const s = sanitizeSearch(search);
        if (s) query = query.or(`name.ilike.%${s}%,telephone.ilike.%${s}%`);
      }

      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(3000);
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Add is_owned flag
      const enriched = (data || []).map((l: any) => ({
        ...l,
        is_owned: isAdminOrManager || l.assigned_agent_id === user.id,
      }));
      return json(enriched);
    }

    // ============================================================
    // PREDICTION LEAD ITEMS CRUD
    // ============================================================

    // POST /api/prediction-leads/:id/items (add product to lead)
    if (req.method === "POST" && segments[0] === "prediction-leads" && segments[2] === "items") {
      const leadId = segments[1];
      const body = await req.json();
      const productId = body.product_id || null;
      const productName = body.product_name || "";
      const quantity = Math.max(1, parseInt(body.quantity) || 1);
      const pricePerUnit = Math.max(0, parseFloat(body.price_per_unit) || 0);
      const totalPrice = Math.round(quantity * pricePerUnit * 100) / 100;

      const { data: item, error: itemErr } = await adminClient
        .from("prediction_lead_items")
        .insert({ lead_id: leadId, product_id: productId, product_name: productName, quantity, price_per_unit: pricePerUnit, total_price: totalPrice })
        .select()
        .single();
      if (itemErr) return json({ error: sanitizeDbError(itemErr) }, 400);

      // Recalculate lead total from all items
      const { data: allItems } = await adminClient.from("prediction_lead_items").select("total_price").eq("lead_id", leadId);
      const leadTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0);
      const totalQty = (allItems || []).length;
      await adminClient.from("prediction_leads").update({ price: leadTotal, quantity: totalQty }).eq("id", leadId);

      return json(item);
    }

    // PATCH /api/prediction-lead-items/:id (update lead item)
    if (req.method === "PATCH" && segments[0] === "prediction-lead-items" && segments.length === 2) {
      const itemId = segments[1];
      const body = await req.json();

      const { data: currentItem } = await adminClient.from("prediction_lead_items").select("*").eq("id", itemId).single();
      if (!currentItem) return json({ error: "Item not found" }, 404);

      const updates: Record<string, any> = {};
      if (body.product_id !== undefined) updates.product_id = body.product_id;
      if (body.product_name !== undefined) updates.product_name = body.product_name;
      if (body.quantity !== undefined) updates.quantity = body.quantity;
      if (body.price_per_unit !== undefined) updates.price_per_unit = body.price_per_unit;

      const qty = body.quantity ?? currentItem.quantity;
      const ppu = body.price_per_unit ?? currentItem.price_per_unit;
      updates.total_price = Math.round(qty * ppu * 100) / 100;

      const { data: updatedItem, error: updateErr } = await adminClient
        .from("prediction_lead_items")
        .update(updates)
        .eq("id", itemId)
        .select()
        .single();
      if (updateErr) return json({ error: sanitizeDbError(updateErr) }, 400);

      // Recalculate lead total
      const leadId = currentItem.lead_id;
      const { data: allItems } = await adminClient.from("prediction_lead_items").select("total_price").eq("lead_id", leadId);
      const leadTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0);
      await adminClient.from("prediction_leads").update({ price: leadTotal }).eq("id", leadId);

      return json(updatedItem);
    }

    // DELETE /api/prediction-lead-items/:id (remove product from lead)
    if (req.method === "DELETE" && segments[0] === "prediction-lead-items" && segments.length === 2) {
      const itemId = segments[1];

      const { data: currentItem } = await adminClient.from("prediction_lead_items").select("*").eq("id", itemId).single();
      if (!currentItem) return json({ error: "Item not found" }, 404);

      const leadId = currentItem.lead_id;
      await adminClient.from("prediction_lead_items").delete().eq("id", itemId);

      // Recalculate lead total
      const { data: allItems } = await adminClient.from("prediction_lead_items").select("total_price").eq("lead_id", leadId);
      const leadTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0);
      const totalQty = (allItems || []).length;
      await adminClient.from("prediction_leads").update({ price: leadTotal, quantity: totalQty > 0 ? totalQty : 1 }).eq("id", leadId);

      return json({ success: true });
    }

    // POST /api/prediction-leads/unassign (admin: bulk unassign leads)
    if (req.method === "POST" && path === "prediction-leads/unassign") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const body = await req.json();
      const { lead_ids } = body;
      if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
        return json({ error: "lead_ids array is required" }, 400);
      }

      // Get leads to find their list_ids for updating assigned_count
      const { data: leadsToUnassign } = await adminClient
        .from("prediction_leads")
        .select("id, list_id, assigned_agent_name")
        .in("id", lead_ids);

      const { error } = await adminClient
        .from("prediction_leads")
        .update({ assigned_agent_id: null, assigned_agent_name: null })
        .in("id", lead_ids);
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Update assigned_count for affected lists
      const affectedListIds = [...new Set((leadsToUnassign || []).map((l: any) => l.list_id))];
      for (const listId of affectedListIds) {
        const { count } = await adminClient
          .from("prediction_leads")
          .select("id", { count: "exact", head: true })
          .eq("list_id", listId)
          .not("assigned_agent_id", "is", null);
        await adminClient
          .from("prediction_lists")
          .update({ assigned_count: count || 0 })
          .eq("id", listId);
      }

      return json({ success: true, unassigned: lead_ids.length });
    }

    // POST /api/prediction-leads/:id/take (agent takes ownership)
    if (req.method === "POST" && segments[0] === "prediction-leads" && segments[2] === "take" && segments.length === 3) {
      const leadId = segments[1];

      // Get agent profile
      const { data: agentProfile } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();

      // Verify lead exists and can be taken
      const { data: lead } = await adminClient
        .from("prediction_leads")
        .select("id, assigned_agent_id, status")
        .eq("id", leadId)
        .single();
      if (!lead) return json({ error: "Lead not found" }, 404);

      // If already assigned to someone else and not admin, block
      if (lead.assigned_agent_id && lead.assigned_agent_id !== user.id && !isAdminOrManager) {
        return json({ error: "Lead is already assigned to another agent" }, 403);
      }

      const { data, error } = await adminClient
        .from("prediction_leads")
        .update({
          assigned_agent_id: user.id,
          assigned_agent_name: agentProfile?.full_name || user.email,
          status: "interested", // Mark as taken/interested
        })
        .eq("id", leadId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      return json(data);
    }

    // PATCH /api/prediction-leads/:id (update status/notes/details)
    if (req.method === "PATCH" && segments[0] === "prediction-leads" && segments.length === 2) {
      const leadId = segments[1];
      const body = await req.json();

      const updates: Record<string, any> = {};
      if (body.status) updates.status = body.status;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.address !== undefined) updates.address = body.address;
      if (body.city !== undefined) updates.city = body.city;
      if (body.telephone !== undefined) updates.telephone = body.telephone;
      if (body.product !== undefined) updates.product = body.product;
      if (body.quantity !== undefined) updates.quantity = body.quantity;
      if (body.price !== undefined) updates.price = body.price;
      if (body.name !== undefined) updates.name = body.name;

      // Ownership: lock lead to current agent on ownership-claiming statuses
      const ownershipStatuses = ["interested", "confirmed", "no_answer"];
      if (body.status && ownershipStatuses.includes(body.status) && !isAdminOrManager) {
        const { data: agentProfile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
        updates.assigned_agent_id = user.id;
        updates.assigned_agent_name = agentProfile?.full_name || user.email;
      }

      const { data, error } = await supabase
        .from("prediction_leads")
        .update(updates)
        .eq("id", leadId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Auto-create order when prediction lead reaches call_again or confirmed
      if (body.status && ["call_again", "confirmed"].includes(body.status)) {
        // Check if an order already exists for this lead (prevent duplicates)
        const { data: existingOrder } = await adminClient
          .from("orders")
          .select("id, status")
          .eq("source_lead_id", leadId)
          .maybeSingle();

        if (!existingOrder) {
          // Get the lead data for order creation
          const lead = data;

          // Validate: do not create empty order
          if (!lead.name && !lead.telephone) {
            // Skip order creation if no meaningful data
          } else {
            const { data: agentProfile } = lead.assigned_agent_id
              ? await adminClient.from("profiles").select("full_name").eq("user_id", lead.assigned_agent_id).single()
              : { data: null };

            // Fetch prediction_lead_items for multi-product transfer
            const { data: leadItems } = await adminClient
              .from("prediction_lead_items")
              .select("*")
              .eq("lead_id", leadId);

            // Determine product summary from items or lead fields
            const hasItems = leadItems && leadItems.length > 0;
            const productSummary = hasItems
              ? leadItems.map((i: any) => i.product_name).join(", ")
              : (lead.product || "From Prediction Lead");
            const totalPrice = hasItems
              ? leadItems.reduce((s: number, i: any) => s + Number(i.total_price || 0), 0)
              : Number(lead.price || 0);
            const totalQty = hasItems
              ? leadItems.reduce((s: number, i: any) => s + Number(i.quantity || 1), 0)
              : Number(lead.quantity || 1);

            const { data: newOrder } = await adminClient
              .from("orders")
              .insert({
                product_name: productSummary,
                customer_name: lead.name || "",
                customer_phone: lead.telephone || "",
                customer_city: lead.city || "",
                customer_address: lead.address || "",
                postal_code: "",
                price: totalPrice,
                quantity: totalQty,
                status: body.status === "confirmed" ? "confirmed" : "call_again",
                source_type: "prediction_lead",
                source_lead_id: leadId,
                assigned_agent_id: lead.assigned_agent_id,
                assigned_agent_name: agentProfile?.full_name || lead.assigned_agent_name || null,
                assigned_at: lead.assigned_agent_id ? new Date().toISOString() : null,
              })
              .select()
              .single();

            if (newOrder) {
              // Transfer multi-product items to order_items
              if (hasItems) {
                const orderItems = leadItems.map((i: any) => ({
                  order_id: newOrder.id,
                  product_id: i.product_id,
                  product_name: i.product_name,
                  quantity: i.quantity,
                  price_per_unit: Number(i.price_per_unit),
                  total_price: Number(i.total_price),
                }));
                await adminClient.from("order_items").insert(orderItems);
              } else if (lead.product) {
                // Single product fallback
                await adminClient.from("order_items").insert({
                  order_id: newOrder.id,
                  product_id: null,
                  product_name: lead.product,
                  quantity: lead.quantity || 1,
                  price_per_unit: Number(lead.price || 0),
                  total_price: totalPrice,
                });
              }

              // Transfer notes
              if (lead.notes && lead.notes.trim()) {
                const changerName = agentProfile?.full_name || "System";
                await adminClient.from("order_notes").insert({
                  order_id: newOrder.id,
                  text: lead.notes.trim(),
                  author_id: user.id,
                  author_name: changerName,
                });
              }

              // Log conversion in order history
              const { data: converterProfile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
              await adminClient.from("order_history").insert({
                order_id: newOrder.id,
                to_status: newOrder.status,
                changed_by: user.id,
                changed_by_name: converterProfile?.full_name || "System",
              });
              // Add conversion note
              await adminClient.from("order_notes").insert({
                order_id: newOrder.id,
                text: "Converted from Prediction Lead",
                author_id: user.id,
                author_name: "System",
              });
            }
          }
        } else {
          // Update existing order status to match lead
          const newStatus = body.status === "confirmed" ? "confirmed" : "call_again";
          if (existingOrder.status !== newStatus) {
            await adminClient.from("orders").update({ status: newStatus }).eq("id", existingOrder.id);
            const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
            await adminClient.from("order_history").insert({
              order_id: existingOrder.id,
              from_status: existingOrder.status,
              to_status: newStatus,
              changed_by: user.id,
              changed_by_name: profile?.full_name || "System",
            });
          }
        }
      }

      return json(data);
    }

    // POST /api/check-phone-duplicates
    if (req.method === "POST" && path === "check-phone-duplicates") {
      const body = await req.json();
      const { phone, exclude_order_id } = body;
      if (!phone) return json({ error: "Phone is required" }, 400);

      const { data, error } = await adminClient.rpc("check_phone_duplicates", {
        _phone: phone,
        _exclude_order_id: exclude_order_id || null,
      });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/agent-performance (admin only) — full business metrics
    if (req.method === "GET" && path === "agent-performance") {
      // Allow regular agents (including pending/prediction) to see their *own* performance + payout.
      // Admins/managers can see everyone.
      const isPersonalView = !isAdminOrManager;

      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const search = url.searchParams.get("search")?.toLowerCase();
      const sourceFilter = url.searchParams.get("source");
      const statusFilter = url.searchParams.get("status");
      const includeCancelled = url.searchParams.get("include_cancelled") === "true";
      let agentIdFilter = url.searchParams.get("agent_id");
      const showZero = url.searchParams.get("show_zero") === "true";

      // Force personal scope for non-admins
      if (isPersonalView) {
        agentIdFilter = user.id;
        // Clear search/filter that could leak other agents
        // (search and agentFilter from query are ignored for personal view)
      }

      // Fetch orders first (we need them to know which users actually have sales activity).
      // "trashed" is fetched so we can show a per-agent junk/wrong-number count; it is
      // separated out below so it never inflates leads, packages, payout or any rate.
      // Cancelled + trashed are ALWAYS fetched so their per-agent counts are real:
      // the Cancelled/Trashed cards must never read 0 just because the toggle is off.
      // Whether cancelled counts as a *lead* / rate denominator is decided per-agent
      // below via includeCancelled — exactly how trashed is always kept out of leads.
      const statusesToFetch = ["take", "call_again", "confirmed", "shipped", "delivered", "returned", "paid", "trashed", "cancelled"];
      let ordersQuery = adminClient.from("orders").select("id, status, assigned_agent_id, confirmed_by_agent_id, price, quantity, product_id, created_at, source_type, prediction_list_id, order_items(price_per_unit, quantity, total_price, product_id)").in("status", statusesToFetch)
        .or("source_type.is.null,source_type.neq.monadon_legacy"); // exclude Monadon legacy (another company's revenue / no agent payout)
      if (from) ordersQuery = ordersQuery.gte("created_at", from);
      if (to) ordersQuery = ordersQuery.lte("created_at", to);
      if (sourceFilter) ordersQuery = ordersQuery.eq("source_type", sourceFilter);
      if (statusFilter) ordersQuery = ordersQuery.eq("status", statusFilter);
      const { data: allOrders } = await ordersQuery;

      // Build per-agent metrics + collect everyone who has any attribution
      // (assigned_agent_id OR confirmed_by_agent_id). This is the key for showing
      // SuperAdmins who make manual sales.
      const agentOrderMap: Record<string, any[]> = {};
      const allAttributedUserIds = new Set<string>();

      // ONE owner per order = the first agent who confirmed it (the assignee is
      // only a legacy fallback). Crediting BOTH assignee and confirmer used to
      // double-count an order's sale + bonus, and let a super-admin who edits &
      // re-confirms an agent's order share the credit. See salesOwnerId() and
      // the elyon-agent-commissions skill.
      for (const o of allOrders || []) {
        const ownerId = salesOwnerId(o);
        if (!ownerId) continue;
        allAttributedUserIds.add(ownerId);
        (agentOrderMap[ownerId] ??= []).push(o);
      }

      // Get all active profiles
      const { data: agents } = await adminClient
        .from("profiles")
        .select("user_id, full_name, email")
        .eq("is_active", true);

      // Traditional call agents (for the base list)
      const { data: agentRoles } = await adminClient
        .from("user_roles")
        .select("user_id")
        .in("role", ["agent", "pending_agent", "prediction_agent"]);
      const traditionalAgentUserIds = new Set((agentRoles || []).map((r: any) => r.user_id));

      // Super-admins (admin/manager) earn NO bonus — even if they also hold an
      // agent role (e.g. a founder who occasionally confirms an order).
      const { data: superAdminRoles } = await adminClient
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "manager"]);
      const superAdminUserIds = new Set((superAdminRoles || []).map((r: any) => r.user_id));

      // Start with traditional agents
      let agentProfiles = (agents || []).filter((a: any) => traditionalAgentUserIds.has(a.user_id));

      // Add any extra users who have sales attributed to them (SuperAdmins etc.)
      const existingIds = new Set(agentProfiles.map((p: any) => p.user_id));
      const missingIds = Array.from(allAttributedUserIds).filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        const { data: extraProfiles } = await adminClient
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", missingIds)
          .eq("is_active", true);
        if (extraProfiles?.length) {
          agentProfiles = [...agentProfiles, ...extraProfiles];
        }
      }

      // Apply search / single agent filter on the final list
      if (search && !isPersonalView) {
        agentProfiles = agentProfiles.filter((a: any) => a.full_name.toLowerCase().includes(search) || a.email.toLowerCase().includes(search));
      }
      if (agentIdFilter) {
        agentProfiles = agentProfiles.filter((a: any) => a.user_id === agentIdFilter);
      }

      // For non-admin users, force the list to contain only themselves
      if (isPersonalView) {
        agentProfiles = agentProfiles.filter((a: any) => a.user_id === user.id);
      }

      // Get cost prices for profit calculation
      const { data: allProducts } = await adminClient.from("products").select("id, cost_price");
      const costMap: Record<string, number> = {};
      for (const p of allProducts || []) costMap[p.id] = Number(p.cost_price || 0);

      // Load special agents for commission calc (pending + prediction)
      const { data: specialRoleRows } = await adminClient
        .from("user_roles")
        .select("user_id")
        .in("role", ["pending_agent", "prediction_agent"]);
      const specialAgentIds = new Set((specialRoleRows || []).map((r: any) => r.user_id));

      // unitsOf helper (local to this handler)
      const unitsOf = (o: any) => {
        const its = o.order_items || [];
        return its.length
          ? its.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0)
          : Number(o.quantity || 0) || 1;
      };

      // Per-package commission lives in the shared module-level calcAgentBonus()
      // (see top of file + elyon-agent-commissions skill). Earns on EVERY paid
      // order, per package, credited to the confirming agent — no source/role gate.

      // Determine which agents to include: those with activity OR all if showZero
      const activeAgentIds = new Set(Object.keys(agentOrderMap));
      let filteredProfiles = showZero
        ? agentProfiles
        : agentProfiles.filter((a: any) => activeAgentIds.has(a.user_id));

      // For personal view, always include the current user even if they have no activity yet
      if (isPersonalView && agentProfiles.length > 0) {
        const self = agentProfiles[0];
        if (!filteredProfiles.some((p: any) => p.user_id === self.user_id)) {
          filteredProfiles = [self, ...filteredProfiles];
        }
      }

      const results = filteredProfiles.map((agent: any) => {
        const allAgentRows = agentOrderMap[agent.user_id] || [];
        // Trash (junk / wrong number) is tracked on its own so it never counts as
        // a lead, package, payout or feeds any rate denominator below.
        const trashedOrders = allAgentRows.filter((o: any) => o.status === "trashed");
        // Count cancelled from the FULL row set so it's always real, independent of
        // whether cancelled is folded into the lead/rate base below.
        const cancelledOrders = allAgentRows.filter((o: any) => o.status === "cancelled");
        // The "lead" base for counts + rates. Trash is never a lead. Cancelled is
        // excluded by default and only folded in when the user flips the Cancelled
        // toggle — keeping conversion clean while the Cancelled card stays accurate.
        const agentOrders = allAgentRows.filter((o: any) =>
          o.status !== "trashed" && (includeCancelled || o.status !== "cancelled")
        );

        const leadsAssigned = agentOrders.length;
        const confirmedOrders = agentOrders.filter((o: any) => ["confirmed", "shipped", "delivered", "returned", "paid"].includes(o.status));
        const shippedOrders = agentOrders.filter((o: any) => ["shipped", "delivered", "returned", "paid"].includes(o.status));
        const paidOrders = agentOrders.filter((o: any) => o.status === "paid");
        const returnedOrders = agentOrders.filter((o: any) => o.status === "returned");

        // Financial: use locked order price
        const grossRevenue = agentOrders
          .filter((o: any) => ["shipped", "paid"].includes(o.status))
          .reduce((s: number, o: any) => s + Number(o.price || 0), 0);

        const paidRevenue = paidOrders.reduce((s: number, o: any) => s + Number(o.price || 0), 0);

        const outstandingRevenue = agentOrders
          .filter((o: any) => o.status === "shipped")
          .reduce((s: number, o: any) => s + Number(o.price || 0), 0);

        const returnedValue = returnedOrders.reduce((s: number, o: any) => s + Number(o.price || 0), 0);

        // Profit from paid orders: price - cost snapshot
        let totalProfit = 0;
        for (const o of paidOrders) {
          const items = o.order_items || [];
          let orderCost = 0;
          if (items.length > 0) {
            for (const it of items) {
              orderCost += (costMap[it.product_id] || 0) * (it.quantity || 1);
            }
          } else if (o.product_id) {
            orderCost = (costMap[o.product_id] || 0) * (o.quantity || 1);
          }
          totalProfit += Number(o.price || 0) - orderCost;
        }

        // Net Contribution: (Paid Revenue - Returned Value) - Total Cost for Paid + Returned orders
        let returnedCost = 0;
        for (const o of returnedOrders) {
          const items = o.order_items || [];
          let orderCost = 0;
          if (items.length > 0) {
            for (const it of items) {
              orderCost += (costMap[it.product_id] || 0) * (it.quantity || 1);
            }
          } else if (o.product_id) {
            orderCost = (costMap[o.product_id] || 0) * (o.quantity || 1);
          }
          returnedCost += orderCost;
        }
        // totalCost for paid orders is already: paidRevenue - totalProfit
        const paidCost = paidRevenue - totalProfit;
        const netContribution = (paidRevenue - returnedValue) - (paidCost + returnedCost);

        const paidCount = paidOrders.length;
        const confirmedCount = confirmedOrders.length;
        const shippedCount = shippedOrders.length;
        const avgOrderValue = paidCount > 0 ? Math.round((paidRevenue / paidCount) * 100) / 100 : 0;
        const revenuePerLead = leadsAssigned > 0 ? Math.round((paidRevenue / leadsAssigned) * 100) / 100 : 0;
        const profitPerLead = leadsAssigned > 0 ? Math.round((totalProfit / leadsAssigned) * 100) / 100 : 0;

        // Quality rates
        const conversionRate = leadsAssigned > 0 ? Math.round((confirmedCount / leadsAssigned) * 10000) / 100 : 0;
        const shipmentRate = confirmedCount > 0 ? Math.round((shippedCount / confirmedCount) * 10000) / 100 : 0;
        const collectionRate = shippedCount > 0 ? Math.round((paidCount / shippedCount) * 10000) / 100 : 0;
        const returnRate = shippedCount > 0 ? Math.round((returnedOrders.length / shippedCount) * 10000) / 100 : 0;

        // === Per-package payout (every paid order, credited to confirmer) ===
        // Super-admins (admin/manager, not agents) are never on commission.
        const isSpecial = specialAgentIds.has(agent.user_id);
        const isAgentRole = traditionalAgentUserIds.has(agent.user_id) && !superAdminUserIds.has(agent.user_id);
        const payoutEarned = isAgentRole ? calcAgentBonus(agentOrders) : 0;

        // Average revenue per package over SOLD orders (confirmed/shipped/delivered/paid),
        // mirroring the Insights aggregate's "Avg/Pkg" (sold revenue ÷ sold packages).
        const soldOrders = agentOrders.filter((o: any) => ["confirmed", "shipped", "delivered", "paid"].includes(o.status));
        const soldRevenue = soldOrders.reduce((s: number, o: any) => s + Number(o.price || 0), 0);
        const soldUnits = soldOrders.reduce((s: number, o: any) => s + unitsOf(o), 0);
        const avgPerPackage = soldUnits > 0 ? Math.round((soldRevenue / soldUnits) * 100) / 100 : 0;

        return {
          user_id: agent.user_id,
          full_name: agent.full_name,
          email: agent.email,
          leads_assigned: leadsAssigned,
          total_confirmed: confirmedCount,
          total_shipped: shippedCount,
          total_paid: paidCount,
          total_returned: returnedOrders.length,
          total_cancelled: cancelledOrders.length,
          total_trashed: trashedOrders.length,
          conversion_rate: conversionRate,
          shipment_rate: shipmentRate,
          collection_rate: collectionRate,
          return_rate: returnRate,
          gross_revenue: grossRevenue,
          paid_revenue: paidRevenue,
          outstanding_revenue: outstandingRevenue,
          returned_value: returnedValue,
          total_profit: totalProfit,
          net_contribution: netContribution,
          avg_order_value: avgOrderValue,
          revenue_per_lead: revenuePerLead,
          profit_per_lead: profitPerLead,
          // New payout fields (only meaningful for pending/prediction agents)
          is_special_agent: isSpecial,
          packages_sold: agentOrders.reduce((s: number, o: any) => s + unitsOf(o), 0),
          avg_per_package: avgPerPackage,
          payout_earned: payoutEarned,
        };
      });

      results.sort((a: any, b: any) => b.paid_revenue - a.paid_revenue);

      return json(results);
    }

    // ============================================================
    // CALL SCRIPTS & LOGS
    // ============================================================

    // GET /api/call-scripts (list all scripts)
    if (req.method === "GET" && path === "call-scripts") {
      const { data, error } = await supabase
        .from("call_scripts")
        .select("*")
        .order("title");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // POST /api/call-scripts (admin only - create new product script)
    if (req.method === "POST" && path === "call-scripts") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const body = await req.json();
      if (!body.title?.trim()) return json({ error: "title is required" }, 400);
      const { data, error } = await adminClient
        .from("call_scripts")
        .insert({
          context_type: "product",
          title: body.title.trim(),
          description: body.description?.trim() || null,
          script_text: body.script_text || "",
          helpers: Array.isArray(body.helpers) ? body.helpers : [],
          translations: body.translations && typeof body.translations === "object" ? body.translations : {},
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/call-scripts/:contextType
    if (req.method === "GET" && segments[0] === "call-scripts" && segments.length === 2) {
      const contextType = segments[1];
      const { data, error } = await supabase
        .from("call_scripts")
        .select("*")
        .eq("context_type", contextType)
        .maybeSingle();
      if (error || !data) return json({ script_text: "", title: "", description: null });
      return json(data);
    }

    // PATCH /api/call-scripts/:id  (admin only)
    // If the segment looks like a UUID → update product script by id
    // Otherwise → upsert legacy script by context_type (prediction_lead / order)
    if (req.method === "PATCH" && segments[0] === "call-scripts" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const identifier = segments[1];
      const body = await req.json();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

      let data, error;
      if (isUuid) {
        // Product script update by id
        ({ data, error } = await adminClient
          .from("call_scripts")
          .update({
            title: body.title?.trim(),
            description: body.description?.trim() ?? null,
            script_text: body.script_text,
            // Only persist helpers/translations when explicitly provided (keeps old clients + legacy paths safe)
            ...(Array.isArray(body.helpers) ? { helpers: body.helpers } : {}),
            ...(body.translations && typeof body.translations === "object" ? { translations: body.translations } : {}),
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", identifier)
          .select()
          .single());
      } else {
        // Legacy prediction_lead / order — select then update or insert
        const { data: existing } = await adminClient
          .from("call_scripts")
          .select("id")
          .eq("context_type", identifier)
          .maybeSingle();
        const defaultTitle = identifier === "prediction_lead" ? "Prediction Lead Script" : "Order Script";
        const transPatch = body.translations && typeof body.translations === "object" ? { translations: body.translations } : {};
        if (existing) {
          ({ data, error } = await adminClient
            .from("call_scripts")
            .update({ script_text: body.script_text, ...transPatch, updated_by: user.id, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .select()
            .single());
        } else {
          ({ data, error } = await adminClient
            .from("call_scripts")
            .insert({ context_type: identifier, title: defaultTitle, script_text: body.script_text, ...transPatch, updated_by: user.id })
            .select()
            .single());
        }
      }
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // DELETE /api/call-scripts/:id (admin only - delete product script)
    if (req.method === "DELETE" && segments[0] === "call-scripts" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { error } = await adminClient
        .from("call_scripts")
        .delete()
        .eq("id", segments[1]);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ ok: true });
    }

    // POST /api/call-logs
    if (req.method === "POST" && path === "call-logs") {
      let body;
      try { body = parseBody(callLogSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const {
        context_type, context_id, outcome, notes,
        started_at, connected_at, ended_at,
        customer_phone, connection_state,
        cancellation_reason, cancellation_reason_notes, trash_reason,
      } = body;

      // Apply the order status change best-effort. We USED to abort here (return
      // an error before writing the log) when the transition was rejected — which
      // meant the call, and its recording, went completely unlogged (orphan
      // recordings with no agent / customer / outcome). Now we ALWAYS write the
      // call log and just record any rejection as a warning, so every call has an
      // audit trail + a recording link. OrderModal still surfaces hard transition
      // errors via its separate apiUpdateOrderStatus call; the in-call widget
      // shows order_warning from the response.
      let order_warning: string | null = null;
      if (context_type === "order" && context_id) {
        const result = await applyOutcomeToOrder(adminClient, {
          orderId: context_id,
          outcome,
          agentId: user.id,
          cancellationReason: cancellation_reason,
          cancellationReasonNotes: cancellation_reason_notes,
          trashReason: trash_reason,
        });
        if (!result.ok) order_warning = result.error || "Order status was not changed.";
      }

      const loggedNotes = order_warning
        ? [notes || "", `⚠ Order not updated: ${order_warning}`].filter(Boolean).join("\n")
        : (notes || "");

      // ── Dedupe the call row with its result ───────────────────────────────
      // The live call is logged by VoipContext with telemetry (started_at +
      // recording match). The agent then often confirms/cancels/trashes the
      // order a couple minutes LATER in OrderModal, which logs a separate
      // "marker" row with NO telemetry. Left alone that yields TWO rows: a
      // neutral "Answered" call (with recording) + a bare result (no recording).
      // We merge them by phone within a 5-minute window measured from the call's
      // hangup (ended_at) so ONE row carries both the recording/duration AND the
      // final result — regardless of whether the order is resolved during or
      // right after the call. Order side-effects already ran via
      // applyOutcomeToOrder above, so this is display-only de-duplication.
      const MERGE_MS = 5 * 60 * 1000;
      const isRealResult = outcome === "confirmed" || outcome === "cancelled" || outcome === "trash";
      const isMarker = !started_at && isRealResult;                                  // OrderModal, after a call
      const isAnsweredTelemetry = !!started_at && (outcome === "answered" || outcome === "interested"); // VoipContext finalize
      const mergePhone8 = customer_phone ? String(customer_phone).replace(/\D/g, "").slice(-8) : "";
      let data: any = null;
      if (mergePhone8.length >= 7 && (isMarker || isAnsweredTelemetry)) {
        const sinceIso = new Date(Date.now() - MERGE_MS).toISOString();
        if (isMarker) {
          // Re-tag the just-ended answered call for this phone with the result.
          const { data: cands } = await adminClient
            .from("call_logs")
            .select("id, notes")
            .eq("agent_id", user.id)
            .ilike("customer_phone", `%${mergePhone8}%`)
            .not("started_at", "is", null)
            .in("outcome", ["answered", "interested"])
            .gte("ended_at", sinceIso)
            .order("ended_at", { ascending: false })
            .limit(1);
          const hit = (cands || [])[0];
          if (hit) {
            const { data: upd } = await adminClient
              .from("call_logs")
              .update({ outcome, notes: [hit.notes, loggedNotes].filter(Boolean).join("\n") || null })
              .eq("id", hit.id).select().single();
            data = upd;
          }
        } else {
          // The marker may have arrived first (confirm-DURING-call): fold this
          // call's telemetry INTO that marker row instead of adding a 2nd row.
          const { data: cands } = await adminClient
            .from("call_logs")
            .select("id, notes")
            .eq("agent_id", user.id)
            .ilike("customer_phone", `%${mergePhone8}%`)
            .is("started_at", null)
            .in("outcome", ["confirmed", "cancelled", "trash"])
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: false })
            .limit(1);
          const hit = (cands || [])[0];
          if (hit) {
            const { data: upd } = await adminClient
              .from("call_logs")
              .update({
                started_at: started_at ?? null,
                connected_at: connected_at ?? null,
                ended_at: ended_at ?? null,
                connection_state: connection_state ?? null,
                notes: [hit.notes, loggedNotes].filter(Boolean).join("\n") || null,
              })
              .eq("id", hit.id).select().single();
            data = upd;
          }
        }
      }

      if (!data) {
        const { data: inserted, error } = await adminClient
          .from("call_logs")
          .insert({
            agent_id: user.id,
            context_type,
            context_id: context_id ?? null,
            outcome,
            notes: loggedNotes,
            started_at: started_at ?? null,
            connected_at: connected_at ?? null,
            ended_at: ended_at ?? null,
            customer_phone: customer_phone ?? null,
            connection_state: connection_state ?? null,
          })
          .select()
          .single();
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        data = inserted;
      }

      // The agent just called this number — clear any open missed call for it so it
      // drops out of the Call Again queue / Missed Calls inbox (last-8 match).
      if (customer_phone) {
        const cbNorm = String(customer_phone).replace(/\D/g, "").slice(-8);
        if (cbNorm.length >= 7) {
          await adminClient.from("missed_calls")
            .update({ status: "called_back" })
            .eq("linked_phone_norm", cbNorm)
            .in("status", ["new", "assigned"]);
        }
      }

      // ── No-answer → 1-day hold + 5-consecutive auto-trash ──────────────
      // Every real no-answer call lands here, so this is the single source of
      // truth for the "doesn't pick up" lifecycle (both the call strip and the
      // manual "Didn't Answer" button log a no_answer call). We count the
      // trailing consecutive no-answers for this phone:
      //   < 5  → park the customer for ~1 day (prediction member hold + parked
      //          pending order) so they sit in Call Again, then resurface.
      //   ≥ 5  → unreachable → move to Trash (reason "not reachable"). Trash,
      //          NOT cancel, so cancel insights stay clean. One trashed order:
      //          reuse a workable order if one exists, else create a single one.
      // No stub orders are created for the no-answer/call-again cycle itself.
      const isNoAnswer = outcome === "no_answer" || connection_state === "no_answer";
      if (isNoAnswer && customer_phone) {
        const digits = customer_phone.replace(/\D/g, "");
        const last8 = digits.length >= 8 ? digits.slice(-8) : digits;
        if (last8) {
          const { data: recentLogs } = await adminClient
            .from("call_logs")
            .select("outcome, connection_state, created_at")
            .ilike("customer_phone", `%${last8}%`)
            .order("created_at", { ascending: false })
            .limit(12);
          let streak = 0;
          for (const lg of recentLogs || []) {
            if (lg.outcome === "no_answer" || lg.connection_state === "no_answer") streak++;
            else break;
          }

          if (streak >= 5) {
            const NOTE = "Auto-trash: not reachable — 5 consecutive no-answers (doesn't pick up the phone)";
            const { data: workable } = await adminClient
              .from("orders")
              .select("id, notes")
              .ilike("customer_phone", `%${last8}%`)
              .in("status", ["pending", "take", "call_again"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (workable) {
              await adminClient
                .from("orders")
                .update({
                  status: "trashed",
                  trash_reason: "not_reachable",
                  assigned_agent_id: null,
                  assigned_at: null,
                  next_call_after: null,
                  call_again_since: null,
                  notes: [workable.notes, NOTE].filter(Boolean).join("\n"),
                })
                .eq("id", workable.id);
            } else {
              await adminClient.from("orders").insert({
                product_name: "Not reachable",
                customer_phone,
                status: "trashed",
                trash_reason: "not_reachable",
                price: 0,
                quantity: 1,
                notes: NOTE,
              });
            }
            // Drop them from every calling queue.
            await adminClient
              .from("prediction_segment_members")
              .update({ is_completed: true, last_call_outcome: "trash", in_call_again_until: null, call_again_since: null })
              .ilike("customer_phone", `%${last8}%`);
          } else {
            // Short cooldown between auto-dial attempts (~3h): the client is
            // skipped in the calling bucket for a few hours, then resurfaces.
            // The 3-day Call-Again window is tracked separately by
            // call_again_since (anchored to the FIRST no-answer via the
            // is-null second update below — never reset while it keeps ringing).
            const cooldownUntil = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
            const nowIso = new Date().toISOString();
            // Prediction member: short cooldown + mark as awaiting follow-up.
            await adminClient
              .from("prediction_segment_members")
              .update({ in_call_again_until: cooldownUntil, last_call_at: nowIso, last_call_outcome: "no_answer" })
              .ilike("customer_phone", `%${last8}%`)
              .eq("is_completed", false);
            await adminClient
              .from("prediction_segment_members")
              .update({ call_again_since: nowIso })
              .ilike("customer_phone", `%${last8}%`)
              .eq("is_completed", false)
              .is("call_again_since", null);
            // Mark the EXISTING workable order as Call Again (never create a 2nd
            // order) so the operator sees it was already called, + short cooldown.
            await adminClient
              .from("orders")
              .update({ status: "call_again", next_call_after: cooldownUntil })
              .ilike("customer_phone", `%${last8}%`)
              .in("status", ["pending", "take", "call_again"]);
            await adminClient
              .from("orders")
              .update({ call_again_since: nowIso })
              .ilike("customer_phone", `%${last8}%`)
              .eq("status", "call_again")
              .is("call_again_since", null);
          }
        }
      }

      // Auto-update prediction lead status based on outcome
      if (context_type === "prediction_lead") {
        const statusMap: Record<string, string> = {
          no_answer: "no_answer",
          interested: "interested",
          // 'answered' is the new neutral "they picked up, no decision yet"
          // outcome (replaces the old auto-'interested'). For a LEAD it means
          // the same thing the old code did: mark it interested + lock to the
          // agent, so the queue/ownership behaviour is unchanged.
          answered: "interested",
          not_interested: "not_interested",
          call_again: "not_contacted",
        };
        const newStatus = statusMap[outcome];
        if (newStatus) {
          const updatePayload: Record<string, any> = { status: newStatus };
          // Ownership: lock lead to agent on interested/call_again
          if (outcome === "interested" || outcome === "answered" || outcome === "call_again") {
            const { data: agentProfile } = await adminClient
              .from("profiles")
              .select("full_name")
              .eq("user_id", user.id)
              .single();
            updatePayload.assigned_agent_id = user.id;
            updatePayload.assigned_agent_name = agentProfile?.full_name || user.email;
          }
          await adminClient
            .from("prediction_leads")
            .update(updatePayload)
            .eq("id", context_id);
        }
      }

      return json({ ...data, order_warning });
    }

    // GET /api/call-history (list all call logs with filters, pagination, enriched data)
    // GET /api/agent-activity — per-agent call-activity timeline for ONE day
    // (Europe/Belgrade). Powers the Agent Activity swimlane: each agent's calls
    // (ring + talk segments), their scheduled shift window, and breaks, all
    // positioned on a real clock axis. Managers/admins see every agent; a plain
    // agent sees only their own row. Purely read-only — no side effects.
    if (req.method === "GET" && path === "agent-activity") {
      if (!canViewModule("call_activity")) return json({ error: "Forbidden" }, 403);
      const TZ = "Europe/Belgrade";

      // Minutes to ADD to UTC to get Sofia local time at the given instant
      // (+120 winter / +180 summer). DST handled by the runtime via Intl.
      const tzOffsetMinutes = (at: Date): number => {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: TZ, hour12: false,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }).formatToParts(at);
        const m: Record<string, string> = {};
        for (const p of parts) m[p.type] = p.value;
        let hh = m.hour; if (hh === "24") hh = "00";
        const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +hh, +m.minute, +m.second);
        return Math.round((asUTC - at.getTime()) / 60000);
      };

      // Resolve the target day (YYYY-MM-DD) in Sofia local time; default today.
      const sofiaToday = (() => {
        const p = new Intl.DateTimeFormat("en-CA", {
          timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date());
        const g = (t: string) => p.find((x) => x.type === t)?.value || "";
        return `${g("year")}-${g("month")}-${g("day")}`;
      })();
      const dateParam = url.searchParams.get("date");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || "") ? dateParam! : sofiaToday;
      const [yy, mm, dd] = date.split("-").map(Number);

      // Sofia-local [00:00, 24:00) → UTC ISO bounds for the timestamptz filter.
      // Probe at local noon to read the day's offset clear of DST edges.
      const off = tzOffsetMinutes(new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0)));
      const dayStartMs = Date.UTC(yy, mm - 1, dd, 0, 0, 0) - off * 60000;
      const fromIso = new Date(dayStartMs).toISOString();
      const toIso = new Date(dayStartMs + 24 * 60 * 60 * 1000).toISOString();

      // Non-managers are pinned to their own row; managers may filter to one.
      const agentFilterParam = url.searchParams.get("agent_id");
      const singleAgentId = !isAdminOrManager ? user.id : (agentFilterParam || null);

      // ── Calls for the day (real calls always carry started_at) ──
      const aaPaginate = async (makeQuery: () => any, pageSize = 1000): Promise<any[]> => {
        const out: any[] = [];
        for (let pageStart = 0; ; pageStart += pageSize) {
          const { data, error } = await makeQuery().range(pageStart, pageStart + pageSize - 1);
          if (error) throw error;
          out.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }
        return out;
      };

      let callRows: any[];
      try {
        callRows = await aaPaginate(() => {
          let q = adminClient.from("call_logs")
            .select("id, agent_id, started_at, connected_at, ended_at, connection_state, outcome, customer_phone, ring_seconds, talk_seconds")
            .gte("started_at", fromIso).lt("started_at", toIso)
            .order("started_at", { ascending: true });
          if (singleAgentId) q = q.eq("agent_id", singleAgentId);
          return q;
        });
      } catch (e: any) {
        return json({ error: sanitizeDbError(e) }, 400);
      }

      // ── Shifts scheduled for the day (with their assigned agents) ──
      const { data: dayShifts } = await adminClient
        .from("shifts")
        .select("id, start_time, end_time, shift_assignments(user_id)")
        .eq("date", date);
      const shiftsByAgent: Record<string, { start: string; end: string }[]> = {};
      for (const s of dayShifts || []) {
        for (const a of (s as any).shift_assignments || []) {
          (shiftsByAgent[a.user_id] ??= []).push({
            start: String(s.start_time).slice(0, 5),
            end: String(s.end_time).slice(0, 5),
          });
        }
      }

      // ── Breaks taken that day ──
      const { data: dayBreaks } = await adminClient
        .from("shift_breaks")
        .select("user_id, break_start, break_end")
        .eq("shift_date", date);
      const breaksByAgent: Record<string, { start: string; end: string | null }[]> = {};
      for (const b of dayBreaks || []) {
        (breaksByAgent[b.user_id] ??= []).push({ start: b.break_start, end: b.break_end });
      }

      // ── Group calls + collect the agent set (anyone with a call OR a shift) ──
      const callsByAgent: Record<string, any[]> = {};
      for (const c of callRows) (callsByAgent[c.agent_id] ??= []).push(c);
      const agentIds = new Set<string>([...Object.keys(callsByAgent), ...Object.keys(shiftsByAgent)]);
      if (singleAgentId) { for (const id of [...agentIds]) if (id !== singleAgentId) agentIds.delete(id); }

      // ── Names ──
      const nameById: Record<string, string> = {};
      if (agentIds.size > 0) {
        const { data: profs } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", [...agentIds]);
        for (const p of profs || []) nameById[p.user_id] = p.full_name;
      }

      const num = (x: any) => Number(x || 0);
      const agents = [...agentIds].map((uid) => {
        const calls = callsByAgent[uid] || [];
        let answered = 0, talk = 0, ring = 0;
        let first: string | null = null, last: string | null = null;
        for (const c of calls) {
          const isAns = c.connection_state === "answered" || (c.connection_state == null && num(c.talk_seconds) > 0);
          if (isAns) answered++;
          talk += num(c.talk_seconds);
          ring += num(c.ring_seconds);
          if (c.started_at && (!first || c.started_at < first)) first = c.started_at;
          const end = c.ended_at || c.started_at;
          if (end && (!last || end > last)) last = end;
        }
        return {
          user_id: uid,
          full_name: nameById[uid] || "Unknown",
          shift_windows: shiftsByAgent[uid] || [],
          breaks: breaksByAgent[uid] || [],
          calls,
          totals: {
            calls: calls.length,
            answered,
            answer_rate: calls.length ? answered / calls.length : 0,
            talk_seconds: talk,
            ring_seconds: ring,
            first_call: first,
            last_call: last,
          },
        };
      }).sort((a, b) => a.full_name.localeCompare(b.full_name));

      return json({ date, tz: TZ, agents });
    }

    if (req.method === "GET" && path === "call-history") {
      const agentFilter = url.searchParams.get("agent_id");
      // "result" is the canonical, merged outcome+order-status the UI shows (see
      // the call_logs_with_result view). Accept legacy "outcome" as an alias so an
      // un-refreshed client keeps working.
      const resultFilter = url.searchParams.get("result") || url.searchParams.get("outcome");
      const sourceFilter = url.searchParams.get("source"); // prediction_lead | order
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const search = url.searchParams.get("search");
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = parseInt(url.searchParams.get("limit") || "25");

      // ── Result is CALL-driven and matches what the row DISPLAYS ────────────
      // Every conversation is a row (agent = the caller). A row's "Result" is the
      // call outcome merged with the customer's order/lead status — resolved by
      // context_id, or by phone (last-8) for standalone/Direct calls — exactly
      // what getResult() shows in the UI. So filtering Confirmed/Cancelled/… (or
      // a call outcome) returns precisely the rows whose badge matches. No order
      // with a conversation is left behind, because we resolve every call's phone.
      const last8f = (v: any) => String(v || "").replace(/\D/g, "").slice(-8);
      const RESULT_TOKENS = new Set(["confirmed", "cancelled", "paid", "shipped", "delivered", "returned", "trash", "no_answer", "answered", "call_again"]);
      const RESOLVED = new Set(["confirmed", "cancelled", "trashed", "shipped", "delivered", "paid", "returned"]);
      // Mirror of getResult() in src/pages/CallHistoryPage.tsx (single source of truth).
      const resultTokenOf = (outcome: string | null, eff: string | null): string => {
        if (outcome === "no_answer") return "no_answer";
        if (eff && RESOLVED.has(eff)) return eff === "trashed" ? "trash" : eff;
        switch (outcome) {
          case "confirmed": return "confirmed";
          case "cancelled": case "not_interested": return "cancelled";
          case "trash": case "wrong_number": return "trash";
          case "call_again": return "call_again";
          case "answered": case "interested": return "answered";
          default: return "unknown";
        }
      };

      // Resolve search predicates ONCE (shared by the count scan and the page
      // fetch). Searchable fields live in joined tables, so resolve matching
      // context_ids / agent_ids first, then OR them against call_logs.
      let searchOrs: string[] | null = null;
      let searchImpossible = false;
      if (search && search.trim()) {
        const term = search.trim();
        const safe = term.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
        const digits = term.replace(/\D/g, "");
        const last8 = digits.length >= 8 ? digits.slice(-8) : digits;
        const hasPhone = last8.length >= 5;
        const orderOr: string[] = []; const leadOr: string[] = [];
        if (safe) { orderOr.push(`customer_name.ilike.%${safe}%`); leadOr.push(`name.ilike.%${safe}%`); }
        if (hasPhone) { orderOr.push(`customer_phone.ilike.%${last8}%`); leadOr.push(`telephone.ilike.%${last8}%`); }
        const matchedContextIds = new Set<string>();
        if (orderOr.length || leadOr.length) {
          const [oRes, lRes] = await Promise.all([
            orderOr.length ? adminClient.from("orders").select("id").or(orderOr.join(",")).limit(1000) : Promise.resolve({ data: [] }),
            leadOr.length ? adminClient.from("prediction_leads").select("id").or(leadOr.join(",")).limit(1000) : Promise.resolve({ data: [] }),
          ]);
          for (const o of oRes.data || []) matchedContextIds.add(o.id);
          for (const l of lRes.data || []) matchedContextIds.add(l.id);
        }
        let matchedAgentIds: string[] = [];
        if (safe) { const { data: agProfiles } = await adminClient.from("profiles").select("user_id").ilike("full_name", `%${safe}%`).limit(200); matchedAgentIds = (agProfiles || []).map((p: any) => p.user_id).filter(Boolean); }
        const ors: string[] = [];
        if (hasPhone) ors.push(`customer_phone.ilike.%${last8}%`);
        if (safe) ors.push(`notes.ilike.%${safe}%`);
        if (matchedContextIds.size) ors.push(`context_id.in.(${[...matchedContextIds].slice(0, 500).join(",")})`);
        if (matchedAgentIds.length) ors.push(`agent_id.in.(${matchedAgentIds.join(",")})`);
        if (ors.length) searchOrs = ors; else searchImpossible = true;
      }
      const applyBase = (q: any) => {
        if (!isAdminOrManager) q = q.eq("agent_id", user.id);
        else if (agentFilter) q = q.eq("agent_id", agentFilter);
        if (sourceFilter) q = q.eq("context_type", sourceFilter);
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        if (searchImpossible) q = q.eq("id", "00000000-0000-0000-0000-000000000000");
        else if (searchOrs) q = q.or(searchOrs.join(","));
        return q;
      };

      let logs: any[] = [];
      let count = 0;

      if (resultFilter && RESULT_TOKENS.has(resultFilter)) {
        // Pull ALL candidate calls (PostgREST caps a response at 1000, so page
        // through with .range), resolve each one's displayed result, keep matches.
        const cand: any[] = [];
        for (let off = 0; ; off += 1000) {
          const { data, error } = await applyBase(
            adminClient.from("call_logs").select("id,context_type,context_id,customer_phone,outcome,created_at").order("created_at", { ascending: false }),
          ).range(off, off + 999);
          if (error) return json({ error: sanitizeDbError(error) }, 400);
          if (!data || !data.length) break;
          cand.push(...data);
          if (data.length < 1000 || cand.length >= 20000) break;
        }
        // Order/lead status by context_id.
        const ctxOrderIds = [...new Set(cand.filter((c) => c.context_type === "order" && c.context_id).map((c) => c.context_id))];
        const ctxLeadIds = [...new Set(cand.filter((c) => c.context_type === "prediction_lead" && c.context_id).map((c) => c.context_id))];
        const ctxOrderStatus: Record<string, string> = {}; const ctxLeadStatus: Record<string, string> = {};
        for (let i = 0; i < ctxOrderIds.length; i += 500) { const { data } = await adminClient.from("orders").select("id,status").in("id", ctxOrderIds.slice(i, i + 500)); for (const o of data || []) ctxOrderStatus[o.id] = o.status; }
        for (let i = 0; i < ctxLeadIds.length; i += 500) { const { data } = await adminClient.from("prediction_leads").select("id,status").in("id", ctxLeadIds.slice(i, i + 500)); for (const l of data || []) ctxLeadStatus[l.id] = l.status; }
        // Order/lead status by phone (last-8, most-recent wins) for standalone calls.
        const needPhone = cand.filter((c) => !(c.context_type === "order" && ctxOrderStatus[c.context_id]) && !(c.context_type === "prediction_lead" && ctxLeadStatus[c.context_id]));
        const phones = [...new Set(needPhone.map((c) => last8f(c.customer_phone)).filter(Boolean))];
        const phoneOrderStatus: Record<string, string> = {}; const phoneLeadStatus: Record<string, string> = {};
        for (let i = 0; i < phones.length; i += 100) {
          const grp = phones.slice(i, i + 100);
          const { data: ords } = await adminClient.from("orders").select("customer_phone,status,created_at").or(grp.map((p) => `customer_phone.ilike.%${p}%`).join(",")).order("created_at", { ascending: false }).limit(3000);
          for (const o of ords || []) { const p = last8f(o.customer_phone); if (p && !(p in phoneOrderStatus)) phoneOrderStatus[p] = o.status; }
          const { data: lds } = await adminClient.from("prediction_leads").select("telephone,status,created_at").or(grp.map((p) => `telephone.ilike.%${p}%`).join(",")).order("created_at", { ascending: false }).limit(3000);
          for (const l of lds || []) { const p = last8f(l.telephone); if (p && !(p in phoneLeadStatus)) phoneLeadStatus[p] = l.status; }
        }
        const effOf = (c: any): string | null => {
          if (c.context_type === "order" && ctxOrderStatus[c.context_id]) return ctxOrderStatus[c.context_id];
          if (c.context_type === "prediction_lead" && ctxLeadStatus[c.context_id]) return ctxLeadStatus[c.context_id];
          const p = last8f(c.customer_phone); return phoneOrderStatus[p] || phoneLeadStatus[p] || null;
        };
        const matchIds = cand.filter((c) => resultTokenOf(c.outcome, effOf(c)) === resultFilter).map((c) => c.id);
        count = matchIds.length;
        const pageIds = matchIds.slice((page - 1) * limit, page * limit);
        if (pageIds.length) {
          const { data } = await adminClient.from("call_logs").select("*").in("id", pageIds);
          const byId = new Map((data || []).map((r: any) => [r.id, r] as [string, any]));
          logs = pageIds.map((id) => byId.get(id)).filter(Boolean);
        }
      } else {
        // No result filter → the straight, paginated call log.
        const { data, count: c, error } = await applyBase(
          adminClient.from("call_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }),
        ).range((page - 1) * limit, page * limit - 1);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        logs = data || []; count = c || 0;
      }

      // Enrich with agent names, customer info
      const agentIds = [...new Set((logs || []).map((l: any) => l.agent_id))];
      let agentMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: profiles } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", agentIds);
        for (const p of profiles || []) agentMap[p.user_id] = p.full_name;
      }

      // Batch lookup context info
      const orderContextIds = (logs || []).filter((l: any) => l.context_type === "order").map((l: any) => l.context_id);
      const leadContextIds = (logs || []).filter((l: any) => l.context_type === "prediction_lead").map((l: any) => l.context_id);

      let orderMap: Record<string, any> = {};
      let leadMap: Record<string, any> = {};

      if (orderContextIds.length > 0) {
        const { data: orders } = await adminClient.from("orders").select("id, display_id, customer_name, customer_phone, customer_city, customer_address, product_name, price, status, assigned_agent_name, source_type, created_at, order_items(id, product_name, quantity, price_per_unit, total_price)").in("id", orderContextIds);
        for (const o of orders || []) orderMap[o.id] = o;
      }
      if (leadContextIds.length > 0) {
        const { data: leads } = await adminClient.from("prediction_leads").select("id, name, telephone, product, city, address, status, assigned_agent_name, price, quantity, prediction_lead_items(id, product_name, quantity, price_per_unit, total_price), prediction_lists(name)").in("id", leadContextIds);
        for (const l of leads || []) leadMap[l.id] = l;
      }

      // Fetch order_history for order contexts
      let orderHistoryMap: Record<string, any[]> = {};
      if (orderContextIds.length > 0) {
        const { data: history } = await adminClient
          .from("order_history")
          .select("*")
          .in("order_id", orderContextIds)
          .order("changed_at", { ascending: false });
        for (const h of (history || [])) {
          if (!orderHistoryMap[h.order_id]) orderHistoryMap[h.order_id] = [];
          orderHistoryMap[h.order_id].push(h);
        }
      }

      // Search filter (post-query on enriched data if search provided)
      let enriched = (logs || []).map((l: any) => {
        const isOrder = l.context_type === "order";
        const isLead = l.context_type === "prediction_lead";
        // Standalone (topbar / brand-new-number) calls have no context_id — they
        // must NOT crash the page. context_id.substring(0,8) here used to throw.
        const ctx = isOrder ? orderMap[l.context_id] : isLead ? leadMap[l.context_id] : null;
        const items = isOrder ? (ctx?.order_items || []) : isLead ? (ctx?.prediction_lead_items || []) : [];
        const productDisplay = items.length > 0
          ? items.map((i: any) => `${i.product_name} x${i.quantity}`).join(", ")
          : (isOrder ? ctx?.product_name : isLead ? ctx?.product : "") || "";
        const totalPrice = items.length > 0
          ? items.reduce((s: number, i: any) => s + Number(i.total_price || 0), 0)
          : Number(ctx?.price || 0);
        return {
          ...l,
          agent_name: agentMap[l.agent_id] || "Unknown",
          customer_name: isOrder ? (ctx?.customer_name || "Unknown")
            : isLead ? (ctx?.name || "Unknown")
            : (l.customer_phone || "—"),
          customer_phone: isOrder ? ctx?.customer_phone : isLead ? ctx?.telephone : (l.customer_phone || ""),
          customer_city: isOrder ? ctx?.customer_city : isLead ? ctx?.city : "",
          customer_address: isOrder ? ctx?.customer_address : isLead ? ctx?.address : "",
          product_name: productDisplay,
          product_items: items,
          total_price: totalPrice,
          order_status: isOrder ? ctx?.status : isLead ? (ctx?.status || "") : "",
          order_agent: isOrder ? ctx?.assigned_agent_name : isLead ? (ctx?.assigned_agent_name || "") : "",
          order_source: isOrder ? (ctx?.source_type || "manual") : isLead ? "prediction_lead" : "standalone",
          display_id: isOrder ? ctx?.display_id : isLead ? (l.context_id ? l.context_id.substring(0, 8) : "") : "—",
          source: l.context_type,
          status_history: isOrder ? (orderHistoryMap[l.context_id] || []) : [],
          list_name: isLead ? (ctx?.prediction_lists?.name || "") : "",
        };
      });

      // ---- Resolve customer for STANDALONE calls by phone (last-8) ----
      // Standalone logs (topbar dials, and the very common prediction-list call
      // where the customer has no actionable order yet — pickLinkedContext returns
      // null) carry only a phone. Without this they render the raw number as the
      // "customer" and you can't tell which person/order each call was for. The
      // name already exists in prediction_leads / orders; we just look it up by the
      // last-8-digits rule (see skill: elyon-phone-normalization), exactly like the
      // orphan-recording path below. Display-only: outcome/lifecycle is untouched.
      const standaloneRows = enriched.filter(
        (e: any) => e.source !== "order" && e.source !== "prediction_lead" && e.customer_phone,
      );
      if (standaloneRows.length) {
        const last8 = (v: any) => String(v || "").replace(/\D/g, "").slice(-8);
        const wantPhones = [...new Set(standaloneRows.map((e: any) => last8(e.customer_phone)).filter(Boolean))];
        if (wantPhones.length) {
          const ordOr = wantPhones.map((p) => `customer_phone.ilike.%${p}%`).join(",");
          const leadOr = wantPhones.map((p) => `telephone.ilike.%${p}%`).join(",");
          const [ordRes, leadRes] = await Promise.all([
            adminClient.from("orders")
              .select("display_id, customer_name, customer_phone, customer_city, customer_address, status, assigned_agent_name, created_at")
              .or(ordOr).order("created_at", { ascending: false }).limit(500),
            adminClient.from("prediction_leads")
              .select("name, telephone, city, address, status, assigned_agent_name, created_at")
              .or(leadOr).order("created_at", { ascending: false }).limit(500),
          ]);
          const ordByPhone: Record<string, any> = {};
          for (const o of ordRes.data || []) { const p = last8(o.customer_phone); if (p && !ordByPhone[p]) ordByPhone[p] = o; } // most recent wins
          const leadByPhone: Record<string, any> = {};
          for (const l of leadRes.data || []) { const p = last8(l.telephone); if (p && !leadByPhone[p]) leadByPhone[p] = l; }
          for (const e of standaloneRows) {
            const p = last8(e.customer_phone);
            const o = ordByPhone[p];
            const l = leadByPhone[p];
            if (!o && !l) continue; // genuinely unknown number — keep the phone
            e.customer_name = o?.customer_name || l?.name || e.customer_name;
            e.customer_city = o?.customer_city || l?.city || e.customer_city;
            e.customer_address = o?.customer_address || l?.address || e.customer_address;
            e.order_status = o?.status || l?.status || e.order_status;
            e.order_agent = o?.assigned_agent_name || l?.assigned_agent_name || e.order_agent;
            if (o?.display_id) e.display_id = o.display_id;
          }
        }
      }

      // ---- Merge call recordings (best-effort; never block history on the PBX) ----
      // Recordings live on the VPS, not in the DB. We (a) attach a Play link to
      // any call_log on this page that has a matching recording, and (b) on page 1
      // surface recent recordings that have NO matching call_log at all (orphans —
      // e.g. a call the agent never saved an outcome for) enriched by the agent's
      // extension in the filename + the order matched by phone. This is what makes
      // the "agent / customer / what happened" show up for recordings.
      let recordings: any[] = [];
      try {
        const recExp = Math.floor(Date.now() / 1000) + 120;
        const recSig = await recSign("list", recExp);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        try {
          const rr = await fetch(`${REC_HOST}?mode=list&exp=${recExp}&sig=${recSig}`, { signal: ctrl.signal });
          if (rr.ok) recordings = await rr.json();
        } finally { clearTimeout(t); }
      } catch (_e) { recordings = []; }
      if (!Array.isArray(recordings)) recordings = [];
      recordings = recordings.filter((r: any) => (r.size || 0) > 2000); // drop empty/failed (~44 B)

      const recLast8 = (r: any) => String(r.dialed || "").replace(/\D/g, "").slice(-8);
      const recMsOf = (r: any) => (r.mtime || 0) * 1000 || Date.now();

      // Resolve the agent behind each recording's extension once (tiny table), so
      // the matcher can keep two agents who called the same number apart.
      const extToAgent: Record<string, string> = {};
      if (recordings.length) {
        const recExts = [...new Set(recordings.map((r: any) => r.ext).filter(Boolean))];
        if (recExts.length) {
          const { data: te } = await adminClient.from("telephony_extensions").select("extension,user_id").in("extension", recExts);
          for (const x of te || []) if (x.extension && x.user_id) extToAgent[x.extension] = x.user_id;
        }
      }

      // (a) attach recording_file to THIS page's logs. Rows already linked in the
      // DB (recording_file persisted by the recording webhook / backfill) keep that
      // link untouched; only un-linked rows fall back to the live-list matcher. The
      // deterministic one-to-one matcher (end-anchored / interval-overlap) fixes
      // both the long-call miss and the repeat-number swap.
      if (recordings.length) {
        const needMatch = enriched.filter((e: any) => !e.recording_file && e.customer_phone);
        if (needMatch.length) {
          // Don't let a recording already DB-linked to one row on this page be
          // re-grabbed by another (un-linked) row in the live fallback.
          const linkedFiles = new Set(enriched.filter((e: any) => e.recording_file).map((e: any) => e.recording_file));
          const liveCandidates = (recordings as RecLite[]).filter((r) => !r.file || !linkedFiles.has(r.file));
          const matched = matchRecordingsToCalls(liveCandidates, needMatch as CallLite[], extToAgent);
          for (const e of needMatch) {
            const rec = matched.get(e.id);
            if (rec) { e.recording_file = rec.file; }
          }
        }
        for (const e of enriched) if (e.recording_file) e.has_recording = true;
      }

      // (b) page 1: union recent orphan recordings (no matching log anywhere)
      let orphanRows: any[] = [];
      const ORPHAN_MAX_AGE = 14 * 24 * 3600 * 1000; // only recent, actionable ones
      if (page === 1 && !sourceFilter && !search && recordings.length) {
        const recent = recordings.filter((r) => recMsOf(r) >= Date.now() - ORPHAN_MAX_AGE);
        if (recent.length) {
          const windowStart = new Date(Date.now() - (ORPHAN_MAX_AGE + 24 * 3600 * 1000)).toISOString();
          const { data: winLogs } = await adminClient
            .from("call_logs")
            .select("id, customer_phone, started_at, connected_at, ended_at, created_at")
            .gte("created_at", windowStart)
            .limit(8000);
          // A recording is an orphan only when the deterministic matcher can't
          // assign it to ANY call in the window (e.g. the agent never saved an
          // outcome). Linked recordings match their call here and drop out.
          const matchedWin = matchRecordingsToCalls(recent as RecLite[], (winLogs || []) as CallLite[], extToAgent);
          const claimedFiles = new Set<string>();
          for (const rec of matchedWin.values()) if (rec.file) claimedFiles.add(rec.file);
          const orphanRecs = recent
            .filter((rec: any) => !claimedFiles.has(rec.file))
            .slice(0, 100);

          // agent from filename extension -> telephony_extensions -> profiles
          const exts = [...new Set(orphanRecs.map((r) => r.ext).filter(Boolean))];
          const extAgent: Record<string, { user_id: string; full_name: string }> = {};
          if (exts.length) {
            const { data: te } = await adminClient.from("telephony_extensions").select("extension,user_id").in("extension", exts);
            const uids = [...new Set((te || []).map((x: any) => x.user_id).filter(Boolean))];
            const pm: Record<string, string> = {};
            if (uids.length) { const { data: pr } = await adminClient.from("profiles").select("user_id,full_name").in("user_id", uids); for (const p of pr || []) pm[p.user_id] = p.full_name; }
            for (const x of te || []) if (x.extension) extAgent[x.extension] = { user_id: x.user_id, full_name: pm[x.user_id] || "" };
          }
          // customer + status from the order matched by phone (last 8)
          const phones = [...new Set(orphanRecs.map(recLast8).filter(Boolean))].slice(0, 50);
          const orderByPhone: Record<string, any> = {};
          if (phones.length) {
            const orq = phones.map((p) => `customer_phone.ilike.%${p}%`).join(",");
            const { data: ords } = await adminClient
              .from("orders")
              .select("id, display_id, customer_name, customer_phone, customer_city, status, created_at")
              .or(orq)
              .order("created_at", { ascending: false })
              .limit(500);
            for (const o of ords || []) {
              const p = String(o.customer_phone || "").replace(/\D/g, "").slice(-8);
              if (p && !orderByPhone[p]) orderByPhone[p] = o; // most recent wins
            }
          }
          orphanRows = orphanRecs.map((rec) => {
            const last8 = recLast8(rec);
            const ord = orderByPhone[last8];
            const ag = rec.ext ? extAgent[rec.ext] : null;
            return {
              id: `rec:${rec.file}`,
              agent_id: ag?.user_id || null,
              agent_name: ag?.full_name || "—",
              customer_name: ord?.customer_name || rec.dialed || "—",
              customer_phone: ord?.customer_phone || rec.dialed || "",
              customer_city: ord?.customer_city || "",
              customer_address: "",
              outcome: null,
              notes: "",
              product_name: "",
              product_items: [],
              total_price: 0,
              order_status: ord?.status || "",
              order_agent: "",
              order_source: "recording",
              display_id: ord?.display_id || "—",
              source: "recording",
              result: "untracked",
              status_history: [],
              list_name: "",
              created_at: new Date(recMsOf(rec)).toISOString(),
              started_at: null, connected_at: null, ended_at: null,
              recording_file: rec.file,
              has_recording: true,
            };
          });
          // honour active filters + non-admin scoping on the synthetic rows
          if (!isAdminOrManager) orphanRows = orphanRows.filter((r) => r.agent_id && r.agent_id === user.id);
          if (agentFilter && isAdminOrManager) orphanRows = orphanRows.filter((r) => r.agent_id === agentFilter);
          if (resultFilter) orphanRows = []; // recordings carry no resolved result
          if (from) orphanRows = orphanRows.filter((r) => r.created_at >= from);
          if (to) orphanRows = orphanRows.filter((r) => r.created_at <= to);
        }
      }

      // combine + sort by time desc; orphan total only counts on page 1.
      // NOTE: search is now applied server-side BEFORE pagination (see above),
      // so there is no post-pagination filter here — the old approach only
      // filtered the current page's 25 rows and hid matches on other pages.
      let combined = [...orphanRows, ...enriched].sort((a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // total counts real call_logs only (drives pagination); orphan recordings
      // are surfaced on top of page 1 without displacing any log row, so they
      // don't create an empty trailing page.
      return json({ logs: redactCustomerList(combined, piiFlags), total: count || 0, page, limit });
    }

    // GET /api/call-logs/:contextType/:contextId
    if (req.method === "GET" && segments[0] === "call-logs" && segments.length === 3) {
      const contextType = segments[1];
      const contextId = segments[2];
      const { data, error } = await adminClient
        .from("call_logs")
        .select("*")
        .eq("context_type", contextType)
        .eq("context_id", contextId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // ============================================================
    // CUSTOMER HISTORY (full dossier for the Calls page)
    // ============================================================

    // POST /api/customers/update-contact — fix a customer's name / phone across
    // EVERY one of their orders at once (identified by the CURRENT phone, last-8).
    // Re-keys the prediction calling-queue sources too so the corrected number
    // flows into future calls. New phone is stored E.164 (+359…). Used by the
    // inline edit on the Calls customer card; the client then re-points Dial at the
    // new number. See the elyon-phone-normalization skill.
    if (req.method === "POST" && segments[0] === "customers" && segments[1] === "update-contact" && segments.length === 2) {
      if (!canMutateOrders) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(updateCustomerContactSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      const oldLast8 = body.phone.replace(/\D/g, "").slice(-8);
      if (oldLast8.length < 8) return json({ error: "Current phone must have at least 8 digits" }, 400);

      // Normalise a new phone to Bulgarian E.164. Guards against the scientific-
      // notation pollution that wrecked earlier imports (see the skill).
      let newPhone: string | undefined;
      if (body.customer_phone !== undefined && body.customer_phone.trim() !== "") {
        if (/e[+-]?\d/i.test(body.customer_phone.replace(/\s/g, ""))) {
          return json({ error: "Phone looks corrupted (scientific notation). Re-enter the digits." }, 400);
        }
        const d = body.customer_phone.replace(/\D/g, "");
        if (d.length < 8) return json({ error: "New phone must have at least 8 digits" }, 400);
        newPhone = d.length >= 11 && d.startsWith("383") ? "+" + d
          : d.length === 10 && d.startsWith("0") ? "+383" + d.slice(1)
          : (d.length === 9 || d.length === 8) ? "+383" + d
          : "+" + d;
      }

      const nameProvided = body.customer_name !== undefined;
      if (!nameProvided && !newPhone) return json({ error: "Provide a new name or phone" }, 400);

      const orderUpdates: Record<string, any> = {};
      if (nameProvided) orderUpdates.customer_name = body.customer_name;
      if (newPhone) orderUpdates.customer_phone = newPhone;

      // Every order for this customer (admin client → all of them, whoever owns
      // each one — the whole history must stay linked to the corrected contact).
      const { data: affected, error: updErr } = await adminClient
        .from("orders").update(orderUpdates).ilike("customer_phone", `%${oldLast8}`).select("id");
      if (updErr) return json({ error: sanitizeDbError(updErr) }, 400);

      // Keep the calling-queue sources in sync so the corrected contact surfaces in
      // future prediction / uploaded-list calls. Best-effort — a failure here must
      // not undo the order fix.
      const memberUpdates: Record<string, any> = {};
      if (nameProvided) memberUpdates.customer_name = body.customer_name;
      if (newPhone) memberUpdates.customer_phone = newPhone;
      try { await adminClient.from("prediction_segment_members").update(memberUpdates).ilike("customer_phone", `%${oldLast8}`); } catch (_e) { /* best effort */ }
      const leadUpdates: Record<string, any> = {};
      if (nameProvided) leadUpdates.name = body.customer_name;
      if (newPhone) leadUpdates.telephone = newPhone;
      try { await adminClient.from("prediction_leads").update(leadUpdates).ilike("telephone", `%${oldLast8}`); } catch (_e) { /* best effort */ }

      return json({ ok: true, orders_updated: (affected || []).length, new_phone: newPhone || body.phone });
    }

    // GET /api/customers/:phone/history
    // Returns every order (regardless of status) + every call attempt by
    // every agent for the given customer phone, last-8-digits normalised.
    // Powers the Orders + Calls tabs in ClientProfileCard.
    if (req.method === "GET" && segments[0] === "customers" && segments[2] === "history" && segments.length === 3) {
      const phoneRaw = decodeURIComponent(segments[1]);
      const digitsOnly = phoneRaw.replace(/\D/g, "");
      const last8 = digitsOnly.length >= 8 ? digitsOnly.slice(-8) : "";
      if (!last8) return json({ orders: [], calls: [] });
      // The customer dossier (past orders + call attempts) is order-history data —
      // hidden from roles that can't see order history (investor managers).
      if (!showOrderHistory) return json({ orders: [], calls: [] });

      const [ordersRes, callsRes] = await Promise.all([
        adminClient
          .from("orders")
          .select(`
            id, display_id, customer_name, customer_phone, customer_city,
            customer_address, street, street_number, apartment, floor, block, entry, postal_code,
            product_name, quantity, price, status, source_type, created_at,
            ship_after_date, cancellation_reason, cancellation_reason_notes,
            cancelled_at, return_reason, return_reason_notes, returned_at,
            assigned_agent_name, delivery_type, courier_office_code,
            order_items(id, product_name, quantity, price_per_unit, total_price)
          `)
          .ilike("customer_phone", `%${last8}%`)
          .order("created_at", { ascending: false })
          .limit(200),
        adminClient
          .from("call_logs")
          .select(`
            id, agent_id, context_type, context_id, outcome, notes,
            created_at, started_at, connected_at, ended_at,
            ring_seconds, talk_seconds, total_seconds,
            customer_phone, connection_state
          `)
          .or(`customer_phone.ilike.%${last8}%`)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (ordersRes.error) return json({ error: sanitizeDbError(ordersRes.error) }, 400);
      if (callsRes.error) return json({ error: sanitizeDbError(callsRes.error) }, 400);

      // Some old call_logs rows (pre-telemetry) have no customer_phone but
      // do have a context_id pointing at an order with the right phone.
      // Pull those in too so the Calls tab is complete for legacy data.
      const orderIds = (ordersRes.data || []).map((o: any) => o.id);
      let legacyCalls: any[] = [];
      if (orderIds.length > 0) {
        const { data: legacy } = await adminClient
          .from("call_logs")
          .select(`
            id, agent_id, context_type, context_id, outcome, notes,
            created_at, started_at, connected_at, ended_at,
            ring_seconds, talk_seconds, total_seconds,
            customer_phone, connection_state
          `)
          .eq("context_type", "order")
          .in("context_id", orderIds)
          .is("customer_phone", null)
          .order("created_at", { ascending: false })
          .limit(200);
        legacyCalls = legacy || [];
      }
      const callsRaw = [...(callsRes.data || []), ...legacyCalls];
      // Dedupe by id
      const seen = new Set<string>();
      const calls = callsRaw.filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Enrich calls with agent name
      const agentIds = [...new Set(calls.map(c => c.agent_id).filter(Boolean))];
      let agentMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: profiles } = await adminClient
          .from("profiles").select("user_id, full_name").in("user_id", agentIds);
        for (const p of profiles || []) agentMap[p.user_id] = p.full_name;
      }
      const callsEnriched = calls.map(c => ({ ...c, agent_name: agentMap[c.agent_id] || "Unknown" }));

      return json({ orders: ordersRes.data || [], calls: callsEnriched });
    }

    // ============================================================
    // ACTIVE CALL VIEWS (TAKE status, heartbeat-based 2-min auto-release)
    // ============================================================

    // POST /api/active-call-views/heartbeat — body: { customer_phone }
    // Upserts the agent's view of this customer.
    // IMPORTANT: Enforces that an agent can only have ONE active view at a time.
    // On heartbeat for a new phone we first release all other views for that agent
    // (reverting any 'take' orders). This guarantees the Operations "Live Agent
    // Activity" widget and badges only ever show one current customer per agent.
    // On first call for a phone it also flips matching workable orders to 'take'.
    // Subsequent calls just bump last_heartbeat_at + expires_at.
    if (req.method === "POST" && path === "active-call-views/heartbeat") {
      let body: { customer_phone?: string };
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const phone = (body.customer_phone || "").trim();
      if (!phone) return json({ error: "customer_phone is required" }, 400);

      // Lazy cleanup of any expired views (cheap, idempotent).
      await adminClient.rpc("cleanup_expired_active_call_views");

      // === NEW: Enforce "one active customer per agent at a time" ===
      // When an agent heartbeats on a new phone, immediately release any other
      // views they currently have (for different phones). This prevents the
      // situation where one agent appears on many customers in the Operations
      // widget and makes the "currently on" data truthful.
      const { data: otherViews } = await adminClient
        .from("active_call_views")
        .select("id, customer_phone, taken_order_ids, taken_from_status")
        .eq("agent_id", user.id)
        .neq("customer_phone", phone);

      for (const view of otherViews || []) {
        const ids = view.taken_order_ids || [];
        const froms = view.taken_from_status || [];
        for (let i = 0; i < ids.length; i++) {
          await adminClient
            .from("orders")
            .update({ status: froms[i], assigned_agent_id: null, assigned_at: null })
            .eq("id", ids[i])
            .eq("status", "take")
            .eq("assigned_agent_id", user.id);
        }
        await adminClient.from("active_call_views").delete().eq("id", view.id);
      }
      // ============================================================

      // Is this the first heartbeat for this (agent, phone) pair?
      const { data: existing } = await adminClient
        .from("active_call_views")
        .select("id, taken_order_ids")
        .eq("agent_id", user.id)
        .eq("customer_phone", phone)
        .maybeSingle();

      const newExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

      if (existing) {
        // Just extend the heartbeat.
        const { data, error } = await adminClient
          .from("active_call_views")
          .update({ last_heartbeat_at: new Date().toISOString(), expires_at: newExpiresAt })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        return json(data);
      }

      // First heartbeat — flip the customer's WORKABLE orders to 'take'.
      // Only 'pending' and 'call_again' are workable (an agent is actively going
      // to call them). We deliberately do NOT flip 'cancelled'/'trashed': those
      // are resolved/parked (cancelled customers now live in "Current Cancels"),
      // and flipping a cancelled order to 'take' risks resurrecting it to
      // 'call_again' on an orphan revert. Protected (never flipped): confirmed,
      // shipped, paid, delivered, returned.
      const digitsOnly = phone.replace(/\D/g, "");
      const last8 = digitsOnly.length >= 8 ? digitsOnly.slice(-8) : "";
      let takenIds: string[] = [];
      let takenFrom: string[] = [];
      if (last8) {
        const { data: candidates } = await adminClient
          .from("orders")
          .select("id, status, assigned_agent_id")
          .ilike("customer_phone", `%${last8}%`)
          .in("status", ["pending", "call_again"]);
        for (const o of candidates || []) {
          // Skip if another agent already has this order assigned.
          if (o.assigned_agent_id && o.assigned_agent_id !== user.id) continue;
          const { error: upErr } = await adminClient
            .from("orders")
            .update({ status: "take", assigned_agent_id: user.id, assigned_at: new Date().toISOString() })
            .eq("id", o.id)
            .eq("status", o.status); // optimistic concurrency — only flip if still in expected status
          if (!upErr) {
            takenIds.push(o.id);
            takenFrom.push(o.status);
          }
        }
      }

      const { data: profile } = await adminClient
        .from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();

      const { data, error } = await adminClient
        .from("active_call_views")
        .insert({
          agent_id: user.id,
          agent_name: profile?.full_name || user.email,
          customer_phone: phone,
          expires_at: newExpiresAt,
          taken_order_ids: takenIds,
          taken_from_status: takenFrom,
        })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // DELETE /api/active-call-views/by-phone/:phone — explicit release
    // (called by the browser when the agent moves to another customer or
    // closes the page). Reverts taken orders to their original status.
    if (req.method === "DELETE" && segments[0] === "active-call-views" && segments[1] === "by-phone" && segments.length === 3) {
      const phone = decodeURIComponent(segments[2]);
      const { data: existing } = await adminClient
        .from("active_call_views")
        .select("id, taken_order_ids, taken_from_status, agent_id")
        .eq("agent_id", user.id)
        .eq("customer_phone", phone)
        .maybeSingle();
      if (!existing) return json({ ok: true, reverted: 0 });
      let reverted = 0;
      const ids = existing.taken_order_ids || [];
      const froms = existing.taken_from_status || [];
      for (let i = 0; i < ids.length; i++) {
        const { error, count } = await adminClient
          .from("orders")
          .update({ status: froms[i], assigned_agent_id: null, assigned_at: null }, { count: "exact" })
          .eq("id", ids[i])
          .eq("status", "take")
          .eq("assigned_agent_id", user.id);
        if (!error && (count ?? 0) > 0) reverted++;
      }
      await adminClient.from("active_call_views").delete().eq("id", existing.id);
      return json({ ok: true, reverted });
    }

    // GET /api/active-call-views/lookup?phone=... — who's currently viewing?
    // Returns { agent_id, agent_name, opened_at, expires_at } or null.
    if (req.method === "GET" && path === "active-call-views/lookup") {
      const phoneRaw = (url.searchParams.get("phone") || "").trim();
      if (!phoneRaw) return json(null);
      // Sweep first so we don't return stale data.
      await adminClient.rpc("cleanup_expired_active_call_views");
      const { data, error } = await adminClient
        .from("active_call_views")
        .select("id, agent_id, agent_name, customer_phone, opened_at, expires_at")
        .eq("customer_phone", phoneRaw)
        .order("opened_at", { ascending: false })
        .maybeSingle();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/active-call-views — admin/manager only
    // Returns all currently active call views (live "who is on which customer").
    // Used for the Operations dashboard widget.
    if (req.method === "GET" && path === "active-call-views") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      await adminClient.rpc("cleanup_expired_active_call_views");

      const { data, error } = await adminClient
        .from("active_call_views")
        .select("id, agent_id, agent_name, customer_phone, opened_at, expires_at, taken_order_ids")
        .order("opened_at", { ascending: false });

      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // ============================================================
    // CALL-AGAIN QUEUE (customers awaiting follow-up call)
    // ============================================================

    // GET /api/call-again-queue?mine=true|false
    // Customers awaiting a follow-up call within their 3-day Call-Again window.
    // Two sources, merged and de-duped by phone (the order row wins):
    //   A) prediction_segment_members in an open window (call_again_since set)
    //   B) orders currently in 'call_again' status (the order the agent called)
    // Sorted by in_call_again_until ASC so soonest-due appears first. Expiry is
    // lazy: anything past its 3-day window is reverted here before we read.
    if (req.method === "GET" && path === "call-again-queue") {
      const mine = url.searchParams.get("mine") !== "false";
      const restrictToMe = mine || !isAdminOrManager;
      await adminClient.rpc("expire_call_again_window");

      // ── Source A: prediction members in an open window ──
      let qa = adminClient
        .from("prediction_segment_members")
        .select(`
          list_id, customer_phone, customer_name, last_call_at, last_call_outcome,
          in_call_again_until, assigned_agent_id, assigned_agent_name, lifetime_value,
          paid_count, avg_package_price, trigger_event_at,
          prediction_segment_lists(name, category)
        `)
        .not("call_again_since", "is", null)
        .eq("is_completed", false)
        .order("in_call_again_until", { ascending: true, nullsFirst: false })
        .limit(500);
      if (restrictToMe) qa = qa.eq("assigned_agent_id", user.id);

      // ── Source B: orders currently marked Call Again ──
      let qb = adminClient
        .from("orders")
        .select(`
          id, customer_phone, customer_name, next_call_after, call_again_since,
          assigned_agent_id, assigned_agent_name, product_name, updated_at, created_at
        `)
        .eq("status", "call_again")
        .order("next_call_after", { ascending: true, nullsFirst: false })
        .limit(500);
      if (restrictToMe) qb = qb.eq("assigned_agent_id", user.id);

      const [membersRes, ordersRes] = await Promise.all([qa, qb]);
      if (membersRes.error) return json({ error: sanitizeDbError(membersRes.error) }, 400);
      if (ordersRes.error) return json({ error: sanitizeDbError(ordersRes.error) }, 400);

      const last8 = (p: string | null) => {
        const d = (p || "").replace(/\D/g, "");
        return d.length >= 8 ? d.slice(-8) : d;
      };
      const byPhone = new Map<string, any>();
      // Orders win on dedupe — insert them first.
      for (const o of ordersRes.data || []) {
        const key = last8(o.customer_phone);
        if (!key || byPhone.has(key)) continue;
        byPhone.set(key, {
          source_kind: "order",
          list_id: `order:${o.id}`,
          customer_phone: o.customer_phone,
          customer_name: o.customer_name,
          last_call_at: o.updated_at,
          last_call_outcome: "no_answer",
          in_call_again_until: o.next_call_after,
          assigned_agent_id: o.assigned_agent_id,
          assigned_agent_name: o.assigned_agent_name,
          lifetime_value: 0,
          paid_count: null,
          avg_package_price: null,
          trigger_event_at: o.created_at,
          prediction_segment_lists: { name: o.product_name, category: "order" },
        });
      }
      for (const m of membersRes.data || []) {
        const key = last8(m.customer_phone);
        if (!key || byPhone.has(key)) continue;
        byPhone.set(key, { source_kind: "prediction", ...m });
      }

      const merged = [...byPhone.values()].sort((a, b) => {
        const ta = a.in_call_again_until ? new Date(a.in_call_again_until).getTime() : Infinity;
        const tb = b.in_call_again_until ? new Date(b.in_call_again_until).getTime() : Infinity;
        return ta - tb;
      });
      return json(merged);
    }

    // ============================================================
    // APP SETTINGS (operator-tunable global knobs)
    // ============================================================

    // GET /api/app-settings — every authenticated user reads (e.g. the agent's
    // Personal List "/N" badge needs the cap). Returns a flat key→value map.
    if (req.method === "GET" && path === "app-settings") {
      const { data, error } = await adminClient.from("app_settings").select("key, value");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      const out: Record<string, any> = {};
      for (const row of data || []) out[row.key] = row.value;
      // Ensure known defaults are always present even before first write.
      if (out.personal_list_max_holds === undefined) out.personal_list_max_holds = PERSONAL_LIST_CAP_DEFAULT;
      return json(out);
    }

    // PATCH /api/app-settings — admin-only. Body: { personal_list_max_holds: 50 }
    if (req.method === "PATCH" && path === "app-settings") {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      if (body.personal_list_max_holds !== undefined) {
        const n = Math.floor(Number(body.personal_list_max_holds));
        if (!Number.isFinite(n) || n < 1 || n > 1000) {
          return json({ error: "personal_list_max_holds must be between 1 and 1000" }, 400);
        }
        const { error } = await adminClient
          .from("app_settings")
          .upsert({ key: "personal_list_max_holds", value: n, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) return json({ error: sanitizeDbError(error) }, 400);
      }
      return json({ success: true });
    }

    // ============================================================
    // PERSONAL LIST (agent-self-claim of customers)
    // ============================================================

    // POST /api/personal-list — claim a customer for the current agent.
    if (req.method === "POST" && path === "personal-list") {
      let body;
      try { body = parseBody(personalListCreateSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      // Per-agent ceiling: configurable via app_settings (admin-tunable from
      // Settings → System Rules). Defaults to 50.
      const cap = await getPersonalListCap(adminClient);
      const { count: activeCount } = await adminClient
        .from("personal_list_holds")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", user.id)
        .eq("status", "active");
      if ((activeCount ?? 0) >= cap) {
        return json({ error: `You already have ${cap} customers in your Personal List. Release one before claiming another.` }, 409);
      }

      // Already claimed by anyone?
      const { data: existing } = await adminClient
        .from("personal_list_holds")
        .select("id, agent_name, reason, expires_at")
        .eq("customer_phone", body.customer_phone)
        .eq("status", "active")
        .maybeSingle();
      if (existing) {
        return json({
          error: `Already claimed by ${existing.agent_name} until ${existing.expires_at}`,
          held_by: existing,
        }, 409);
      }

      const { data: profile } = await adminClient
        .from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();

      const { data, error } = await adminClient
        .from("personal_list_holds")
        .insert({
          agent_id: user.id,
          agent_name: profile?.full_name || user.email,
          customer_phone: body.customer_phone,
          customer_name: body.customer_name ?? null,
          reason: body.reason,
          follow_up_by: body.follow_up_by ?? null,
        })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/personal-list?mine=true — agent's own active holds.
    if (req.method === "GET" && path === "personal-list") {
      const mine = url.searchParams.get("mine") === "true";
      let q = adminClient
        .from("personal_list_holds")
        .select("*")
        .eq("status", "active")
        .order("expires_at", { ascending: true });
      if (mine) q = q.eq("agent_id", user.id);
      else if (!isAdminOrManager) q = q.eq("agent_id", user.id);
      const { data, error } = await q;
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // GET /api/personal-list/lookup?phone=... — does anyone hold this phone?
    if (req.method === "GET" && path === "personal-list/lookup") {
      const phoneRaw = (url.searchParams.get("phone") || "").trim();
      const digitsOnly = phoneRaw.replace(/\D/g, "");
      const last8 = digitsOnly.length >= 8 ? digitsOnly.slice(-8) : "";
      if (!last8) return json(null);
      const { data, error } = await adminClient
        .from("personal_list_holds")
        .select("id, agent_id, agent_name, customer_phone, customer_name, reason, claimed_at, expires_at, follow_up_by")
        .eq("status", "active")
        .ilike("customer_phone", `%${last8}%`)
        .maybeSingle();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/personal-list/expiring — admin/manager review queue.
    // Side effect: marks rows as escalated_at on first read past expiry.
    if (req.method === "GET" && path === "personal-list/expiring") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      // Lazy escalation — flips escalated_at on rows past expires_at.
      await adminClient.rpc("escalate_expired_personal_list_holds");
      const nowIso = new Date().toISOString();
      const { data, error } = await adminClient
        .from("personal_list_holds")
        .select("*")
        .eq("status", "active")
        .lt("expires_at", nowIso)
        .order("expires_at", { ascending: true });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // GET /api/personal-list/expiring-count — header bell badge.
    if (req.method === "GET" && path === "personal-list/expiring-count") {
      const { data, error } = await adminClient.rpc("count_expired_personal_list_holds");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ count: data ?? 0 });
    }

    // POST /api/personal-list/:id/extend — admin/manager only.
    if (req.method === "POST" && segments[0] === "personal-list" && segments[2] === "extend" && segments.length === 3) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const id = segments[1];
      let body;
      try { body = parseBody(personalListExtendSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const { data, error } = await adminClient
        .from("personal_list_holds")
        .update({
          expires_at: new Date(Date.now() + body.days * 86400_000).toISOString(),
          escalated_at: null,  // clear escalation flag — admin acted
          status: "extended",
        })
        .eq("id", id)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      // Flip back to 'active' immediately — 'extended' is a transient marker
      // for audit; queue/badges look at status='active'.
      await adminClient.from("personal_list_holds").update({ status: "active" }).eq("id", id);
      return json(data);
    }

    // DELETE /api/personal-list/:id — release. Agent can release own;
    // admin/manager can release any (used by "Return to pool").
    if (req.method === "DELETE" && segments[0] === "personal-list" && segments.length === 2) {
      const id = segments[1];
      const { data: hold, error: fetchErr } = await adminClient
        .from("personal_list_holds")
        .select("agent_id, status")
        .eq("id", id)
        .single();
      if (fetchErr || !hold) return json({ error: "Hold not found" }, 404);
      if (hold.agent_id !== user.id && !isAdminOrManager) {
        return json({ error: "Forbidden" }, 403);
      }
      const newStatus = isAdminOrManager && hold.agent_id !== user.id
        ? "returned_to_pool"
        : "released";
      const { error } = await adminClient
        .from("personal_list_holds")
        .update({
          status: newStatus,
          released_at: new Date().toISOString(),
          released_by: user.id,
        })
        .eq("id", id);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ ok: true });
    }

    // ============================================================
    // SHIFTS
    // ============================================================

    // POST /api/shifts (admin only)
    if (req.method === "POST" && path === "shifts") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(createShiftSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const { name, date, start_time, end_time, agent_ids } = body;

      // Support date range
      const dates: string[] = [];
      if (body.date_end && body.date_end !== date) {
        let cur = new Date(date);
        const end = new Date(body.date_end);
        while (cur <= end) {
          dates.push(cur.toISOString().substring(0, 10));
          cur.setDate(cur.getDate() + 1);
        }
      } else {
        dates.push(date);
      }

      const createdShifts = [];
      for (const d of dates) {
        const { data: shift, error: shiftErr } = await adminClient
          .from("shifts")
          .insert({ name: name.trim(), date: d, start_time, end_time, created_by: user.id })
          .select()
          .single();
        if (shiftErr) return json({ error: sanitizeDbError(shiftErr) }, 400);

        if (agent_ids?.length) {
          const assignments = agent_ids.map((aid: string) => ({ shift_id: shift.id, user_id: aid }));
          await adminClient.from("shift_assignments").insert(assignments);
        }
        createdShifts.push(shift);
      }

      return json(createdShifts.length === 1 ? createdShifts[0] : createdShifts);
    }

    // GET /api/shifts
    if (req.method === "GET" && path === "shifts") {
      const agentFilter = url.searchParams.get("agent_id");
      const dateFrom = url.searchParams.get("from");
      const dateTo = url.searchParams.get("to");

      let query = adminClient.from("shifts").select("*").order("date", { ascending: true }).order("start_time", { ascending: true });
      if (dateFrom) query = query.gte("date", dateFrom);
      if (dateTo) query = query.lte("date", dateTo);

      const { data: shifts, error } = await query;
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Get all assignments
      const shiftIds = (shifts || []).map((s: any) => s.id);
      let assignments: any[] = [];
      if (shiftIds.length > 0) {
        const { data: a } = await adminClient.from("shift_assignments").select("shift_id, user_id").in("shift_id", shiftIds);
        assignments = a || [];
      }

      // Get agent profiles
      const agentUserIds = [...new Set(assignments.map((a: any) => a.user_id))];
      let agentMap: Record<string, string> = {};
      if (agentUserIds.length > 0) {
        const { data: profiles } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", agentUserIds);
        for (const p of profiles || []) agentMap[p.user_id] = p.full_name;
      }

      const enriched = (shifts || []).map((s: any) => {
        const sAssignments = assignments.filter((a: any) => a.shift_id === s.id);
        return {
          ...s,
          agents: sAssignments.map((a: any) => ({ user_id: a.user_id, full_name: agentMap[a.user_id] || "Unknown" })),
        };
      });

      // Filter by agent if requested
      const result = agentFilter
        ? enriched.filter((s: any) => s.agents.some((a: any) => a.user_id === agentFilter))
        : enriched;

      return json(result);
    }

    // GET /api/shifts/my (agent's shifts) — enriched with clock-in time and
    // breaks per shift so the My Shifts page can show when the agent logged in
    // and how long they've spent on break.
    if (req.method === "GET" && path === "shifts/my") {
      const { data: myAssignments } = await adminClient.from("shift_assignments").select("shift_id").eq("user_id", user.id);
      const myShiftIds = (myAssignments || []).map((a: any) => a.shift_id);
      if (myShiftIds.length === 0) return json([]);

      const { data: shifts } = await adminClient.from("shifts").select("*").in("id", myShiftIds).order("date", { ascending: true }).order("start_time", { ascending: true });
      if (!shifts || shifts.length === 0) return json([]);

      // Earliest login per shift = the clock-in time.
      const { data: logins } = await adminClient
        .from("shift_login_logs")
        .select("shift_id, login_time")
        .eq("user_id", user.id)
        .in("shift_id", myShiftIds)
        .order("login_time", { ascending: true });
      const clockInByShift: Record<string, string> = {};
      for (const l of logins || []) {
        if (l.shift_id && !clockInByShift[l.shift_id]) clockInByShift[l.shift_id] = l.login_time;
      }

      // Breaks per shift.
      const { data: breaks } = await adminClient
        .from("shift_breaks")
        .select("id, shift_id, break_start, break_end")
        .eq("user_id", user.id)
        .in("shift_id", myShiftIds)
        .order("break_start", { ascending: true });
      const breaksByShift: Record<string, any[]> = {};
      for (const b of breaks || []) {
        if (!b.shift_id) continue;
        (breaksByShift[b.shift_id] ||= []).push(b);
      }

      const enriched = shifts.map((s: any) => {
        const shiftBreaks = breaksByShift[s.id] || [];
        const totalBreakMs = shiftBreaks.reduce((sum: number, b: any) => {
          const end = b.break_end ? new Date(b.break_end).getTime() : Date.now();
          return sum + Math.max(0, end - new Date(b.break_start).getTime());
        }, 0);
        return {
          ...s,
          clock_in_time: clockInByShift[s.id] || null,
          breaks: shiftBreaks,
          total_break_seconds: Math.round(totalBreakMs / 1000),
        };
      });
      return json(enriched);
    }

    // POST /api/shifts/break/start — begin a break for the current user.
    // Resolves the active shift server-side; idempotent (returns the existing
    // open break if one is already running).
    if (req.method === "POST" && path === "shifts/break/start") {
      const { data: existing } = await adminClient
        .from("shift_breaks")
        .select("*")
        .eq("user_id", user.id)
        .is("break_end", null)
        .order("break_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) return json(existing);

      // Resolve today's shift (Europe/Belgrade local date) to attach the break to.
      const tzParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Belgrade",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const g = (t: string) => tzParts.find((p) => p.type === t)?.value || "";
      const today = `${g("year")}-${g("month")}-${g("day")}`;

      const { data: myAssignments } = await adminClient.from("shift_assignments").select("shift_id").eq("user_id", user.id);
      const myShiftIds = (myAssignments || []).map((a: any) => a.shift_id);
      let shiftId: string | null = null;
      if (myShiftIds.length > 0) {
        const { data: todayShift } = await adminClient
          .from("shifts").select("id").in("id", myShiftIds).eq("date", today).limit(1).maybeSingle();
        shiftId = todayShift?.id || null;
      }

      const { data: created, error } = await adminClient
        .from("shift_breaks")
        .insert({ user_id: user.id, shift_id: shiftId, shift_date: today })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(created);
    }

    // POST /api/shifts/break/end — close the current user's open break.
    if (req.method === "POST" && path === "shifts/break/end") {
      const { data: open } = await adminClient
        .from("shift_breaks")
        .select("id, break_start")
        .eq("user_id", user.id)
        .is("break_end", null)
        .order("break_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!open) return json({ ended: false });
      const { data: updated, error } = await adminClient
        .from("shift_breaks")
        .update({ break_end: new Date().toISOString() })
        .eq("id", open.id)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ ended: true, break: updated });
    }

    // GET /api/shifts/break/active — current open break (or null) so the UI
    // can resume the running timer after a page refresh.
    if (req.method === "GET" && path === "shifts/break/active") {
      const { data: open } = await adminClient
        .from("shift_breaks")
        .select("*")
        .eq("user_id", user.id)
        .is("break_end", null)
        .order("break_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({ active: open || null });
    }

    // PATCH /api/shifts/:id (admin only)
    if (req.method === "PATCH" && segments[0] === "shifts" && segments.length === 2 && segments[1] !== "my") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const shiftId = segments[1];
      const body = await req.json();
      const { agent_ids, ...shiftUpdates } = body;

      if (Object.keys(shiftUpdates).length > 0) {
        const { error } = await adminClient.from("shifts").update(shiftUpdates).eq("id", shiftId);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
      }

      if (agent_ids !== undefined) {
        await adminClient.from("shift_assignments").delete().eq("shift_id", shiftId);
        if (agent_ids.length > 0) {
          const assignments = agent_ids.map((aid: string) => ({ shift_id: shiftId, user_id: aid }));
          await adminClient.from("shift_assignments").insert(assignments);
        }
      }

      return json({ success: true });
    }

    // DELETE /api/shifts/:id (admin only)
    if (req.method === "DELETE" && segments[0] === "shifts" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const shiftId = segments[1];
      const { error } = await adminClient.from("shifts").delete().eq("id", shiftId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // GET /api/shifts/check-login — check if current user has an active shift right now
    if (req.method === "GET" && path === "shifts/check-login") {
      // Get user profile for logging
      const { data: userProfile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
      const userName = userProfile?.full_name || user.email || "Unknown";
      const primaryRole = roles[0] || "agent";

      // Admins and managers bypass shift restrictions
      if (isAdminOrManager) {
        return json({ allowed: true, bypass: true });
      }

      // Shift hours are entered in the operator's local time (Bulgaria /
      // Macedonia — Europe/Belgrade, UTC+2 summer / UTC+1 winter). Edge Functions
      // run in UTC, so comparing against UTC "now" makes every shift look
      // 1–2h off (the 08:46 shift read as "not started" at 08:48 local because
      // the server saw 06:48 UTC). Evaluate today + now in Europe/Belgrade so the
      // comparison matches what the user typed. DST handled by the runtime.
      const TZ = "Europe/Belgrade";
      const tzParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date());
      const tzGet = (t: string) => tzParts.find((p) => p.type === t)?.value || "";
      const today = `${tzGet("year")}-${tzGet("month")}-${tzGet("day")}`;
      let nowTime = `${tzGet("hour")}:${tzGet("minute")}`;
      if (nowTime.startsWith("24:")) nowTime = `00:${nowTime.slice(3)}`; // hour12:false can emit 24:xx at midnight

      // Get today's shift assignments for this user
      const { data: myAssignments } = await adminClient
        .from("shift_assignments")
        .select("shift_id")
        .eq("user_id", user.id);
      
      if (!myAssignments || myAssignments.length === 0) {
        // Record blocked attempt
        await adminClient.from("blocked_login_attempts").insert({
          user_id: user.id, user_name: userName, role: primaryRole,
          reason: "No active shift assignment",
        });
        return json({ allowed: false, message: "Login not allowed. You currently have no active shift." });
      }

      const myShiftIds = myAssignments.map((a: any) => a.shift_id);
      const { data: todayShifts } = await adminClient
        .from("shifts")
        .select("*")
        .in("id", myShiftIds)
        .eq("date", today);

      if (!todayShifts || todayShifts.length === 0) {
        await adminClient.from("blocked_login_attempts").insert({
          user_id: user.id, user_name: userName, role: primaryRole,
          reason: "No shift scheduled for today",
        });
        return json({ allowed: false, message: "Login not allowed. You have no shift scheduled for today." });
      }

      // Check if any shift covers the current time
      for (const shift of todayShifts) {
        const start = shift.start_time.substring(0, 5);
        const end = shift.end_time.substring(0, 5);

        // Special rule: 00:00 → 00:00 means NO active shift
        if (start === "00:00" && end === "00:00") {
          continue;
        }

        // Check if current time is within shift window
        if (nowTime >= start && nowTime <= end) {
          return json({ allowed: true, shift_id: shift.id, shift_date: shift.date, shift_start_time: start, shift_end_time: end, user_name: userName, role: primaryRole });
        }
      }

      // Check if all shifts are 00:00-00:00
      const allZero = todayShifts.every((s: any) => s.start_time.substring(0, 5) === "00:00" && s.end_time.substring(0, 5) === "00:00");
      if (allZero) {
        await adminClient.from("blocked_login_attempts").insert({
          user_id: user.id, user_name: userName, role: primaryRole,
          reason: "Shift set to 00:00-00:00 (no active shift)",
        });
        return json({ allowed: false, message: "Login not allowed. You currently have no active shift." });
      }

      // Has shifts but outside time window
      const shiftTimes = todayShifts
        .filter((s: any) => !(s.start_time.substring(0, 5) === "00:00" && s.end_time.substring(0, 5) === "00:00"))
        .map((s: any) => `${s.start_time.substring(0, 5)} - ${s.end_time.substring(0, 5)}`)
        .join(", ");
      await adminClient.from("blocked_login_attempts").insert({
        user_id: user.id, user_name: userName, role: primaryRole,
        reason: `Outside shift hours (${shiftTimes})`,
      });
      return json({ allowed: false, message: `Login not allowed. Your shift hours are: ${shiftTimes}. Current time is outside this window.` });
    }

    // POST /api/shifts/login-log — record login
    if (req.method === "POST" && path === "shifts/login-log") {
      const body = await req.json();
      const { shift_id, shift_date, shift_start_time, shift_end_time } = body;
      
      const { data, error } = await adminClient.from("shift_login_logs").insert({
        user_id: user.id,
        shift_id,
        shift_date,
        shift_start_time,
        shift_end_time,
        login_time: new Date().toISOString(),
      }).select().single();
      
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/shifts/logout-log — record logout
    if (req.method === "PATCH" && path === "shifts/logout-log") {
      // Update the latest open login log for this user
      const { data: openLog } = await adminClient
        .from("shift_login_logs")
        .select("id")
        .eq("user_id", user.id)
        .is("logout_time", null)
        .order("login_time", { ascending: false })
        .limit(1)
        .single();
      
      if (openLog) {
        await adminClient.from("shift_login_logs")
          .update({ logout_time: new Date().toISOString() })
          .eq("id", openLog.id);
      }
      return json({ success: true });
    }

    // GET /api/shifts/statistics — agent shift statistics for admin/manager
    if (req.method === "GET" && path === "shifts/statistics") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const dateFrom = url.searchParams.get("from");
      const dateTo = url.searchParams.get("to");

      let query = adminClient.from("shifts").select("*").order("date", { ascending: true });
      if (dateFrom) query = query.gte("date", dateFrom);
      if (dateTo) query = query.lte("date", dateTo);

      const { data: shifts } = await query;
      if (!shifts) return json([]);

      const shiftIds = shifts.map((s: any) => s.id);
      let assignments: any[] = [];
      if (shiftIds.length > 0) {
        const { data: a } = await adminClient.from("shift_assignments").select("shift_id, user_id").in("shift_id", shiftIds);
        assignments = a || [];
      }

      // Build per-agent statistics
      const agentStats: Record<string, { total_days: Set<string>; weekend_days: Set<string>; total_hours: number; total_shifts: number; weekday_shifts: number; weekend_shifts: number }> = {};

      for (const assignment of assignments) {
        const shift = shifts.find((s: any) => s.id === assignment.shift_id);
        if (!shift) continue;

        if (!agentStats[assignment.user_id]) {
          agentStats[assignment.user_id] = { total_days: new Set(), weekend_days: new Set(), total_hours: 0, total_shifts: 0, weekday_shifts: 0, weekend_shifts: 0 };
        }

        const stats = agentStats[assignment.user_id];
        stats.total_days.add(shift.date);
        stats.total_shifts++;

        // Calculate hours
        const startParts = shift.start_time.split(":").map(Number);
        const endParts = shift.end_time.split(":").map(Number);
        const startMins = startParts[0] * 60 + (startParts[1] || 0);
        const endMins = endParts[0] * 60 + (endParts[1] || 0);
        const hours = endMins > startMins ? (endMins - startMins) / 60 : 0;
        stats.total_hours += hours;

        // Weekend check (Saturday=6, Sunday=0)
        const dayOfWeek = new Date(shift.date + "T12:00:00").getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          stats.weekend_days.add(shift.date);
          stats.weekend_shifts++;
        } else {
          stats.weekday_shifts++;
        }
      }

      // Get agent names
      const agentUserIds = Object.keys(agentStats);
      let agentMap: Record<string, string> = {};
      if (agentUserIds.length > 0) {
        const { data: profiles } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", agentUserIds);
        for (const p of profiles || []) agentMap[p.user_id] = p.full_name;
      }

      // Get login logs for actual hours
      let loginLogs: any[] = [];
      if (agentUserIds.length > 0) {
        let logQuery = adminClient.from("shift_login_logs").select("*").in("user_id", agentUserIds);
        if (dateFrom) logQuery = logQuery.gte("shift_date", dateFrom);
        if (dateTo) logQuery = logQuery.lte("shift_date", dateTo);
        const { data: logs } = await logQuery;
        loginLogs = logs || [];
      }

      const result = agentUserIds.map(uid => {
        const s = agentStats[uid];
        const agentLogs = loginLogs.filter((l: any) => l.user_id === uid);
        let actualHours = 0;
        for (const log of agentLogs) {
          if (log.login_time && log.logout_time) {
            actualHours += (new Date(log.logout_time).getTime() - new Date(log.login_time).getTime()) / 3600000;
          }
        }

        return {
          user_id: uid,
          full_name: agentMap[uid] || "Unknown",
          total_worked_days: s.total_days.size,
          total_weekend_days: s.weekend_days.size,
          total_hours_scheduled: Math.round(s.total_hours * 100) / 100,
          total_hours_actual: Math.round(actualHours * 100) / 100,
          total_shifts: s.total_shifts,
          average_hours_per_shift: s.total_shifts > 0 ? Math.round((s.total_hours / s.total_shifts) * 100) / 100 : 0,
          weekday_shifts: s.weekday_shifts,
          weekend_shifts: s.weekend_shifts,
        };
      });

      return json(result);
    }

    // GET /api/shifts/login-activity — login activity logs for admin/manager
    if (req.method === "GET" && path === "shifts/login-activity") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const dateFrom = url.searchParams.get("from");
      const dateTo = url.searchParams.get("to");
      const agentFilter = url.searchParams.get("agent_id");
      const statusFilter = url.searchParams.get("status");

      // Fetch login logs
      let logQuery = adminClient.from("shift_login_logs").select("*").order("login_time", { ascending: false });
      if (dateFrom) logQuery = logQuery.gte("shift_date", dateFrom);
      if (dateTo) logQuery = logQuery.lte("shift_date", dateTo);
      if (agentFilter) logQuery = logQuery.eq("user_id", agentFilter);
      const { data: loginLogs } = await logQuery;

      // Fetch blocked attempts
      let blockedQuery = adminClient.from("blocked_login_attempts").select("*").order("attempt_time", { ascending: false });
      if (dateFrom) blockedQuery = blockedQuery.gte("attempt_time", `${dateFrom}T00:00:00`);
      if (dateTo) blockedQuery = blockedQuery.lte("attempt_time", `${dateTo}T23:59:59`);
      if (agentFilter) blockedQuery = blockedQuery.eq("user_id", agentFilter);
      const { data: blockedAttempts } = await blockedQuery;

      // Get user names & roles for login logs
      const userIds = [...new Set((loginLogs || []).map((l: any) => l.user_id))];
      let userMap: Record<string, { full_name: string; role: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", userIds);
        const { data: userRoles } = await adminClient.from("user_roles").select("user_id, role").in("user_id", userIds);
        for (const p of profiles || []) {
          const role = (userRoles || []).find((r: any) => r.user_id === p.user_id)?.role || "agent";
          userMap[p.user_id] = { full_name: p.full_name, role };
        }
      }

      // Build activity entries from login logs
      const activities: any[] = [];
      for (const log of loginLogs || []) {
        const userInfo = userMap[log.user_id] || { full_name: "Unknown", role: "agent" };
        const shiftStart = log.shift_start_time?.substring(0, 5) || "";
        const shiftEnd = log.shift_end_time?.substring(0, 5) || "";
        const loginTimeStr = log.login_time ? new Date(log.login_time).toTimeString().substring(0, 5) : "";
        const logoutTimeStr = log.logout_time ? new Date(log.logout_time).toTimeString().substring(0, 5) : null;

        // Calculate session duration
        let sessionDuration: number | null = null;
        if (log.login_time && log.logout_time) {
          sessionDuration = (new Date(log.logout_time).getTime() - new Date(log.login_time).getTime()) / 60000; // minutes
        }

        // Determine status
        let status = "On Time";
        if (shiftStart && loginTimeStr > shiftStart) {
          status = "Late Login";
        }
        if (log.logout_time && shiftEnd && logoutTimeStr && logoutTimeStr < shiftEnd) {
          status = status === "Late Login" ? "Late Login" : "Early Logout";
        }

        activities.push({
          id: log.id,
          type: "login",
          user_id: log.user_id,
          user_name: userInfo.full_name,
          role: userInfo.role,
          shift_date: log.shift_date,
          shift_start: shiftStart,
          shift_end: shiftEnd,
          login_time: log.login_time,
          logout_time: log.logout_time,
          session_duration: sessionDuration,
          status,
        });
      }

      // Add blocked attempts
      for (const attempt of blockedAttempts || []) {
        activities.push({
          id: attempt.id,
          type: "blocked",
          user_id: attempt.user_id,
          user_name: attempt.user_name,
          role: attempt.role,
          shift_date: attempt.attempt_time?.substring(0, 10) || "",
          shift_start: null,
          shift_end: null,
          login_time: attempt.attempt_time,
          logout_time: null,
          session_duration: null,
          status: "Outside Shift (Blocked)",
          reason: attempt.reason,
        });
      }

      // Filter by status if provided
      let filtered = activities;
      if (statusFilter && statusFilter !== "all") {
        filtered = activities.filter(a => a.status === statusFilter);
      }

      // Sort by login_time descending
      filtered.sort((a, b) => new Date(b.login_time).getTime() - new Date(a.login_time).getTime());

      // Build per-agent summary
      const agentSummary: Record<string, { total_shifts: number; attended: number; late: number; early: number; blocked: number }> = {};
      for (const a of activities) {
        if (!agentSummary[a.user_id]) {
          agentSummary[a.user_id] = { total_shifts: 0, attended: 0, late: 0, early: 0, blocked: 0 };
        }
        const s = agentSummary[a.user_id];
        if (a.type === "blocked") {
          s.blocked++;
        } else {
          s.total_shifts++;
          s.attended++;
          if (a.status === "Late Login") s.late++;
          if (a.status === "Early Logout") s.early++;
        }
      }

      const summaryArray = Object.entries(agentSummary).map(([uid, s]) => ({
        user_id: uid,
        user_name: userMap[uid]?.full_name || activities.find(a => a.user_id === uid)?.user_name || "Unknown",
        ...s,
      }));

      return json({ activities: filtered, summary: summaryArray });
    }


    // ============================================================
    // SHIFT TEMPLATES
    // ============================================================

    // GET /api/shift-templates
    if (req.method === "GET" && path === "shift-templates") {
      const { data, error } = await adminClient.from("shift_templates").select("*").order("name", { ascending: true });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // POST /api/shift-templates
    if (req.method === "POST" && path === "shift-templates") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const body = await req.json();
      const { name, start_time, end_time } = body;
      if (!name || !start_time || !end_time) return json({ error: "name, start_time, end_time required" }, 400);
      const { data, error } = await adminClient.from("shift_templates").insert({ name: name.trim(), start_time, end_time, created_by: user.id }).select().single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/shift-templates/:id
    if (req.method === "PATCH" && segments[0] === "shift-templates" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const templateId = segments[1];
      const body = await req.json();
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.start_time !== undefined) updates.start_time = body.start_time;
      if (body.end_time !== undefined) updates.end_time = body.end_time;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await adminClient.from("shift_templates").update(updates).eq("id", templateId).select().single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Update future shifts that use this template name (propagate time changes)
      const today = new Date().toISOString().substring(0, 10);
      if (body.start_time || body.end_time) {
        const shiftUpdates: Record<string, any> = {};
        if (body.start_time) shiftUpdates.start_time = body.start_time;
        if (body.end_time) shiftUpdates.end_time = body.end_time;
        if (body.name && data) shiftUpdates.name = data.name;
        // Update future shifts with matching name
        const oldName = body.name ? body.name.trim() : data.name;
        await adminClient.from("shifts").update(shiftUpdates).eq("name", oldName).gte("date", today);
      }

      return json(data);
    }

    // DELETE /api/shift-templates/:id
    if (req.method === "DELETE" && segments[0] === "shift-templates" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const templateId = segments[1];
      const { error } = await adminClient.from("shift_templates").delete().eq("id", templateId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // POST /api/shift-templates/assign-week — assign a template to agents for a week
    if (req.method === "POST" && path === "shift-templates/assign-week") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const body = await req.json();
      const { template_id, agent_ids, week_start, days } = body;
      // days: array of date strings OR we generate Mon-Fri from week_start

      if (!template_id || !agent_ids?.length || !week_start) {
        return json({ error: "template_id, agent_ids, week_start required" }, 400);
      }

      // Get template
      const { data: template } = await adminClient.from("shift_templates").select("*").eq("id", template_id).single();
      if (!template) return json({ error: "Template not found" }, 404);

      // Generate dates for the week (Mon-Sun or custom days)
      let datesToCreate: string[] = [];
      if (days && Array.isArray(days) && days.length > 0) {
        datesToCreate = days;
      } else {
        // Default: Mon-Fri
        const start = new Date(week_start + "T12:00:00");
        for (let i = 0; i < 5; i++) {
          const d = new Date(start);
          d.setDate(d.getDate() + i);
          datesToCreate.push(d.toISOString().substring(0, 10));
        }
      }

      const createdShifts: any[] = [];
      for (const date of datesToCreate) {
        // Check if shift already exists for this template name + date
        const { data: existing } = await adminClient.from("shifts").select("id").eq("name", template.name).eq("date", date);
        
        let shiftId: string;
        if (existing && existing.length > 0) {
          shiftId = existing[0].id;
          // Update times in case template changed
          await adminClient.from("shifts").update({ start_time: template.start_time, end_time: template.end_time }).eq("id", shiftId);
        } else {
          const { data: newShift, error: shiftErr } = await adminClient.from("shifts").insert({
            name: template.name,
            date,
            start_time: template.start_time,
            end_time: template.end_time,
            created_by: user.id,
          }).select().single();
          if (shiftErr) return json({ error: sanitizeDbError(shiftErr) }, 400);
          shiftId = newShift.id;
          createdShifts.push(newShift);
        }

        // Add agent assignments (skip duplicates)
        for (const agentId of agent_ids) {
          const { data: existingAssignment } = await adminClient.from("shift_assignments").select("id").eq("shift_id", shiftId).eq("user_id", agentId);
          if (!existingAssignment || existingAssignment.length === 0) {
            await adminClient.from("shift_assignments").insert({ shift_id: shiftId, user_id: agentId });
          }
        }
      }

      return json({ success: true, shifts_created: createdShifts.length, days: datesToCreate.length });
    }

    // GET /api/warehouse/incoming-orders (confirmed orders + confirmed prediction leads)
    if (req.method === "GET" && path === "warehouse/incoming-orders") {
      if (!canViewModule("warehouse_incoming")) return json({ error: "Forbidden" }, 403);
      const agentFilter = url.searchParams.get("agent_id");
      let from = url.searchParams.get("from");
      let to = url.searchParams.get("to");
      const productFilter = url.searchParams.get("product");
      const sourceFilter = url.searchParams.get("source"); // "order" | "prediction_lead" | null
      const all = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";

      // Safety default: never let an unfiltered call dump the entire history and hammer the DB.
      // Warehouse work is almost always "last 1-3 months". Explicit from/to or ?all=1 bypasses.
      const DEFAULT_WINDOW_DAYS = 90;
      if (!all && !from) {
        const d = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000);
        from = d.toISOString();
      }

      const results: any[] = [];

      // Filter by status (default: confirmed + shipped)
      const statusFilter = url.searchParams.get("status"); // "confirmed" | "shipped" | null (both)

      // 1. Orders — always fetch orders (both standard and converted from prediction leads)
      // When source filter is "prediction_lead", only show orders that originated from prediction leads
      {
        let oQuery = adminClient.from("orders").select("*, order_items(id, product_id, product_name, quantity, price_per_unit, total_price)").order("created_at", { ascending: false });
        if (statusFilter) {
          oQuery = oQuery.eq("status", statusFilter);
        } else {
          oQuery = oQuery.in("status", ["confirmed", "shipped", "delivered", "paid"]);
        }
        if (agentFilter && agentFilter !== "all") oQuery = oQuery.eq("assigned_agent_id", agentFilter);
        if (from) oQuery = oQuery.gte("created_at", from);
        if (to) oQuery = oQuery.lte("created_at", to);
        if (productFilter) oQuery = oQuery.ilike("product_name", `%${productFilter}%`);
        // Apply source filter
        if (sourceFilter === "order") {
          oQuery = oQuery.is("source_lead_id", null);
        } else if (sourceFilter === "prediction_lead") {
          oQuery = oQuery.not("source_lead_id", "is", null);
        }

        // PostgREST default page size is 1000 rows — we must paginate explicitly
        // with .range() (same pattern used in dashboard-stats, CEO report, agent-performance,
        // segments membership counts, etc.). This guarantees we never silently truncate
        // even on wide windows or high-volume days. The composite indexes added in
        // 20260523093000_warehouse_incoming_orders_indexes.sql make the range scans efficient.
        const orders: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await oQuery.range(from, from + 999);
          if (error) throw error;
          if (!data || data.length === 0) break;
          orders.push(...data);
          if (data.length < 1000) break;
        }
        for (const o of orders) {
          results.push({
            id: o.id,
            display_id: o.display_id,
            customer_name: o.customer_name,
            customer_phone: o.customer_phone,
            customer_address: o.customer_address,
            customer_city: o.customer_city,
            postal_code: o.postal_code,
            birthday: o.birthday,
            product_name: o.product_name,
            product_id: o.product_id,
            price: o.price,
            quantity: o.quantity,
            assigned_agent_name: o.assigned_agent_name,
            assigned_agent_id: o.assigned_agent_id,
            created_at: o.created_at,
            status: o.status,
            source: o.source_lead_id ? "prediction_lead" : "order",
            source_lead_id: o.source_lead_id,
            order_items: o.order_items || [],
            ship_after_date: o.ship_after_date || null,
          });
        }
      }

      // 2. Unconverted prediction leads (confirmed but no linked order yet)
      if ((!sourceFilter || sourceFilter === "prediction_lead") && (!statusFilter || statusFilter === "confirmed")) {
        // Collect lead IDs that already have a linked order to avoid duplicates
        const linkedLeadIds = new Set(
          results.filter((r: any) => r.source_lead_id).map((r: any) => r.source_lead_id)
        );

        let lQuery = adminClient.from("prediction_leads").select("*, prediction_lists(name), prediction_lead_items(id, product_id, product_name, quantity, price_per_unit, total_price)").eq("status", "confirmed").order("created_at", { ascending: false });
        if (agentFilter && agentFilter !== "all") lQuery = lQuery.eq("assigned_agent_id", agentFilter);
        if (from) lQuery = lQuery.gte("created_at", from);
        if (to) lQuery = lQuery.lte("created_at", to);
        if (productFilter) lQuery = lQuery.ilike("product", `%${productFilter}%`);

        // Same explicit pagination as the orders branch above (PostgREST 1000-row safety).
        const leads: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await lQuery.range(from, from + 999);
          if (error) throw error;
          if (!data || data.length === 0) break;
          leads.push(...data);
          if (data.length < 1000) break;
        }
        for (const l of leads) {
          // Skip leads that already have a linked order
          if (linkedLeadIds.has(l.id)) continue;

          // Use prediction_lead_items if available for correct product display
          const items = l.prediction_lead_items || [];
          const productDisplay = items.length > 0
            ? items.map((i: any) => i.product_name).join(", ")
            : (l.product || "—");
          const totalPrice = items.length > 0
            ? items.reduce((s: number, i: any) => s + Number(i.total_price || 0), 0)
            : (l.price || 0);
          const totalQty = items.length > 0
            ? items.reduce((s: number, i: any) => s + (i.quantity || 0), 0)
            : (l.quantity || 1);

          results.push({
            id: l.id,
            display_id: `LEAD-${l.name?.substring(0, 8) || l.id.substring(0, 8)}`,
            customer_name: l.name,
            customer_phone: l.telephone,
            customer_address: l.address || "",
            customer_city: l.city || "",
            postal_code: "",
            birthday: null,
            product_name: productDisplay,
            product_id: null,
            price: totalPrice,
            quantity: totalQty,
            assigned_agent_name: l.assigned_agent_name,
            assigned_agent_id: l.assigned_agent_id,
            created_at: l.created_at,
            status: "confirmed",
            source: "prediction_lead",
            list_name: l.prediction_lists?.name || "",
            notes: l.notes || "",
            order_items: items.length > 0 ? items : [],
          });
        }
      }

      // Sort combined by date desc
      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return json(results);
    }

    // PATCH /api/warehouse/incoming-orders/:id (admin/manager/warehouse can edit order or lead)
    if (req.method === "PATCH" && segments[0] === "warehouse" && segments[1] === "incoming-orders" && segments.length === 3) {
      if (!canViewModule("warehouse_incoming")) return json({ error: "Forbidden" }, 403);
      const itemId = segments[2];
      const body = await req.json();
      const source = body._source; // "order" or "prediction_lead"

      if (source === "prediction_lead") {
        // Update prediction lead fields
        const leadUpdates: Record<string, any> = {};
        if (body.customer_name !== undefined) leadUpdates.name = body.customer_name;
        if (body.customer_phone !== undefined) leadUpdates.telephone = body.customer_phone;
        if (body.customer_address !== undefined) leadUpdates.address = body.customer_address;
        if (body.customer_city !== undefined) leadUpdates.city = body.customer_city;
        if (body.product_name !== undefined) leadUpdates.product = body.product_name;
        if (body.quantity !== undefined) leadUpdates.quantity = body.quantity;
        if (body.price !== undefined) leadUpdates.price = body.price;
        if (body.notes !== undefined) leadUpdates.notes = body.notes;

        // Map order/warehouse statuses to valid lead_status enum values
        if (body.status !== undefined) {
          const validLeadStatuses = ["not_contacted", "no_answer", "interested", "not_interested", "confirmed"];
          const orderToLeadStatusMap: Record<string, string> = {
            pending: "not_contacted",
            take: "interested",
            call_again: "no_answer",
            confirmed: "confirmed",
            shipped: "confirmed",
            delivered: "confirmed",
            returned: "not_interested",
            paid: "confirmed",
            trashed: "not_interested",
            cancelled: "not_interested",
          };
          leadUpdates.status = validLeadStatuses.includes(body.status)
            ? body.status
            : (orderToLeadStatusMap[body.status] || "not_contacted");
        }

        const { data: updatedLead, error } = await adminClient
          .from("prediction_leads")
          .update(leadUpdates)
          .eq("id", itemId)
          .select()
          .single();
        if (error) return json({ error: sanitizeDbError(error) }, 400);

        // If status changed, sync with linked order
        if (body.status) {
          const { data: existingOrder } = await adminClient
            .from("orders")
            .select("id, status")
            .eq("source_lead_id", itemId)
            .maybeSingle();

          if (existingOrder) {
            // Map lead status to order status
            const statusMap: Record<string, string> = {
              not_contacted: "pending",
              no_answer: "call_again",
              interested: "take",
              not_interested: "cancelled",
              confirmed: "confirmed",
            };
            const orderStatus = statusMap[body.status] || body.status;
            // Also sync fields
            const orderSync: Record<string, any> = { status: orderStatus };
            if (body.customer_name !== undefined) orderSync.customer_name = body.customer_name;
            if (body.customer_phone !== undefined) orderSync.customer_phone = body.customer_phone;
            if (body.customer_address !== undefined) orderSync.customer_address = body.customer_address;
            if (body.customer_city !== undefined) orderSync.customer_city = body.customer_city;
            if (body.product_name !== undefined) orderSync.product_name = body.product_name;
            if (body.quantity !== undefined) orderSync.quantity = body.quantity;
            if (body.price !== undefined) orderSync.price = body.price;

            await adminClient.from("orders").update(orderSync).eq("id", existingOrder.id);

            if (existingOrder.status !== orderStatus) {
              const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
              await adminClient.from("order_history").insert({
                order_id: existingOrder.id,
                from_status: existingOrder.status,
                to_status: orderStatus,
                changed_by: user.id,
                changed_by_name: profile?.full_name || "Warehouse",
              });
            }
          } else if (["call_again", "confirmed"].includes(body.status)) {
            // Create order if none exists
            const lead = updatedLead;
            const { data: agentProfile } = lead.assigned_agent_id
              ? await adminClient.from("profiles").select("full_name").eq("user_id", lead.assigned_agent_id).single()
              : { data: null };
            const { data: newOrder } = await adminClient
              .from("orders")
              .insert({
                product_name: lead.product || "From Prediction Lead",
                customer_name: lead.name || "",
                customer_phone: lead.telephone || "",
                customer_city: lead.city || "",
                customer_address: lead.address || "",
                price: lead.price || 0,
                quantity: lead.quantity || 1,
                status: body.status === "confirmed" ? "confirmed" : "call_again",
                source_type: "prediction_lead",
                source_lead_id: itemId,
                assigned_agent_id: lead.assigned_agent_id,
                assigned_agent_name: agentProfile?.full_name || lead.assigned_agent_name || null,
                assigned_at: lead.assigned_agent_id ? new Date().toISOString() : null,
              })
              .select()
              .single();
            if (newOrder) {
              await adminClient.from("order_history").insert({
                order_id: newOrder.id,
                to_status: newOrder.status,
                changed_by: user.id,
                changed_by_name: "Warehouse",
              });
            }
          }
        }

        return json(updatedLead);
      } else {
        // Update order fields directly using adminClient
        const orderUpdates: Record<string, any> = {};
        if (body.customer_name !== undefined) orderUpdates.customer_name = body.customer_name;
        if (body.customer_phone !== undefined) orderUpdates.customer_phone = body.customer_phone;
        if (body.customer_address !== undefined) orderUpdates.customer_address = body.customer_address;
        if (body.customer_city !== undefined) orderUpdates.customer_city = body.customer_city;
        if (body.postal_code !== undefined) orderUpdates.postal_code = body.postal_code;
        if (body.birthday !== undefined) orderUpdates.birthday = body.birthday;
        if (body.product_name !== undefined) orderUpdates.product_name = body.product_name;
        if (body.product_id !== undefined) orderUpdates.product_id = body.product_id;
        if (body.quantity !== undefined) orderUpdates.quantity = body.quantity;
        if (body.price !== undefined) orderUpdates.price = body.price;

        // Handle status change
        if (body.status !== undefined) {
          const { data: currentOrder } = await adminClient.from("orders").select("*").eq("id", itemId).single();
          if (!currentOrder) return json({ error: "Order not found" }, 404);

          // Stock deduction on shipped — supports multi-product orders
          if (body.status === "shipped" && currentOrder.status !== "shipped") {
            const { data: orderItems } = await adminClient.from("order_items").select("*").eq("order_id", itemId);
            if (orderItems && orderItems.length > 0) {
              // Multi-product: check stock for all items first
              for (const item of orderItems) {
                if (!item.product_id) continue;
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
                if (product && product.stock_quantity < item.quantity) {
                  return json({ error: `Insufficient stock: ${product.name} has ${product.stock_quantity} available, but order requires ${item.quantity}` }, 400);
                }
              }
              // All checks passed, deduct
              for (const item of orderItems) {
                if (!item.product_id) continue;
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", item.product_id).single();
                if (product) {
                  const newQty = product.stock_quantity - item.quantity;
                  await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", item.product_id);
                  await adminClient.from("inventory_logs").insert({
                    product_id: item.product_id,
                    change_amount: -item.quantity,
                    previous_stock: product.stock_quantity,
                    new_stock: newQty,
                    reason: "order_deduction",
                    movement_type: "order_deduction",
                    user_id: user.id,
                    notes: `Order ${currentOrder.display_id} shipped (warehouse) — ${item.product_name}`,
                  });
                }
              }
            } else {
              // Legacy single-product fallback
              const orderQty = body.quantity ?? currentOrder.quantity ?? 1;
              const productId = body.product_id ?? currentOrder.product_id;
              if (productId) {
                const { data: product } = await adminClient.from("products").select("stock_quantity, name").eq("id", productId).single();
                if (product && product.stock_quantity < orderQty) {
                  return json({ error: `Insufficient stock: ${product.name} has ${product.stock_quantity} available, but order requires ${orderQty}` }, 400);
                }
                if (product) {
                  const newQty = product.stock_quantity - orderQty;
                  await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", productId);
                  await adminClient.from("inventory_logs").insert({
                    product_id: productId,
                    change_amount: -orderQty,
                    previous_stock: product.stock_quantity,
                    new_stock: newQty,
                    reason: "order_deduction",
                    movement_type: "order_deduction",
                    user_id: user.id,
                    notes: `Order ${currentOrder.display_id} shipped (warehouse)`,
                  });
                }
              }
            }
          }

          orderUpdates.status = body.status;
          const { data: profile } = await adminClient.from("profiles").select("full_name").eq("user_id", user.id).single();
          await adminClient.from("order_history").insert({
            order_id: itemId,
            from_status: currentOrder.status,
            to_status: body.status,
            changed_by: user.id,
            changed_by_name: profile?.full_name || "Warehouse",
          });

          // Sync back to prediction lead if linked
          if (currentOrder.source_lead_id) {
            const leadStatusMap: Record<string, string> = {
              pending: "not_contacted",
              take: "interested",
              call_again: "no_answer",
              confirmed: "confirmed",
            };
            const leadStatus = leadStatusMap[body.status];
            if (leadStatus) {
              await adminClient.from("prediction_leads").update({ status: leadStatus }).eq("id", currentOrder.source_lead_id);
            }
          }
        }

        const { data, error } = await adminClient.from("orders").update(orderUpdates).eq("id", itemId).select().single();
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        return json(data);
      }
    }

    // DELETE /api/warehouse/incoming-orders/:id
    if (req.method === "DELETE" && segments[0] === "warehouse" && segments[1] === "incoming-orders" && segments.length === 3) {
      if (!canViewModule("warehouse_incoming")) return json({ error: "Forbidden" }, 403);
      const itemId = segments[2];
      const source = url.searchParams.get("source");

      if (source === "prediction_lead") {
        // Delete linked order first if exists
        await adminClient.from("orders").delete().eq("source_lead_id", itemId);
        const { error } = await adminClient.from("prediction_leads").delete().eq("id", itemId);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
      } else {
        // Delete order notes and history first
        await adminClient.from("order_notes").delete().eq("order_id", itemId);
        await adminClient.from("order_history").delete().eq("order_id", itemId);
        const { error } = await adminClient.from("orders").delete().eq("id", itemId);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
      }
      return json({ success: true });
    }

    // GET /api/warehouse/user-items (admin: all, agent: own)
    if (req.method === "GET" && path === "warehouse/user-items") {
      let query = adminClient.from("user_warehouse").select("*, products(name, sku, price, stock_quantity)").order("created_at", { ascending: false });
      if (!isAdminOrManager && !isWarehouse) {
        query = query.eq("user_id", user.id);
      }
      const { data, error } = await query;
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Enrich with user names
      const userIds = [...new Set((data || []).map((d: any) => d.user_id))];
      let userMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await adminClient.from("profiles").select("user_id, full_name").in("user_id", userIds);
        for (const p of profiles || []) userMap[p.user_id] = p.full_name;
      }

      const enriched = (data || []).map((d: any) => ({
        ...d,
        user_name: userMap[d.user_id] || "Unknown",
        product_name: d.products?.name || "Unknown",
        product_sku: d.products?.sku || null,
        product_price: d.products?.price || 0,
      }));
      return json(enriched);
    }

    // POST /api/warehouse/user-items (admin: assign product to user)
    if (req.method === "POST" && path === "warehouse/user-items") {
      if (!isAdminOrManager && !isWarehouse) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(warehouseItemSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const { user_id: targetUserId, product_id, quantity, notes: itemNotes } = body;

      // Upsert: if exists, add quantity
      const { data: existing } = await adminClient
        .from("user_warehouse")
        .select("id, quantity")
        .eq("user_id", targetUserId)
        .eq("product_id", product_id)
        .single();

      let result;
      if (existing) {
        const { data, error } = await adminClient
          .from("user_warehouse")
          .update({ quantity: existing.quantity + (quantity || 1), assigned_by: user.id, notes: itemNotes || "" })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        result = data;
      } else {
        const { data, error } = await adminClient
          .from("user_warehouse")
          .insert({ user_id: targetUserId, product_id, quantity: quantity || 1, assigned_by: user.id, notes: itemNotes || "" })
          .select()
          .single();
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        result = data;
      }
      return json(result);
    }

    // PATCH /api/warehouse/user-items/:id (admin: update assignment)
    if (req.method === "PATCH" && segments[0] === "warehouse" && segments[1] === "user-items" && segments.length === 3) {
      if (!isAdminOrManager && !isWarehouse) return json({ error: "Forbidden" }, 403);
      const itemId = segments[2];
      const body = await req.json();
      const updates: Record<string, any> = {};
      if (body.quantity !== undefined) updates.quantity = body.quantity;
      if (body.user_id !== undefined) updates.user_id = body.user_id;
      if (body.notes !== undefined) updates.notes = body.notes;

      const { data, error } = await adminClient
        .from("user_warehouse")
        .update(updates)
        .eq("id", itemId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // DELETE /api/warehouse/user-items/:id (admin only)
    if (req.method === "DELETE" && segments[0] === "warehouse" && segments[1] === "user-items" && segments.length === 3) {
      if (!isAdminOrManager && !isWarehouse) return json({ error: "Forbidden" }, 403);
      const itemId = segments[2];
      const { error } = await adminClient.from("user_warehouse").delete().eq("id", itemId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // GET /api/me
    if (req.method === "GET" && path === "me") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      // Derive a primary role for legacy callers (mirror determinePrimaryRole in AuthContext)
      const primaryRole = isAdmin ? "admin"
        : isManager ? "manager"
        : roles.includes("prediction_agent") ? "prediction_agent"
        : roles.includes("pending_agent") ? "pending_agent"
        : roles.includes("agent") ? "agent"
        : isWarehouse ? "warehouse"
        : isAdsAdmin ? "ads_admin"
        : "pending_agent";

      return json({ ...profile, role: primaryRole, roles });
    }

    // GET /api/recent-activity
    if (req.method === "GET" && path === "recent-activity") {
      const limit = parseInt(url.searchParams.get("limit") || "20");
      // Call Agents (non admin/manager) only see their OWN activity, never the
      // system-wide feed. Admins/managers see everything.
      const scopeMine = !isAdminOrManager;

      // Strip the technical backup payload the address-restructure script
      // appends ("... __ORIG__{json}") so notes read as plain text, not code.
      const cleanActivityNote = (t: string) =>
        (t || "").replace(/\s*__ORIG__[\s\S]*$/, "").replace(/\s*Original: city=[\s\S]*$/, "").trim();

      // Fetch recent order status changes
      let statusQ = adminClient
        .from("order_history")
        .select("id, order_id, from_status, to_status, changed_by_name, changed_at")
        .order("changed_at", { ascending: false })
        .limit(limit);
      if (scopeMine) statusQ = statusQ.eq("changed_by", user.id);
      const { data: statusChanges } = await statusQ;

      // Fetch recent call logs
      let callsQ = adminClient
        .from("call_logs")
        .select("id, context_type, context_id, outcome, notes, agent_id, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (scopeMine) callsQ = callsQ.eq("agent_id", user.id);
      const { data: callLogs } = await callsQ;

      // Fetch recent order notes
      let notesQ = adminClient
        .from("order_notes")
        .select("id, order_id, author_name, text, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (scopeMine) notesQ = notesQ.eq("author_id", user.id);
      const { data: orderNotes } = await notesQ;

      // Get agent names for call logs
      const agentIds = [...new Set((callLogs || []).map((c: any) => c.agent_id))];
      const agentNameMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: profiles } = await adminClient
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", agentIds);
        for (const p of profiles || []) {
          agentNameMap[p.user_id] = p.full_name;
        }
      }

      // Get display_ids for orders referenced in status changes and notes
      const orderIds = [
        ...new Set([
          ...(statusChanges || []).map((s: any) => s.order_id),
          ...(orderNotes || []).map((n: any) => n.order_id),
        ]),
      ];
      const orderDisplayMap: Record<string, string> = {};
      if (orderIds.length > 0) {
        const { data: orders } = await adminClient
          .from("orders")
          .select("id, display_id")
          .in("id", orderIds);
        for (const o of orders || []) {
          orderDisplayMap[o.id] = o.display_id;
        }
      }

      // Merge into unified activity feed
      const activities: any[] = [];

      for (const s of statusChanges || []) {
        activities.push({
          id: s.id,
          type: "status_change",
          actor: s.changed_by_name || "System",
          description: `Changed order ${orderDisplayMap[s.order_id] || "?"} from ${s.from_status || "new"} to ${s.to_status}`,
          order_id: s.order_id,
          display_id: orderDisplayMap[s.order_id],
          metadata: { from: s.from_status, to: s.to_status },
          timestamp: s.changed_at,
        });
      }

      for (const c of callLogs || []) {
        activities.push({
          id: c.id,
          type: "call",
          actor: agentNameMap[c.agent_id] || "Agent",
          description: `Made a ${c.outcome} call (${c.context_type})`,
          metadata: { outcome: c.outcome, context_type: c.context_type, notes: c.notes },
          timestamp: c.created_at,
        });
      }

      for (const n of orderNotes || []) {
        const noteText = cleanActivityNote(n.text);
        activities.push({
          id: n.id,
          type: "note",
          actor: n.author_name,
          description: `Added note on ${orderDisplayMap[n.order_id] || "order"}: "${noteText.substring(0, 60)}${noteText.length > 60 ? "..." : ""}"`,
          order_id: n.order_id,
          display_id: orderDisplayMap[n.order_id],
          timestamp: n.created_at,
        });
      }

      // Sort by timestamp descending
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return json(activities.slice(0, limit));
    }

    // ============================================================
    // ADS CAMPAIGNS
    // ============================================================

    // GET /api/ads-campaigns
    if (req.method === "GET" && path === "ads-campaigns") {
      if (!isAdmin && !isAdsAdmin) return json({ error: "Forbidden" }, 403);
      const platform = url.searchParams.get("platform");
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");

      let query = adminClient
        .from("ads_campaigns")
        .select("*")
        .order("created_at", { ascending: false });

      if (platform) query = query.eq("platform", platform);
      if (status) query = query.eq("status", status);
      if (search) query = query.ilike("campaign_name", `%${search}%`);

      const { data, error } = await query;
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // POST /api/ads-campaigns
    if (req.method === "POST" && path === "ads-campaigns") {
      if (!isAdmin && !isAdsAdmin) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(createCampaignSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      const { data, error } = await adminClient
        .from("ads_campaigns")
        .insert({ campaign_name: body.campaign_name, platform: body.platform, budget: body.budget, notes: body.notes })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Audit log
      await adminClient.from("ads_audit_logs").insert({
        campaign_id: data.id,
        action: "created",
        details: `Campaign "${body.campaign_name}" created on ${body.platform}`,
        performed_by: user.id,
      });

      return json(data);
    }

    // PATCH /api/ads-campaigns/:id
    if (req.method === "PATCH" && segments[0] === "ads-campaigns" && segments.length === 2) {
      if (!isAdmin && !isAdsAdmin) return json({ error: "Forbidden" }, 403);
      const campaignId = segments[1];
      const body = await req.json();

      const updates: Record<string, any> = {};
      if (body.campaign_name !== undefined) updates.campaign_name = body.campaign_name;
      if (body.platform !== undefined) updates.platform = body.platform;
      if (body.status !== undefined) updates.status = body.status;
      if (body.budget !== undefined) updates.budget = body.budget;
      if (body.notes !== undefined) updates.notes = body.notes;

      const { data, error } = await adminClient
        .from("ads_campaigns")
        .update(updates)
        .eq("id", campaignId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Audit log
      await adminClient.from("ads_audit_logs").insert({
        campaign_id: campaignId,
        action: "updated",
        details: `Updated fields: ${Object.keys(updates).join(", ")}`,
        performed_by: user.id,
      });

      return json(data);
    }

    // DELETE /api/ads-campaigns/:id
    if (req.method === "DELETE" && segments[0] === "ads-campaigns" && segments.length === 2) {
      if (!isAdmin && !isAdsAdmin) return json({ error: "Forbidden" }, 403);
      const campaignId = segments[1];

      // Audit log before delete
      await adminClient.from("ads_audit_logs").insert({
        campaign_id: campaignId,
        action: "deleted",
        details: `Campaign deleted`,
        performed_by: user.id,
      });

      const { error } = await adminClient.from("ads_campaigns").delete().eq("id", campaignId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // GET /api/inbound-leads (admin only)
    if (req.method === "GET" && path === "inbound-leads") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const status = url.searchParams.get("status");
      let query = adminClient
        .from("inbound_leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (status && status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/inbound-leads/:id (admin only)
    if (req.method === "PATCH" && segments[0] === "inbound-leads" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const leadId = segments[1];
      const body = await req.json();
      const allowed: Record<string, boolean> = { status: true, name: true, phone: true, source: true };
      const updates: Record<string, any> = {};
      for (const [k, v] of Object.entries(body)) {
        if (allowed[k]) updates[k] = v;
      }
      if (Object.keys(updates).length === 0) return json({ error: "No valid fields" }, 400);
      const { error } = await adminClient.from("inbound_leads").update(updates).eq("id", leadId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Sync status to linked order
      if (updates.status) {
        const validOrderStatuses = ["pending", "take", "call_again", "confirmed", "shipped", "delivered", "returned", "paid", "trashed", "cancelled"];
        if (validOrderStatuses.includes(updates.status)) {
          await adminClient
            .from("orders")
            .update({ status: updates.status })
            .eq("inbound_lead_id", leadId);
        }
      }

      return json({ success: true });
    }

    // DELETE /api/inbound-leads/:id (admin only)
    if (req.method === "DELETE" && segments[0] === "inbound-leads" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const leadId = segments[1];
      const { error } = await adminClient.from("inbound_leads").delete().eq("id", leadId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // ── WEBHOOKS CRUD (admin only) ──

    // GET /api/webhooks
    if (req.method === "GET" && path === "webhooks") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data, error } = await adminClient
        .from("webhooks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // POST /api/webhooks
    if (req.method === "POST" && path === "webhooks") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const body = await req.json();
      const productName = (body.product_name || "").trim();
      if (!productName || productName.length > 200) return json({ error: "Product name is required (max 200 chars)" }, 400);
      const description = (body.description || "").substring(0, 2000);

      const slug = productName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 60) + "-" + crypto.randomUUID().substring(0, 8);

      const { data, error } = await adminClient
        .from("webhooks")
        .insert({ product_name: productName, description, slug, created_by: user.id })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      await audit(adminClient, user.id, user.email, "webhook.create", {
        target_type: "webhook",
        target_id: data.id,
        target_name: productName,
        payload: { slug, product_name: productName },
      });
      return json(data);
    }

    // PATCH /api/webhooks/:id
    if (req.method === "PATCH" && segments[0] === "webhooks" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const webhookId = segments[1];
      const body = await req.json();
      const updates: Record<string, any> = {};
      if (body.product_name !== undefined) updates.product_name = body.product_name.substring(0, 200);
      if (body.description !== undefined) updates.description = body.description.substring(0, 2000);
      if (body.status !== undefined && ["active", "disabled"].includes(body.status)) updates.status = body.status;
      if (Object.keys(updates).length === 0) return json({ error: "No valid fields" }, 400);

      const { data, error } = await adminClient
        .from("webhooks")
        .update(updates)
        .eq("id", webhookId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      await audit(adminClient, user.id, user.email, "webhook.update", {
        target_type: "webhook",
        target_id: webhookId,
        target_name: data?.product_name ?? null,
        payload: { updates },
      });
      return json(data);
    }

    // DELETE /api/webhooks/:id
    if (req.method === "DELETE" && segments[0] === "webhooks" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const webhookId = segments[1];

      const { data: existing } = await adminClient
        .from("webhooks")
        .select("product_name, slug")
        .eq("id", webhookId)
        .single();

      const { error } = await adminClient.from("webhooks").delete().eq("id", webhookId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      await audit(adminClient, user.id, user.email, "webhook.delete", {
        target_type: "webhook",
        target_id: webhookId,
        target_name: existing?.product_name ?? null,
        payload: existing ? { slug: existing.slug } : {},
      });
      return json({ success: true });
    }

    // ============================================================
    // SUPPLIERS
    // ============================================================

    // GET /api/suppliers
    if (req.method === "GET" && path === "suppliers") {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // POST /api/suppliers
    if (req.method === "POST" && path === "suppliers") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(createSupplierSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }
      const { data, error } = await adminClient
        .from("suppliers")
        .insert(body)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/suppliers/:id
    if (req.method === "PATCH" && segments[0] === "suppliers" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const supplierId = segments[1];
      const body = await req.json();
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.contact_info !== undefined) updates.contact_info = body.contact_info;
      if (body.email !== undefined) updates.email = body.email;
      if (body.phone !== undefined) updates.phone = body.phone;
      if (body.address !== undefined) updates.address = body.address;
      const { data, error } = await adminClient
        .from("suppliers")
        .update(updates)
        .eq("id", supplierId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // DELETE /api/suppliers/:id
    if (req.method === "DELETE" && segments[0] === "suppliers" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const supplierId = segments[1];
      const { error } = await adminClient.from("suppliers").delete().eq("id", supplierId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // ============================================================
    // RESTOCK
    // ============================================================

    // POST /api/restock
    if (req.method === "POST" && path === "restock") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = parseBody(restockSchema, await req.json()); } catch (e: any) { return json({ error: e.message }, 400); }

      const { data: product } = await adminClient
        .from("products")
        .select("stock_quantity, name")
        .eq("id", body.product_id)
        .single();
      if (!product) return json({ error: "Product not found" }, 404);

      const newQty = product.stock_quantity + body.quantity;
      await adminClient.from("products").update({ stock_quantity: newQty }).eq("id", body.product_id);
      await adminClient.from("inventory_logs").insert({
        product_id: body.product_id,
        change_amount: body.quantity,
        previous_stock: product.stock_quantity,
        new_stock: newQty,
        reason: "restock",
        movement_type: "restock",
        user_id: user.id,
        supplier_name: body.supplier_name,
        invoice_number: body.invoice_number,
        notes: body.notes,
      });

      return json({ success: true, product_name: product.name, new_stock: newQty });
    }

    // GET /api/stock-movements (all movements across products)
    if (req.method === "GET" && path === "stock-movements") {
      const productId = url.searchParams.get("product_id");
      const movementType = url.searchParams.get("movement_type");
      const limit = parseInt(url.searchParams.get("limit") || "100");

      let query = adminClient
        .from("inventory_logs")
        .select("*, products:product_id(name, sku)")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (productId) query = query.eq("product_id", productId);
      if (movementType) query = query.eq("movement_type", movementType);

      const { data, error } = await query;
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Enrich with user names
      const userIds = [...new Set((data || []).map((d: any) => d.user_id).filter(Boolean))];
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds.length > 0 ? userIds : ["__none__"]);
      const profileMap: Record<string, string> = {};
      for (const p of profiles || []) profileMap[p.user_id] = p.full_name;

      const enriched = (data || []).map((d: any) => ({
        ...d,
        user_name: profileMap[d.user_id] || "System",
        product_name: d.products?.name || "Unknown",
        product_sku: d.products?.sku || "",
      }));

      return json(enriched);
    }

    // GET /api/search-prediction?q=...
    if (req.method === "GET" && path === "search-prediction") {
      if (!checkUserRateLimit(user.id, "search-prediction", 60)) return json({ error: "Rate limit exceeded — slow down" }, 429);
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ orders: [], leads: [], order_history: [] });

      // Normalize phone: extract last 8 digits for matching
      const digitsOnly = q.replace(/\D/g, "");
      const last8 = digitsOnly.length >= 8 ? digitsOnly.slice(-8) : "";

      // Build search: name OR phone (last 8 digits pattern)
      // For orders
      let orderQuery = adminClient
        .from("orders")
        .select("*, order_items(id, product_name, quantity, price_per_unit, total_price)")
        .order("created_at", { ascending: false })
        .limit(50);

      let leadQuery = adminClient
        .from("prediction_leads")
        .select("*, prediction_lists(name)")
        .order("created_at", { ascending: false })
        .limit(50);

      if (last8) {
        // Search by last 8 digits of phone OR name
        orderQuery = orderQuery.or(`customer_name.ilike.%${q}%,customer_phone.ilike.%${last8}%,display_id.ilike.%${q}%`);
        leadQuery = leadQuery.or(`name.ilike.%${q}%,telephone.ilike.%${last8}%`);
      } else {
        // Text-only search (name / display_id)
        orderQuery = orderQuery.or(`customer_name.ilike.%${q}%,display_id.ilike.%${q}%`);
        leadQuery = leadQuery.or(`name.ilike.%${q}%`);
      }

      const [ordersRes, leadsRes] = await Promise.all([orderQuery, leadQuery]);
      const orders = (ordersRes.data || []).map((o: any) => ({
        ...o,
        is_owned: isAdminOrManager || o.assigned_agent_id === user.id,
      }));
      const leads = (leadsRes.data || []).map((l: any) => ({
        ...l,
        is_owned: isAdminOrManager || l.assigned_agent_id === user.id,
      }));

      // Get order history for found orders
      const orderIds = orders.map((o: any) => o.id);
      let historyData: any[] = [];
      if (orderIds.length > 0) {
        const { data: history } = await adminClient
          .from("order_history")
          .select("*")
          .in("order_id", orderIds)
          .order("changed_at", { ascending: false });
        historyData = history || [];
      }

      return json({
        orders: redactCustomerList(orders, piiFlags),
        leads: redactCustomerList(leads, piiFlags, true),
        order_history: showOrderHistory ? historyData : [],
      });
    }

    // ══════════════════════════════════════════════════════════════
    // COURIER OFFICES — Speedy + Econt branch picker
    // ══════════════════════════════════════════════════════════════

    // GET /api/courier-offices/cities?courier=speedy|econt&q=<prefix>&limit=15
    // Distinct cities matching the prefix. Matching is on city_normalized
    // (lowercase Latin) so typing "С" / "S" / "со" / "so" all match София.
    if (req.method === "GET" && segments[0] === "courier-offices" && segments[1] === "cities") {
      const courier = url.searchParams.get("courier");
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "15"), 50);
      if (courier !== "speedy" && courier !== "econt") return json({ error: "Invalid courier" }, 400);

      // Inline Cyrillic→Latin lowercaser (matches scripts/scrape-courier-offices.mjs)
      const CYR_TO_LAT: Record<string, string> = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i',
        'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s',
        'т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht',
        'ъ':'a','ь':'y','ю':'yu','я':'ya',
      };
      const qNorm = q.split('').map(c => CYR_TO_LAT[c] ?? c).join('');

      // Pull all active rows for this courier (max ~1300) and aggregate.
      const all: any[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await adminClient
          .from("courier_offices")
          .select("city, city_normalized")
          .eq("courier", courier)
          .eq("is_active", true)
          .range(from, from + PAGE - 1);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }

      const seen = new Map<string, { city: string; count: number }>();
      for (const r of all) {
        const cityNorm = (r.city_normalized || '').toLowerCase();
        if (qNorm && !cityNorm.startsWith(qNorm)) continue;
        if (!seen.has(r.city)) seen.set(r.city, { city: r.city, count: 0 });
        seen.get(r.city)!.count++;
      }
      const cities = [...seen.values()]
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, 'bg'))
        .slice(0, limit);
      return json(cities);
    }

    // GET /api/courier-offices?courier=speedy|econt&city=<exact>&limit=200
    // Offices in a specific city, sorted by office name.
    if (req.method === "GET" && path === "courier-offices") {
      const courier = url.searchParams.get("courier");
      const city = (url.searchParams.get("city") || "").trim();
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 500);
      if (courier !== "speedy" && courier !== "econt") return json({ error: "Invalid courier" }, 400);
      if (!city) return json([]);
      const { data, error } = await adminClient
        .from("courier_offices")
        .select("office_code, name, address, hours, lat, lng, post_code")
        .eq("courier", courier)
        .eq("city", city)
        .eq("is_active", true)
        .order("name")
        .limit(limit);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // GET /api/courier-offices/match?courier=&q=<freetext> — best-matching
    // offices for a legacy free-text courier address (e.g. "офис на Еконт- кв.
    // Бостанджиите, ул. Бели брези 21"). Tokenises the text, drops courier/
    // address-type stopwords, and ranks offices by how many distinctive tokens
    // appear in the office name + address. Lets the order modal auto-fill the
    // office that historical prose never stored a code for.
    if (req.method === "GET" && segments[0] === "courier-offices" && segments[1] === "match") {
      const courier = url.searchParams.get("courier");
      const q = (url.searchParams.get("q") || "").trim();
      if (courier !== "speedy" && courier !== "econt") return json({ error: "Invalid courier" }, 400);
      if (!q) return json([]);

      const STOP = new Set([
        "офис", "офиса", "на", "до", "еконт", "econt", "спиди", "speedy", "еконтомат", "econtomat",
        "ул", "улица", "бул", "булевард", "пл", "площад", "кв", "квартал", "жк", "кк", "блок", "бл",
        "ет", "етаж", "ап", "апартамент", "вх", "вход", "гр", "град", "село", "обл", "област",
        "общ", "община", "номер", "near",
      ]);
      const tokens = q.toLowerCase()
        .replace(/[^a-zа-я0-9 ]/gi, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
      if (tokens.length === 0) return json([]);

      const orFilter = tokens.slice(0, 6)
        .flatMap((t) => [`name.ilike.%${t}%`, `address.ilike.%${t}%`])
        .join(",");
      const { data } = await adminClient
        .from("courier_offices")
        .select("office_code, name, city, address")
        .eq("courier", courier)
        .eq("is_active", true)
        .or(orFilter)
        .limit(100);

      const scored = (data || [])
        .map((o: any) => {
          const hay = `${o.name} ${o.address}`.toLowerCase();
          const score = tokens.reduce((s: number, t: string) => s + (hay.includes(t) ? 1 : 0), 0);
          return { ...o, score };
        })
        .filter((o: any) => o.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 6);
      return json(scored);
    }

    // GET /api/courier-offices/by-code?courier=...&code=... — single office
    // for cases where we need to render the saved selection (e.g. OrderModal).
    if (req.method === "GET" && segments[0] === "courier-offices" && segments[1] === "by-code") {
      const courier = url.searchParams.get("courier");
      const code = url.searchParams.get("code");
      if (!courier || !code) return json({ error: "Missing courier or code" }, 400);
      const { data } = await adminClient
        .from("courier_offices")
        .select("office_code, name, city, address, hours, lat, lng, post_code")
        .eq("courier", courier)
        .eq("office_code", code)
        .maybeSingle();
      return json(data || null);
    }

    // ══════════════════════════════════════════════════════════════
    // SEGMENTS — admin/manager rule-driven customer lists
    // ══════════════════════════════════════════════════════════════

    // GET /api/segments — overview list with member counts
    if (req.method === "GET" && path === "segments") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const { data: lists, error: listsErr } = await adminClient
        .from("prediction_segment_lists")
        .select("*")
        .order("display_order", { ascending: true });
      if (listsErr) return json({ error: sanitizeDbError(listsErr) }, 400);

      // Membership counts. PostgREST caps each select at 1000 rows by default,
      // so we paginate via .range() until exhausted. With ~10k memberships
      // and 3 small columns this is fast.
      const PAGE = 1000;
      const counts: Record<string, { total: number; assigned: number; completed: number }> = {};
      let engineDataAsOf: string | null = null;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await adminClient
          .from("prediction_segment_members")
          .select("list_id, assigned_agent_id, is_completed, updated_at")
          .range(from, from + PAGE - 1);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const id = r.list_id;
          if (!counts[id]) counts[id] = { total: 0, assigned: 0, completed: 0 };
          counts[id].total++;
          if (r.assigned_agent_id) counts[id].assigned++;
          if (r.is_completed) counts[id].completed++;
          if (r.updated_at && (!engineDataAsOf || r.updated_at > engineDataAsOf)) engineDataAsOf = r.updated_at;
        }
        if (data.length < PAGE) break;
      }

      // Managers (investors) see that lists EXIST but not how many people are in
      // them — counts come back null so the UI can render "Admin only".
      const enriched = (lists || []).map((l: any) => ({
        ...l,
        member_count: showSegmentMembers ? (counts[l.id]?.total ?? 0) : null,
        assigned_count: showSegmentMembers ? (counts[l.id]?.assigned ?? 0) : null,
        completed_count: showSegmentMembers ? (counts[l.id]?.completed ?? 0) : null,
        engine_data_as_of: engineDataAsOf,
      }));

      return json(enriched);
    }

    // ── Prediction Engine config (no-code list builder) ──────────────────────
    // The classifier's thresholds (recency day-bands, value brackets, frequency
    // tiers, Current Cancels / Never-Converted windows, and the package-based
    // "Due to Reorder" knobs) live in segment_engine_config and are read by the
    // v4 engine. Until cutover, edits only affect the SHADOW table (v4), never
    // the live v3.4 lists — so saving is safe and reversible.

    // GET /api/segments/engine-config — the active config + which engine is live
    if (req.method === "GET" && segments[0] === "segments" && segments[1] === "engine-config" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data, error } = await adminClient
        .from("segment_engine_config")
        .select("id, version, config, active_engine, note, created_at")
        .eq("is_active", true)
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/segments/engine-diff — live (v3.4) vs shadow (v4) counts + drift
    if (req.method === "GET" && segments[0] === "segments" && segments[1] === "engine-diff" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data, error } = await adminClient.rpc("segment_engine_diff");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/segments/engine-controls — kill-switch + cron status for the dashboard
    if (req.method === "GET" && segments[0] === "segments" && segments[1] === "engine-controls" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data, error } = await adminClient.rpc("segment_engine_controls_status");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // POST /api/segments/shadow-engine — STOP/START the new preview (shadow) engine's
    // nightly job. Does NOT touch the live v3.4 engine or its 03:00 cron. Admin only.
    if (req.method === "POST" && segments[0] === "segments" && segments[1] === "shadow-engine" && segments.length === 2) {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const enabled = body?.enabled === true;
      const { error } = await adminClient.rpc("set_shadow_engine", { _enabled: enabled });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      await adminClient.from("audit_log").insert({
        actor_id: user.id, actor_email: user.email,
        action: enabled ? "segment.shadow_engine_on" : "segment.shadow_engine_off",
        target_type: "segment_engine_config", target_id: null,
        target_name: enabled ? "preview engine ON" : "preview engine STOPPED",
        payload: { enabled },
      });
      return json({ shadow_enabled: enabled });
    }

    // POST /api/segments/recompute-shadow — rebuild the preview (shadow) now. Admin only.
    if (req.method === "POST" && segments[0] === "segments" && segments[1] === "recompute-shadow" && segments.length === 2) {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "segments.recompute_shadow", 6)) return json({ error: "Rate limit exceeded — recompute is heavy; try again in a minute" }, 429);
      const { data, error } = await adminClient.rpc("recompute_all_segments_v4");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ recomputed_customers: data });
    }

    // PUT /api/segments/engine-config — save a new config version (admin only).
    // Validates shape, writes a new version atomically, syncs list rows, recomputes
    // the shadow table, and returns the resulting live-vs-shadow diff (the preview).
    if (req.method === "PUT" && segments[0] === "segments" && segments[1] === "engine-config" && segments.length === 2) {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      if (!checkUserRateLimit(user.id, "segments.engine_config", 6)) return json({ error: "Rate limit exceeded — engine recompute is heavy; try again in a minute" }, 429);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const cfg = body?.config;
      const note: string = typeof body?.note === "string" ? body.note.slice(0, 500) : "";

      // ── Validate the config shape so a bad save can't break classification ──
      const errs: string[] = [];
      const isArr = (x: any) => Array.isArray(x);
      if (!cfg || typeof cfg !== "object") errs.push("config must be an object");
      else {
        const rb = cfg.recency_bands, vb = cfg.value_bands, fb = cfg.frequency_bands;
        if (!isArr(rb) || rb.length === 0) errs.push("recency_bands must be a non-empty array");
        if (!isArr(vb) || vb.length === 0) errs.push("value_bands must be a non-empty array");
        if (!isArr(fb) || fb.length === 0) errs.push("frequency_bands must be a non-empty array");
        if (isArr(rb)) {
          if (!rb.some((b: any) => b && (b.max_days === null || b.max_days === undefined))) {
            errs.push("recency_bands must end with an open-ended band (max_days: null)");
          }
          let prev = -Infinity;
          for (const b of rb) {
            if (!b || !b.label) { errs.push("every recency band needs a label"); break; }
            if (b.max_days !== null && b.max_days !== undefined) {
              if (typeof b.max_days !== "number" || b.max_days <= prev) { errs.push("recency band max_days must ascend"); break; }
              prev = b.max_days;
            }
          }
        }
        if (isArr(vb) && !vb.some((b: any) => b && (b.max_price === null || b.max_price === undefined))) {
          errs.push("value_bands must end with an open-ended band (max_price: null)");
        }
        if (isArr(fb)) {
          for (const b of fb) if (!b || !b.label || typeof b.min_count !== "number") { errs.push("every frequency band needs a label and numeric min_count"); break; }
        }
        if (cfg.windows == null || typeof cfg.windows !== "object") errs.push("windows object is required");
      }
      if (errs.length) return json({ error: "Invalid engine config", details: errs }, 400);

      const { data: ver, error: setErr } = await adminClient.rpc("set_segment_engine_config", {
        _config: cfg, _note: note, _actor: user.id,
      });
      if (setErr) return json({ error: sanitizeDbError(setErr) }, 400);

      const { data: diff } = await adminClient.rpc("segment_engine_diff");

      await adminClient.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "segment.engine_config_update",
        target_type: "segment_engine_config",
        target_id: null,
        target_name: `engine config v${ver}`,
        payload: { version: ver, note },
      });

      return json({ version: ver, diff });
    }

    // POST /api/segments — create a new (standalone/informational) list. The
    // matrix calling-lists are created automatically by the config band editor;
    // this is for additive/informational lists the operator wants by hand.
    if (req.method === "POST" && path === "segments") {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const name: string = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return json({ error: "name is required" }, 400);
      const category: string = ["value", "prestige", "cancel", "return", "other"].includes(body?.category) ? body.category : "other";
      const triggerEvent: string = ["last_paid", "last_cancelled", "last_returned", "last_trashed"].includes(body?.trigger_event) ? body.trigger_event : "last_paid";

      const { data, error } = await adminClient
        .from("prediction_segment_lists")
        .insert({
          name,
          description: typeof body?.description === "string" ? body.description : "",
          category,
          trigger_event: triggerEvent,
          is_static: body?.is_static === true,
          is_active: true,
          display_order: Number.isFinite(body?.display_order) ? body.display_order : 500,
        })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      await adminClient.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "segment.create",
        target_type: "prediction_segment_lists",
        target_id: data.id,
        target_name: name,
        payload: { category, trigger_event: triggerEvent, is_static: data.is_static },
      });
      return json(data, 201);
    }

    // DELETE /api/segments/:id — remove a list. Default = safe DEACTIVATE
    // (is_active=false, keeps history + assignments). ?hard=true hard-deletes,
    // but only when the list has no members (live or shadow) — otherwise refuse
    // and tell the operator to deactivate instead.
    if (req.method === "DELETE" && segments[0] === "segments" && segments.length === 2) {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      const listId = segments[1];
      const hard = url.searchParams.get("hard") === "true";

      const { data: list, error: listErr } = await adminClient
        .from("prediction_segment_lists")
        .select("id, name")
        .eq("id", listId)
        .single();
      if (listErr || !list) return json({ error: "Segment not found" }, 404);

      if (hard) {
        const { count: liveCount } = await adminClient
          .from("prediction_segment_members")
          .select("customer_phone", { count: "exact", head: true })
          .eq("list_id", listId);
        const { count: shadowCount } = await adminClient
          .from("prediction_segment_members_shadow")
          .select("customer_phone", { count: "exact", head: true })
          .eq("list_id", listId);
        if ((liveCount ?? 0) > 0 || (shadowCount ?? 0) > 0) {
          return json({ error: "List is not empty — deactivate it instead, or empty it first." }, 400);
        }
        const { error } = await adminClient.from("prediction_segment_lists").delete().eq("id", listId);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        await adminClient.from("audit_log").insert({
          actor_id: user.id, actor_email: user.email,
          action: "segment.delete", target_type: "prediction_segment_lists",
          target_id: listId, target_name: list.name, payload: { hard: true },
        });
        return json({ deleted: true });
      }

      const { error } = await adminClient
        .from("prediction_segment_lists")
        .update({ is_active: false })
        .eq("id", listId);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      await adminClient.from("audit_log").insert({
        actor_id: user.id, actor_email: user.email,
        action: "segment.deactivate", target_type: "prediction_segment_lists",
        target_id: listId, target_name: list.name, payload: { hard: false },
      });
      return json({ deactivated: true });
    }

    // GET /api/segments/:id — list info + paginated members
    if (req.method === "GET" && segments[0] === "segments" && segments.length === 2 && segments[1] !== "recompute" && segments[1] !== "engine-config" && segments[1] !== "engine-diff" && segments[1] !== "engine-controls") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      // The PEOPLE inside a list are hidden from roles without segment-member access
      // (managers/investors). They can still see that lists exist via GET /segments.
      if (!showSegmentMembers) return json({ error: "Forbidden — segment members are admin-only" }, 403);
      const listId = segments[1];
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
      const assignedFilter = url.searchParams.get("assigned"); // 'all' | 'none' | <agent_id>
      const completedFilter = url.searchParams.get("completed"); // 'all' | 'yes' | 'no'

      const { data: list, error: listErr } = await adminClient
        .from("prediction_segment_lists")
        .select("*")
        .eq("id", listId)
        .single();
      if (listErr || !list) return json({ error: "Segment not found" }, 404);

      let q = adminClient
        .from("prediction_segment_members")
        .select("*", { count: "exact" })
        .eq("list_id", listId)
        .order("trigger_event_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (assignedFilter === "none") q = q.is("assigned_agent_id", null);
      else if (assignedFilter && assignedFilter !== "all") q = q.eq("assigned_agent_id", assignedFilter);

      if (completedFilter === "yes") q = q.eq("is_completed", true);
      else if (completedFilter === "no") q = q.eq("is_completed", false);

      const { data: members, count, error } = await q;
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      return json({ list, members: members || [], total: count, page, limit });
    }

    // POST /api/segments/:id/assign — bulk-assign N members to an agent (or unassign)
    if (req.method === "POST" && segments[0] === "segments" && segments[2] === "assign") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      const listId = segments[1];
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const memberPhones: string[] = Array.isArray(body?.member_phones) ? body.member_phones.slice(0, 5000) : [];
      const agentId: string | null = body?.agent_id || null;
      if (memberPhones.length === 0) return json({ error: "No members specified" }, 400);

      let agentName: string | null = null;
      if (agentId) {
        const { data: profile } = await adminClient
          .from("profiles")
          .select("full_name")
          .eq("user_id", agentId)
          .single();
        agentName = profile?.full_name || null;
      }

      const { error, count } = await adminClient
        .from("prediction_segment_members")
        .update({
          assigned_agent_id: agentId,
          assigned_agent_name: agentName,
          assigned_at: agentId ? new Date().toISOString() : null,
        }, { count: "exact" })
        .eq("list_id", listId)
        .in("customer_phone", memberPhones);
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Audit
      await adminClient.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "segment.bulk_assign",
        target_type: "prediction_segment_members",
        target_id: listId,
        target_name: `${memberPhones.length} members → ${agentName || "Unassigned"}`,
        payload: { list_id: listId, agent_id: agentId, agent_name: agentName, count: memberPhones.length },
      });

      return json({ updated: count, agent_name: agentName });
    }

    // POST /api/segments/:id/auto-assign — distribute unassigned members across
    // 1+ agents. With 1 agent the whole (unassigned) list goes to them. With
    // 2+ agents the members are shuffled then chunked round-robin so each
    // agent gets ~equal share and no two agents see the same customer.
    // Body: { agent_ids: string[], scope?: 'unassigned' | 'all' }
    //   scope='unassigned' (default): only assign members where assigned_agent_id IS NULL
    //   scope='all': re-distribute every non-completed member, wiping current assignments
    if (req.method === "POST" && segments[0] === "segments" && segments[2] === "auto-assign") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      const listId = segments[1];
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const agentIds: string[] = Array.isArray(body?.agent_ids) ? body.agent_ids.filter((x: any) => typeof x === "string") : [];
      const scope: "unassigned" | "all" = body?.scope === "all" ? "all" : "unassigned";
      if (agentIds.length === 0) return json({ error: "At least one agent_id is required" }, 400);

      // Denorm: cache full_name per agent so we set assigned_agent_name in the update.
      const { data: agentProfiles } = await adminClient
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", agentIds);
      const nameById = new Map((agentProfiles || []).map((p: any) => [p.user_id, p.full_name as string]));

      // Pull all eligible member phones for this list (paginated to dodge the
      // 1000-row PostgREST default — see CLAUDE.md "PostgREST 1000-row
      // truncation"). is_completed=false always; assigned_agent_id IS NULL
      // only when scope='unassigned'.
      const memberPhones: string[] = [];
      for (let from = 0; ; from += 1000) {
        let q = adminClient
          .from("prediction_segment_members")
          .select("customer_phone")
          .eq("list_id", listId)
          .eq("is_completed", false)
          .range(from, from + 999);
        if (scope === "unassigned") q = q.is("assigned_agent_id", null);
        const { data, error } = await q;
        if (error) return json({ error: sanitizeDbError(error) }, 400);
        if (!data || data.length === 0) break;
        for (const row of data) memberPhones.push(row.customer_phone);
        if (data.length < 1000) break;
      }

      if (memberPhones.length === 0) {
        return json({ distributed: 0, per_agent: {}, scope });
      }

      // Fisher-Yates shuffle so the assignment isn't sensitive to whatever
      // order the segment trigger inserted the rows in (e.g. high-value
      // customers wouldn't all land on one agent if the list happens to be
      // sorted by lifetime_value).
      for (let i = memberPhones.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [memberPhones[i], memberPhones[j]] = [memberPhones[j], memberPhones[i]];
      }

      // Optional partial distribution: `limit` (absolute count) or `fraction`
      // (0–1, e.g. 0.5 for half). Applied AFTER the shuffle so the slice is a
      // fair random sample, not the first-inserted rows. No cap = whole pool.
      const cap = body?.limit != null
        ? Math.floor(Number(body.limit))
        : body?.fraction != null
          ? Math.ceil(memberPhones.length * Number(body.fraction))
          : memberPhones.length;
      const pool = memberPhones.slice(0, Math.max(0, Math.min(cap, memberPhones.length)));

      if (pool.length === 0) {
        return json({ distributed: 0, per_agent: {}, scope });
      }

      // Round-robin chunk across agent_ids.
      const buckets: Record<string, string[]> = {};
      for (const aid of agentIds) buckets[aid] = [];
      pool.forEach((phone, i) => {
        buckets[agentIds[i % agentIds.length]].push(phone);
      });

      // Apply per-agent updates. .in() handles up to a few thousand values
      // per call comfortably; chunk if needed.
      const perAgent: Record<string, number> = {};
      const nowIso = new Date().toISOString();
      const CHUNK = 1000;
      for (const agentId of agentIds) {
        const phones = buckets[agentId];
        if (phones.length === 0) { perAgent[agentId] = 0; continue; }
        const agentName = nameById.get(agentId) || null;
        let total = 0;
        for (let i = 0; i < phones.length; i += CHUNK) {
          const slice = phones.slice(i, i + CHUNK);
          const { error, count } = await adminClient
            .from("prediction_segment_members")
            .update({
              assigned_agent_id: agentId,
              assigned_agent_name: agentName,
              assigned_at: nowIso,
            }, { count: "exact" })
            .eq("list_id", listId)
            .in("customer_phone", slice);
          if (error) return json({ error: sanitizeDbError(error) }, 400);
          total += count || 0;
        }
        perAgent[agentId] = total;
      }

      await adminClient.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "segment.auto_assign",
        target_type: "prediction_segment_members",
        target_id: listId,
        target_name: `${pool.length} members → ${agentIds.length} agent${agentIds.length === 1 ? "" : "s"}`,
        payload: { list_id: listId, scope, agent_ids: agentIds, per_agent: perAgent, eligible: memberPhones.length, distributed: pool.length },
      });

      // One summary ping per agent who actually received members (never one-per-lead).
      for (const [aid, cnt] of Object.entries(perAgent)) {
        if (cnt > 0 && aid !== user.id) {
          await notifyUsers(adminClient, [aid], {
            type: "assignment",
            title: "New prediction leads assigned to you",
            message: `${cnt} new lead${cnt === 1 ? "" : "s"} assigned to you — open Prediction Leads to start calling.`,
            link: "/prediction-leads",
          });
        }
      }

      return json({ distributed: pool.length, per_agent: perAgent, scope, eligible: memberPhones.length });
    }

    // POST /api/segments/:id/bulk-unassign — clear assignment for a whole
    // list, or just one agent's slice of it. scope: 'all' | <agent_id>.
    if (req.method === "POST" && segments[0] === "segments" && segments[2] === "bulk-unassign") {
      if (!canViewModule("assigner")) return json({ error: "Forbidden" }, 403);
      const listId = segments[1];
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const scope: string = typeof body?.scope === "string" && body.scope.length > 0 ? body.scope : "all";

      let q = adminClient
        .from("prediction_segment_members")
        .update({ assigned_agent_id: null, assigned_agent_name: null, assigned_at: null }, { count: "exact" })
        .eq("list_id", listId)
        .not("assigned_agent_id", "is", null);
      if (scope !== "all") q = q.eq("assigned_agent_id", scope);
      const { error, count } = await q;
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      await adminClient.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "segment.bulk_unassign",
        target_type: "prediction_segment_members",
        target_id: listId,
        target_name: `${count ?? 0} members unassigned (${scope === "all" ? "all" : "one agent"})`,
        payload: { list_id: listId, scope, unassigned: count ?? 0 },
      });

      return json({ unassigned: count ?? 0, scope });
    }

    // PATCH /api/segments/:id — admin-only edit of rule parameters
    if (req.method === "PATCH" && segments[0] === "segments" && segments.length === 2) {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const listId = segments[1];
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const updates: Record<string, any> = {};
      const allowedKeys = [
        "name", "description", "is_active", "display_order",
        "recency_months_min", "recency_months_max",
        "single_price_min", "single_price_max",
        "min_paid_count", "lifetime_min",
      ];
      for (const k of allowedKeys) {
        if (body[k] !== undefined) updates[k] = body[k];
      }
      if (Object.keys(updates).length === 0) return json({ error: "No updates provided" }, 400);

      const { data, error } = await adminClient
        .from("prediction_segment_lists")
        .update(updates)
        .eq("id", listId)
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);

      // Edited rules → re-classify everyone so memberships reflect the new thresholds
      await adminClient.rpc("recompute_all_segments");

      await adminClient.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "segment.update",
        target_type: "prediction_segment_lists",
        target_id: listId,
        target_name: data.name,
        payload: updates,
      });

      return json(data);
    }

    // POST /api/segments/recompute — admin/manager triggered classification refresh
    if (req.method === "POST" && segments[0] === "segments" && segments[1] === "recompute") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      if (!checkUserRateLimit(user.id, "segments.recompute", 6)) return json({ error: "Rate limit exceeded — recompute is heavy; try again in a minute" }, 429);
      const { data, error } = await adminClient.rpc("recompute_all_segments");
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ recomputed_customers: data });
    }

    // ══════════════════════════════════════════════════════════════
    // GET /api/customer-prefill?phone=... — one server-authorized bundle for the
    // Create/Confirm Order modal: the saved profile + the customer's recent
    // orders (with items). Looked up across ALL agents via adminClient (last-8
    // match, the CRM phone canon) so a front-line agent gets the customer's real
    // name/address even when the prior order was taken by someone else — the
    // RLS-scoped /orders search returns nothing for them (see resolveKnownCustomerName).
    // Returned UNREDACTED for order-creating roles: an agent literally cannot ship
    // an order without name/phone/address. Viewer-only roles keep the mask.
    if (req.method === "GET" && path === "customer-prefill") {
      const phone = (url.searchParams.get("phone") || "").trim();
      if (!phone) return json({ error: "phone required" }, 400);
      const last8 = phone.replace(/\D/g, "").slice(-8);
      if (last8.length < 8) return json({ profile: null, recent: [] });

      const [profRes, ordRes] = await Promise.all([
        adminClient.from("customer_profiles").select("*")
          .ilike("phone", `%${last8}`).order("updated_at", { ascending: false }).limit(1),
        adminClient.from("orders")
          .select("*, order_items(id, product_id, product_name, quantity, price_per_unit, total_price)")
          .ilike("customer_phone", `%${last8}`).order("created_at", { ascending: false }).limit(10),
      ]);
      const profile = profRes.data?.[0] || null;
      const recent = ordRes.data || [];

      if (canMutateOrders) return json({ profile, recent });
      // Viewer-only roles: keep masking consistent with the rest of the API.
      return json({
        profile: profile ? redactCustomer(profile, piiFlags) : null,
        recent: redactCustomerList(recent, piiFlags),
      });
    }

    // ══════════════════════════════════════════════════════════════
    // GET /api/customer-profile?phone=... — fetch the saved customer profile
    // (birthday / address / delivery prefs / notes) for pre-filling the order
    // modal. Returns null if none saved yet.
    if (req.method === "GET" && path === "customer-profile") {
      const phone = (url.searchParams.get("phone") || "").trim();
      if (!phone) return json({ error: "phone required" }, 400);
      const { data } = await adminClient
        .from("customer_profiles")
        .select("*")
        .eq("phone", phone)
        .maybeSingle();
      return json(data ? redactCustomer(data, piiFlags) : null);
    }

    // POST /api/customer-profile — upsert customer info by phone WITHOUT
    // creating an order. Any authenticated user (agents during a call) can do
    // this. Keyed on phone so re-saving updates the same row.
    if (req.method === "POST" && path === "customer-profile") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const phone = (body?.phone || "").trim();
      if (!phone) return json({ error: "phone required" }, 400);

      const payload = {
        phone,
        customer_name: body.customer_name ?? null,
        birthday: body.birthday || null,
        street: body.street ?? null,
        street_number: body.street_number ?? null,
        quarter: body.quarter ?? null,
        apartment: body.apartment ?? null,
        floor: body.floor ?? null,
        block: body.block ?? null,
        entry: body.entry ?? null,
        city: body.city ?? null,
        postal_code: body.postal_code ?? null,
        delivery_type: body.delivery_type ?? null,
        home_courier: body.home_courier ?? null,
        courier_office_code: body.courier_office_code ?? null,
        courier_office_name: body.courier_office_name ?? null,
        courier_office_city: body.courier_office_city ?? null,
        delivery_instructions: body.delivery_instructions ?? null,
        gift_note: body.gift_note ?? null,
        notes: body.notes ?? null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await adminClient
        .from("customer_profiles")
        .upsert(payload, { onConflict: "phone" })
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // POST /api/customer-profile/notes — save ONLY the free-form customer note,
    // keyed by phone. Unlike the full upsert above, the payload contains just
    // the notes column, so on conflict PostgREST updates only `notes` and leaves
    // birthday/address/delivery prefs intact. Used by the Calls-page notes board.
    if (req.method === "POST" && path === "customer-profile/notes") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const phone = (body?.phone || "").trim();
      if (!phone) return json({ error: "phone required" }, 400);

      const { data, error } = await adminClient
        .from("customer_profiles")
        .upsert(
          {
            phone,
            notes: body.notes ?? null,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "phone" },
        )
        .select()
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // GET /api/address/settlements?q= — type-ahead over the BG settlements
    // reference (cities + villages). Matches Cyrillic OR Latin input. Returns
    // id (Econt city id, used to fetch streets), name, post_code, region.
    if (req.method === "GET" && path === "address/settlements") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2) return json([]);
      const lc = q.toLowerCase();
      const { data } = await adminClient
        .from("bg_settlements")
        .select("id, name, name_en, post_code, region, municipality")
        .or(`name_lc.ilike.${lc}%,name_en.ilike.${lc}%`)
        .order("name", { ascending: true })
        .limit(12);
      return json(data || []);
    }

    // GET /api/address/streets?settlement_id=&q=&kind= — streets and/or
    // quarters for a settlement from Econt's nomenclature (the source couriers
    // use). kind=street | quarter | (omitted = both). Cached per settlement.
    if (req.method === "GET" && path === "address/streets") {
      const settlementId = (url.searchParams.get("settlement_id") || "").trim();
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const kind = url.searchParams.get("kind");
      if (!settlementId) return json([]);
      const { streets, quarters } = await getEcontStreetsAndQuarters(settlementId);
      const pool = kind === "quarter" ? quarters : kind === "street" ? streets : [...quarters, ...streets];
      const filtered = q ? pool.filter((s: string) => s.toLowerCase().includes(q)) : pool;
      return json(filtered.slice(0, 15));
    }

    // GET /api/customer-intelligence?phone=...
    // Returns customer history, timeline, lead quality score, and recommendations
    // ══════════════════════════════════════════════════════════════
    if (req.method === "GET" && path === "customer-intelligence") {
      const phone = (url.searchParams.get("phone") || "").trim();
      if (!phone) return json({ error: "Phone required" }, 400);
      // The intelligence dossier is customer-history + identity — hidden from roles
      // without order-history access (investor managers); agents keep it for calls.
      if (!showOrderHistory) return json({ found: false });

      // Normalize the search phone the same way the import does, then match
      // against multiple equivalent representations. Substring matching is
      // unsafe — it collapses unrelated customers who happen to share digit
      // sequences.
      const digitsOnly = phone.replace(/\D/g, "");
      if (digitsOnly.length < 7) return json({ found: false });

      // Build a small set of candidate canonical forms so we match regardless
      // of how the phone was originally stored.
      const candidates = new Set<string>();
      candidates.add(phone);                    // exactly as typed
      candidates.add(digitsOnly);               // digits only
      candidates.add("+" + digitsOnly);         // + prefix
      if (digitsOnly.length === 9) {
        candidates.add("+383" + digitsOnly);
        candidates.add("0" + digitsOnly);
      } else if (digitsOnly.length === 10 && digitsOnly.startsWith("0")) {
        candidates.add("+383" + digitsOnly.slice(1));
      } else if (digitsOnly.length === 12 && digitsOnly.startsWith("383")) {
        candidates.add("+" + digitsOnly);
        candidates.add(digitsOnly.slice(3));    // 9-digit local form
        candidates.add("0" + digitsOnly.slice(3));
      }

      const candidateList = [...candidates];

      // Find all orders matching any canonical form of this phone (exact match).
      const { data: orders } = await adminClient
        .from("orders")
        .select("id, display_id, status, price, product_name, customer_name, customer_phone, customer_city, customer_address, assigned_agent_name, created_at, source_type, order_items(id, product_name, quantity, price_per_unit, total_price)")
        .in("customer_phone", candidateList)
        .order("created_at", { ascending: false })
        .limit(100);

      // Find all prediction leads matching this phone
      const { data: leads } = await adminClient
        .from("prediction_leads")
        .select("id, name, telephone, status, product, created_at, assigned_agent_name, list_id, prediction_lists(name)")
        .in("telephone", candidateList)
        .order("created_at", { ascending: false })
        .limit(100);

      const allOrders = orders || [];
      const allLeads = leads || [];

      if (allOrders.length === 0 && allLeads.length === 0) {
        return json({ found: false });
      }

      // Stats
      const totalOrders = allOrders.length;
      const paidOrders = allOrders.filter((o: any) => o.status === "paid");
      const returnedOrders = allOrders.filter((o: any) => o.status === "returned");
      const shippedOrders = allOrders.filter((o: any) => o.status === "shipped");
      const confirmedOrders = allOrders.filter((o: any) => o.status === "confirmed");
      const lifetimeRevenue = paidOrders.reduce((sum: number, o: any) => sum + Number(o.price || 0), 0);

      // 21-day cooldown after a recent PAID order. This MUST mirror the segment
      // engine (recompute_customer_segments, hotfix 2026-06-03), which anchors the
      // cooldown on the ORDER DATE (created_at) of the customer's most recent PAID
      // order — NOT updated_at. updated_at is bumped by ANY later edit (re-save,
      // a segment recompute, an address change), which wrongly kept long-past
      // customers "in cooldown" even though the segment engine had already let
      // them out. paidOrders comes from allOrders (ordered created_at DESC), so
      // paidOrders[0] is the most recent paid order.
      let cooldownInfo = null;
      const lastPaidForCooldown = paidOrders[0];
      if (lastPaidForCooldown?.created_at) {
        const cooldownUntil = new Date(new Date(lastPaidForCooldown.created_at).getTime() + 21 * 24 * 60 * 60 * 1000);
        if (cooldownUntil > new Date()) {
          cooldownInfo = {
            is_in_cooldown: true,
            until: cooldownUntil.toISOString(),
            reason: "paid",
          };
        }
      }

      const lastOrder = allOrders[0] || null;

      // Timeline: build chronological events
      const orderIds = allOrders.map((o: any) => o.id);
      let historyData: any[] = [];
      if (orderIds.length > 0) {
        const { data: history } = await adminClient
          .from("order_history")
          .select("*")
          .in("order_id", orderIds)
          .order("changed_at", { ascending: false })
          .limit(200);
        historyData = history || [];
      }

      // Build timeline events
      const timeline: any[] = [];
      
      // Lead created events
      for (const l of allLeads) {
        timeline.push({
          type: "lead_created",
          date: l.created_at,
          agent: l.assigned_agent_name || null,
          details: `Lead created in ${(l as any).prediction_lists?.name || "list"}`,
        });
      }

      // Order events from history
      for (const h of historyData) {
        const order = allOrders.find((o: any) => o.id === h.order_id);
        timeline.push({
          type: `status_${h.to_status}`,
          date: h.changed_at,
          agent: h.changed_by_name || null,
          details: h.from_status 
            ? `${order?.display_id || ""}: ${h.from_status} → ${h.to_status}`
            : `${order?.display_id || ""}: ${h.to_status}`,
          from_status: h.from_status,
          to_status: h.to_status,
          order_display_id: order?.display_id,
        });
      }

      // Sort newest first
      timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Lead quality score
      let qualityScore = "MEDIUM";
      let qualityReason = "";
      if (paidOrders.length >= 2 && returnedOrders.length === 0) {
        qualityScore = "HIGH";
        qualityReason = `${paidOrders.length} paid orders, no returns`;
      } else if (paidOrders.length >= 1 && returnedOrders.length === 0) {
        qualityScore = "HIGH";
        qualityReason = `${paidOrders.length} paid order(s), no returns`;
      } else if (returnedOrders.length > paidOrders.length) {
        qualityScore = "RISK";
        qualityReason = `${returnedOrders.length} returns vs ${paidOrders.length} paid`;
      } else if (returnedOrders.length > 0 && paidOrders.length > 0) {
        qualityScore = "MEDIUM";
        qualityReason = `${paidOrders.length} paid, ${returnedOrders.length} returned`;
      } else if (totalOrders === 0 && allLeads.length > 0) {
        qualityScore = "MEDIUM";
        qualityReason = "New lead, no order history";
      } else if (totalOrders > 0 && paidOrders.length === 0 && returnedOrders.length === 0) {
        qualityScore = "MEDIUM";
        qualityReason = `${totalOrders} orders, none paid yet`;
      }

      // Product recommendations: find frequently co-purchased products
      const productPairs: Record<string, number> = {};
      const currentProducts = new Set<string>();
      // Get product IDs from all order items
      for (const o of allOrders) {
        const items = o.order_items || [];
        for (const item of items) {
          if (item.product_name) currentProducts.add(item.product_name);
        }
      }

      // Find products often bought together across ALL orders
      const { data: coPurchaseOrders } = await adminClient
        .from("order_items")
        .select("order_id, product_id, product_name")
        .in("order_id", 
          // Get order_ids that contain any of the current products  
          allOrders.filter((o: any) => o.order_items?.length > 0).map((o: any) => o.id)
        )
        .limit(500);

      // Group by order to find co-purchased products
      const orderProductMap: Record<string, string[]> = {};
      for (const item of (coPurchaseOrders || [])) {
        if (!orderProductMap[item.order_id]) orderProductMap[item.order_id] = [];
        orderProductMap[item.order_id].push(item.product_name);
      }

      // Find products that appear in multi-product orders
      // Instead, query globally for popular add-ons
      const { data: popularProducts } = await adminClient
        .from("order_items")
        .select("product_id, product_name")
        .not("product_id", "is", null)
        .limit(1000);

      // Count product frequency
      const productFreq: Record<string, { name: string; id: string; count: number }> = {};
      for (const p of (popularProducts || [])) {
        if (!p.product_id) continue;
        if (!productFreq[p.product_id]) productFreq[p.product_id] = { name: p.product_name, id: p.product_id, count: 0 };
        productFreq[p.product_id].count++;
      }
      const recommendations = Object.values(productFreq)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(p => ({ product_id: p.id, product_name: p.name, frequency: p.count }));

      // Past orders list — every paid order with line items and totals so
      // the OrderModal can show what the customer actually bought, not just
      // the count.
      const ordersHistory = allOrders.map((o: any) => ({
        id: o.id,
        display_id: o.display_id,
        status: o.status,
        date: o.created_at,
        agent: o.assigned_agent_name,
        price: Number(o.price || 0),
        items: (o.order_items || []).map((i: any) => ({
          product_name: i.product_name,
          quantity: i.quantity,
          price_per_unit: Number(i.price_per_unit || 0),
          total_price: Number(i.total_price || 0),
        })),
        // Cheap fallback when the order has no order_items rows (legacy
        // single-product layout).
        product_name_fallback: o.product_name,
      }));

      return json({
        found: true,
        stats: {
          total_orders: totalOrders,
          paid_orders: paidOrders.length,
          returned_orders: returnedOrders.length,
          shipped_orders: shippedOrders.length,
          confirmed_orders: confirmedOrders.length,
          lifetime_revenue: lifetimeRevenue,
          total_leads: allLeads.length,
        },
        last_order: lastOrder ? {
          display_id: lastOrder.display_id,
          product: lastOrder.order_items?.length > 0
            ? lastOrder.order_items.map((i: any) => i.product_name).join(", ")
            : lastOrder.product_name,
          status: lastOrder.status,
          date: lastOrder.created_at,
          agent: lastOrder.assigned_agent_name,
          price: lastOrder.price,
        } : null,
        orders_history: ordersHistory,
        quality_score: qualityScore,
        quality_reason: qualityReason,
        timeline: timeline.slice(0, 50),
        recommendations,
        customer_name: allOrders[0]?.customer_name || allLeads[0]?.name || "",
        cooldown: cooldownInfo,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // GET /api/cooldown-clients
    // Admin only: list phones currently blocked by the 21-day global cooldown
    // (recent paid/confirmed/shipped/cancelled). Used by the "Cooldown Clients" button
    // in Prediction Lists UI.
    // ══════════════════════════════════════════════════════════════
    if (req.method === "GET" && path === "cooldown-clients") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      // Cooldown = 21 days after the ORDER DATE (created_at) of a customer's most
      // recent PAID order — mirrors recompute_customer_segments (hotfix 2026-06-03)
      // and the per-customer banner. Anchored on created_at, NOT updated_at, so a
      // later edit to an old order can't re-arm the cooldown.
      const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();

      // Paid orders placed in the last 21 days, newest first.
      const { data: recent } = await adminClient
        .from("orders")
        .select("customer_phone, created_at")
        .eq("status", "paid")
        .gte("created_at", since)
        .order("created_at", { ascending: false });

      // First occurrence per phone = that customer's most recent paid order.
      const seen = new Map<string, string>();
      for (const r of recent || []) {
        if (r.customer_phone && !seen.has(r.customer_phone)) seen.set(r.customer_phone, r.created_at);
      }
      const result = Array.from(seen.entries()).slice(0, 500).map(([phone, created_at]) => ({
        phone,
        last_status: "paid",
        last_at: created_at,
        cooldown_until: new Date(new Date(created_at).getTime() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      return json({ clients: result, total: result.length });
    }

    // ══════════════════════════════════════════════════════════════
    // GET /api/management-insights
    // Admin/Manager only analytics
    // ══════════════════════════════════════════════════════════════
    if (req.method === "GET" && path === "management-insights") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const toEnd = to ? to + "T23:59:59" : "";
      // Margin Lab: net-profit-per-package target the floor prices must clear (operator-tunable, €7 default).
      const marginTarget = Math.max(0, Number(url.searchParams.get("target")) || 7);

      // Paginate past PostgREST's ~1000-row cap so every figure reflects ALL
      // matching rows, not the first page. (Same pattern as dashboard-stats.)
      const paginate = async (makeQuery: () => any, pageSize = 1000): Promise<any[]> => {
        const all: any[] = [];
        for (let f = 0; ; f += pageSize) {
          const { data, error } = await makeQuery().range(f, f + pageSize - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < pageSize) break;
        }
        return all;
      };

      // Merge operator-name variants ("Елена Т." / "Елена Т" → "Елена"); blank → Unknown.
      const normAgent = (raw: any): string => {
        let n = String(raw || "").trim().replace(/\s+/g, " ");
        if (!n) return "Unknown operator";
        n = n.replace(/\s+\p{L}\.?$/u, "").trim(); // strip a trailing single-letter initial
        return n || "Unknown operator";
      };

      // top-N with an "Others" rollup to bound payload size.
      const topN = (rows: any[], valueKey: string, label: string, n = 20) => {
        const sorted = [...rows].sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0));
        if (sorted.length <= n) return sorted;
        const head = sorted.slice(0, n);
        const rest = sorted.slice(n);
        const others: any = { [label]: "Others" };
        for (const r of rest) for (const k of Object.keys(r)) {
          if (k === label) continue;
          if (typeof r[k] === "number") others[k] = (others[k] || 0) + r[k];
        }
        return [...head, others];
      };

      // ── Fetch (paginated where it matters) ──
      const orders = await paginate(() => {
        let q = adminClient.from("orders").select(
          "id,status,price,quantity,product_name,customer_city,courier_office_city,delivery_type,home_courier,assigned_agent_name,confirmed_by_name,cancelled_by_agent_id,source_type,created_at,cancellation_reason,return_reason,prediction_list_id,prediction_list_name,prediction_list_type,prediction_list_category,order_items(product_name,quantity,total_price,price_per_unit)"
        ).or("source_type.is.null,source_type.neq.monadon_legacy"); // exclude Monadon legacy from all insights (profit, payouts, predictions ROI)
        if (from) q = q.gte("created_at", from);
        if (toEnd) q = q.lte("created_at", toEnd);
        return q;
      });
      const products = await paginate(() => adminClient.from("products").select("id,name,stock_quantity,low_stock_threshold,cost_price,price,is_active"));
      const callLogs = await paginate(() => {
        let q = adminClient.from("call_logs").select("agent_id,outcome,connection_state,talk_seconds,total_seconds,started_at,created_at");
        if (from) q = q.gte("created_at", from);
        if (toEnd) q = q.lte("created_at", toEnd);
        return q;
      });
      const invLogs = await paginate(() => {
        let q = adminClient.from("inventory_logs").select("reason,change_amount,created_at");
        if (from) q = q.gte("created_at", from);
        if (toEnd) q = q.lte("created_at", toEnd);
        return q;
      });
      const profiles = await paginate(() => adminClient.from("profiles").select("user_id,full_name"));
      const nameById: Record<string, string> = {};
      for (const p of profiles) nameById[p.user_id] = p.full_name;

      // Who is a real AGENT (vs super-admin)? Commission is paid only to agents,
      // so a super-admin-confirmed order costs the business nothing in bonus.
      // A super-admin = anyone with admin OR manager role, and they earn €0 EVEN
      // IF they also hold an agent role (e.g. Miki, a founder who also confirms).
      const { data: roleRowsForPay } = await adminClient
        .from("user_roles").select("user_id, role")
        .in("role", ["agent", "pending_agent", "prediction_agent", "admin", "manager"]);
      const agentUserIds = new Set<string>();
      const superAdminIds = new Set<string>();
      for (const r of roleRowsForPay || []) {
        if (r.role === "admin" || r.role === "manager") superAdminIds.add(r.user_id);
        else agentUserIds.add(r.user_id);
      }
      const agentNames = new Set<string>();
      for (const p of profiles) {
        if (agentUserIds.has(p.user_id) && !superAdminIds.has(p.user_id)) agentNames.add(normAgent(p.full_name));
      }

      // Editable courier rate card (deliver / round-trip return per courier+service).
      const { rates: courierRates, fallback: courierFallback } = await loadCourierRates(adminClient);

      // Prediction-list payout is now attribution-gated (prediction_list_id on the
      // order), so management-insights no longer needs the special-agent role list.

      const PAID = (o: any) => o.status === "paid";
      // A "real order" = a lead that became an actual sale. Pending leads,
      // no-answer/call-again and cancelled/trashed rows are NOT orders.
      const REAL_ORDER = (o: any) => REAL_ORDER_STATUSES.includes(o.status);
      // "Sold" = a real order that hasn't come back. This — not just paid — is
      // what drives revenue/AOV/products/cities, because this is a COD business:
      // orders are confirmed & shipped today and paid days later, so a paid-only
      // view of "today" is always empty. Returned orders drop out of revenue.
      const SOLD = (o: any) => o.status === "confirmed" || o.status === "shipped" || o.status === "delivered" || o.status === "paid";
      // Attribute an order to whoever CONFIRMED it (stable across shipping),
      // falling back to the assigned agent for legacy rows without a confirmer.
      const ownerOf = (o: any) => normAgent(o.confirmed_by_name ?? o.assigned_agent_name);
      const num = (x: any) => Number(x || 0);
      const unitsOf = (o: any) => {
        const items = o.order_items || [];
        return items.length ? items.reduce((s: number, i: any) => s + num(i.quantity), 0) : num(o.quantity) || 1;
      };

      // === Pure Profit: Agent commission (per-package, every paid order) ===
      // Per operator spec (2026-06-04, clarified): per-package bonus on every PAID
      // order, tiered <25€→1 / 25–35€→2 / ≥35€→3, every package earns, no minimum,
      // no source/role gate. Uses the shared module-level calcAgentBonus so this
      // number can never diverge from /api/agent-performance. See elyon-agent-commissions.

      // ── Overview ──
      let paidRevenue = 0, paidCount = 0, unitsSold = 0, returnsValue = 0, pipelineValue = 0;
      let soldRevenue = 0, soldCount = 0; // revenue/AOV are sold-based (see SOLD above)
      const statusDist: Record<string, any> = {};
      const cityMap: Record<string, any> = {};
      const deliveryMap: Record<string, any> = {};
      const sourceMap: Record<string, any> = {};
      const prodMap: Record<string, any> = {};
      const agMap: Record<string, any> = {};
      const retReason: Record<string, any> = {};
      const retProduct: Record<string, any> = {};
      const retCity: Record<string, any> = {};
      const canReason: Record<string, any> = {};
      const canProduct: Record<string, any> = {};
      const trend: Record<string, any> = {};

      // Agent buckets exist only for meaningful outcomes: a real order
      // (credited to its confirmer), a cancellation (credited to whoever
      // cancelled), or a trash. Pending/take/call_again leads never create a
      // row, so unassigned pendings stop polluting the agents table.
      const bucket = (name: string) =>
        (agMap[name] ??= { name, orders: 0, sold: 0, paid: 0, returned: 0, cancelled: 0, trashed: 0, revenue: 0, units: 0 });

      // Choose trend granularity from the data span. (Reduce, not Math.min(...spread),
      // which would overflow the call stack on large arrays.)
      let minT = Infinity, maxT = -Infinity;
      for (const o of orders) {
        const t = new Date(o.created_at).getTime();
        if (isNaN(t)) continue;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
      if (!isFinite(minT)) { minT = Date.now(); maxT = Date.now(); }
      const spanDays = Math.max(1, (maxT - minT) / 86400000);
      const granularity = spanDays <= 92 ? "day" : spanDays <= 400 ? "week" : "month";
      const bucketKey = (d: Date) => {
        if (granularity === "day") return d.toISOString().slice(0, 10);
        if (granularity === "month") return d.toISOString().slice(0, 7);
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() - day + 1);
        return t.toISOString().slice(0, 10);
      };

      for (const o of orders) {
        const s = o.status || "(none)";
        statusDist[s] ??= { status: s, count: 0, value: 0 };
        statusDist[s].count++; statusDist[s].value += num(o.price);

        const items = o.order_items || [];

        if (REAL_ORDER(o)) {
          const a = bucket(ownerOf(o));
          a.orders++;
          if (PAID(o)) a.paid++;
          if (o.status === "returned") a.returned++;
          if (SOLD(o)) { a.sold++; a.revenue += num(o.price); a.units += unitsOf(o); }   // revenue + packages (units) of orders sold
        }

        if (PAID(o)) {
          paidRevenue += num(o.price);
          paidCount++;
        }  // cash actually collected

        if (SOLD(o)) {
          soldRevenue += num(o.price); soldCount++; unitsSold += unitsOf(o);

          // trend (sold revenue over time)
          const bk = bucketKey(new Date(o.created_at));
          trend[bk] ??= { bucket: bk, revenue: 0, orders: 0 };
          trend[bk].revenue += num(o.price); trend[bk].orders++;

          // city / delivery / source (sold)
          const city = (o.customer_city || o.courier_office_city || "").trim() || "Unknown";
          cityMap[city] ??= { city, orders: 0, revenue: 0 };
          cityMap[city].orders++; cityMap[city].revenue += num(o.price);
          const dt = o.delivery_type || "home";
          deliveryMap[dt] ??= { delivery: dt, orders: 0, revenue: 0 };
          deliveryMap[dt].orders++; deliveryMap[dt].revenue += num(o.price);
          const src = o.source_type || "manual";
          sourceMap[src] ??= { source: src, orders: 0, revenue: 0 };
          sourceMap[src].orders++; sourceMap[src].revenue += num(o.price);

          // products (sold)
          if (items.length) {
            const seen = new Set();
            for (const it of items) {
              const p = it.product_name || "(unknown)";
              prodMap[p] ??= { product: p, units: 0, revenue: 0, orders: 0 };
              prodMap[p].units += num(it.quantity); prodMap[p].revenue += num(it.total_price);
              if (!seen.has(p)) { prodMap[p].orders++; seen.add(p); }
            }
          } else if (o.product_name) {
            const p = o.product_name;
            prodMap[p] ??= { product: p, units: 0, revenue: 0, orders: 0 };
            prodMap[p].units += num(o.quantity) || 1; prodMap[p].revenue += num(o.price); prodMap[p].orders++;
          }
        }

        if (o.status === "returned") {
          returnsValue += num(o.price);
          const rr = o.return_reason || "(unspecified)";
          retReason[rr] ??= { reason: rr, count: 0 }; retReason[rr].count++;
          const city = (o.customer_city || o.courier_office_city || "").trim() || "Unknown";
          retCity[city] ??= { city, count: 0 }; retCity[city].count++;
          const pns = items.length ? items.map((i: any) => i.product_name) : [o.product_name || "(unknown)"];
          for (const pn of pns) { retProduct[pn] ??= { product: pn, count: 0 }; retProduct[pn].count++; }
        }

        if (o.status === "cancelled") {
          // Credit whoever actually cancelled; fall back to confirmer/assigned
          // for legacy rows that predate cancelled_by_agent_id.
          const canceller = normAgent(nameById[o.cancelled_by_agent_id] ?? o.confirmed_by_name ?? o.assigned_agent_name);
          bucket(canceller).cancelled++;
          const cr = o.cancellation_reason || "(unspecified)";
          canReason[cr] ??= { reason: cr, count: 0 }; canReason[cr].count++;
          const pns = items.length ? items.map((i: any) => i.product_name) : [o.product_name || "(unknown)"];
          for (const pn of pns) { canProduct[pn] ??= { product: pn, count: 0 }; canProduct[pn].count++; }
        }

        if (o.status === "trashed") bucket(ownerOf(o)).trashed++;

        if (["confirmed", "shipped", "delivered"].includes(o.status)) pipelineValue += num(o.price);
      }

      const returnedCount = statusDist["returned"]?.count || 0;
      const cancelledCount = statusDist["cancelled"]?.count || 0;
      const trashedCount = statusDist["trashed"]?.count || 0;
      const leadsPending = statusDist["pending"]?.count || 0;
      const realOrdersCount = orders.filter(REAL_ORDER).length; // actual orders, not leads/cancels

      // Per-agent derived rates + merge call stats.
      const callByAgentName: Record<string, any> = {};
      let callsTotal = 0, callsAnswered = 0, talkTotal = 0;
      const byOutcome: Record<string, number> = {};
      for (const c of callLogs) {
        callsTotal++;
        const answered = c.connection_state === "answered" || (c.connection_state == null && num(c.talk_seconds) > 0);
        if (answered) callsAnswered++;
        talkTotal += num(c.talk_seconds);
        byOutcome[c.outcome || "(none)"] = (byOutcome[c.outcome || "(none)"] || 0) + 1;
        const an = normAgent(nameById[c.agent_id]);
        callByAgentName[an] ??= { calls: 0, answered: 0, talk_seconds: 0 };
        callByAgentName[an].calls++; if (answered) callByAgentName[an].answered++; callByAgentName[an].talk_seconds += num(c.talk_seconds);
      }

      const perAgent = Object.values(agMap).map((a: any) => {
        const cs = callByAgentName[a.name] || { calls: 0, answered: 0, talk_seconds: 0 };

        // Per-package payout on this agent's owned paid orders (every paid order).
        const agentOrdersForPayout = orders.filter(
          (o: any) => PAID(o) && REAL_ORDER(o) && normAgent(ownerOf(o)) === a.name,
        );
        // Super-admins earn no bonus — only real agents are on commission.
        const agentPayout = agentNames.has(a.name) ? calcAgentBonus(agentOrdersForPayout) : 0;

        return {
          ...a,
          aov: a.sold > 0 ? a.revenue / a.sold : 0,
          // Packages (units) sold + average revenue per package.
          avg_per_package: a.units > 0 ? a.revenue / a.units : 0,
          // Of the decisions this agent reached (orders vs. cancels), what share cancelled.
          cancel_rate: (a.orders + a.cancelled) > 0 ? a.cancelled / (a.orders + a.cancelled) : 0,
          // Of this agent's orders, what share came back.
          return_rate: a.orders > 0 ? a.returned / a.orders : 0,
          calls: cs.calls, answered: cs.answered,
          answer_rate: cs.calls > 0 ? cs.answered / cs.calls : 0,
          talk_seconds: cs.talk_seconds,
          // New: Payout earned by this agent (only for special roles)
          payout_earned: agentPayout,
        };
      }).sort((a: any, b: any) => b.revenue - a.revenue);

      // Total agent commission actually owed (a Pure Profit cost): every paid
      // order, but only those owned by a real agent — super-admins earn nothing.
      const totalSpecialAgentCommissions = Math.round(
        orders.reduce((s: number, o: any) => s + (agentNames.has(ownerOf(o)) ? orderPackageBonus(o) : 0), 0) * 100,
      ) / 100;

      // ── Prediction Lists ROI ──
      // "Which list generated how much money." Order-derived metrics come from the
      // attribution snapshot (prediction_list_id), so they are exact and survive a
      // list being renamed/deleted (we group by the snapshot name). Membership is
      // enriched from the live segment/lead tables. Returned = refund (this is a
      // COD business — a returned order is money that came back).
      const plMap: Record<string, any> = {};
      const plRow = (id: string, name: string, type: string | null, category: string | null) =>
        (plMap[id] ??= {
          list_id: id, name: name || "(unnamed list)", type: type || "segment", category: category || null,
          orders: 0, confirmed: 0, paid: 0, returned: 0, cancelled: 0,
          revenue: 0, refund_value: 0, bonus_paid: 0, members: 0,
        });
      for (const o of orders) {
        if (!o.prediction_list_id) continue;
        const r = plRow(o.prediction_list_id, o.prediction_list_name, o.prediction_list_type, o.prediction_list_category);
        r.orders++;
        if (REAL_ORDER(o)) r.confirmed++;
        if (PAID(o)) r.paid++;
        if (o.status === "returned") { r.returned++; r.refund_value += num(o.price); }
        if (o.status === "cancelled") r.cancelled++;
        if (SOLD(o)) r.revenue += num(o.price);
        if (agentNames.has(ownerOf(o))) r.bonus_paid += orderPackageBonus(o);
      }
      // Enrich with current membership counts (segment members + uploaded leads).
      const memberCounts: Record<string, number> = {};
      try {
        const segMembers = await paginate(() =>
          adminClient.from("prediction_segment_members").select("list_id"));
        for (const m of segMembers) memberCounts[m.list_id] = (memberCounts[m.list_id] || 0) + 1;
        const leadRows = await paginate(() =>
          adminClient.from("prediction_leads").select("list_id"));
        for (const l of leadRows) if (l.list_id) memberCounts[l.list_id] = (memberCounts[l.list_id] || 0) + 1;
      } catch (_e) { /* membership enrichment is best-effort */ }
      const predictionLists = Object.values(plMap).map((r: any) => ({
        ...r,
        members: memberCounts[r.list_id] || 0,
        net_revenue: Math.round((r.revenue - r.refund_value) * 100) / 100,
        revenue: Math.round(r.revenue * 100) / 100,
        refund_value: Math.round(r.refund_value * 100) / 100,
        bonus_paid: Math.round(r.bonus_paid * 100) / 100,
        conversion_rate: r.orders > 0 ? r.paid / r.orders : 0,
        return_rate: r.confirmed > 0 ? r.returned / r.confirmed : 0,
      })).sort((a: any, b: any) => b.revenue - a.revenue);

      // ── Products & stock ──
      const stock = products.filter((p: any) => p.is_active).map((p: any) => {
        const sold = prodMap[p.name]?.units || 0;
        const sq = num(p.stock_quantity);
        const state = sq <= 0 ? "out" : sq <= num(p.low_stock_threshold) ? "low" : "ok";
        const daily = sold / spanDays;
        return {
          name: p.name, stock_quantity: sq, low_stock_threshold: num(p.low_stock_threshold),
          state, units_sold: sold,
          days_of_cover: daily > 0 ? Math.round(sq / daily) : null,
          cost_price: num(p.cost_price), price: num(p.price),
        };
      }).sort((a: any, b: any) => a.stock_quantity - b.stock_quantity);

      // ── Profit (only where cost is known) ──
      const costByName: Record<string, number> = {};
      for (const p of products) if (num(p.cost_price) > 0) costByName[p.name] = num(p.cost_price);
      const profitRows = Object.values(prodMap)
        .filter((p: any) => costByName[p.product] != null)
        .map((p: any) => {
          const cogs = costByName[p.product] * p.units;
          return { product: p.product, revenue: p.revenue, cogs, profit: p.revenue - cogs, margin: p.revenue > 0 ? (p.revenue - cogs) / p.revenue : 0 };
        }).sort((a: any, b: any) => b.profit - a.profit);

      // ── Logistics cost + actuals Pure Profit ──
      // Money OUT for shipping: deliver rate on everything shipped, full round-trip
      // loss on every return. COGS is booked on PAID orders only (returned stock
      // comes back to inventory, so only the shipping is lost). Revenue = cash
      // actually collected (paidRevenue). Also split spend by courier so the
      // operator can see "which orders went by what".
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const costOfName = (_pid: any, name: any) => costByName[name] || 0;
      let deliveryCost = 0, returnLoss = 0, cogsPaid = 0, paidPackages = 0;
      const logisticsMap: Record<string, any> = {};
      // Margin Lab: realized price of every paid package (for distribution stats).
      const realizedPkg: number[] = [];
      // Per-product breakdown on the PAID (cash) basis, so the COGS column sums
      // to pure_profit.cogs. Tracks packages (units), distinct orders, revenue & cost.
      // deliverSum accumulates each line's amortized delivery share (Margin Lab floor).
      const paidProdMap: Record<string, any> = {};
      const addPaidProduct = (orderId: string, name: string, qty: number, revenue: number, deliverShare = 0) => {
        const m = (paidProdMap[name] ??= { product: name, packages: 0, orders: 0, revenue: 0, cogs: 0, deliverSum: 0, _seen: new Set<string>() });
        m.packages += qty;
        m.revenue += revenue;
        m.cogs += (costByName[name] || 0) * qty;
        m.deliverSum += deliverShare * qty;
        if (!m._seen.has(orderId)) { m.orders++; m._seen.add(orderId); }
      };
      for (const o of orders) {
        const st = o.status;
        const shipped = st === "shipped" || st === "delivered" || st === "paid";
        const returned = st === "returned";
        if (shipped || returned) {
          const cs = resolveCourierService(o);
          const rate = (cs && courierRates[`${cs.courier}_${cs.service}`]) || courierFallback;
          const label = cs ? `${cs.courier}_${cs.service}` : "unknown";
          const L = (logisticsMap[label] ??= {
            courier: cs?.courier ?? "unknown", service: cs?.service ?? "—",
            delivered: 0, returned: 0, deliver_cost: 0, return_cost: 0,
          });
          if (returned) { returnLoss += rate.return_; L.returned++; L.return_cost += rate.return_; }
          else { deliveryCost += rate.deliver; L.delivered++; L.deliver_cost += rate.deliver; }
        }
        if (PAID(o)) {
          cogsPaid += orderCOGS(o, costOfName);
          const items = o.order_items || [];
          const price = num(o.price); // orders.price is the cash source of truth
          // One delivery is paid per ORDER, so amortize it across the order's packages
          // (Margin Lab: bigger bundle ⇒ smaller per-package delivery ⇒ lower floor).
          const csP = resolveCourierService(o);
          const deliverRateP = (csP && courierRates[`${csP.courier}_${csP.service}`]?.deliver) ?? courierFallback.deliver;
          if (items.length) {
            // Distribute the order's locked price across its items by the best
            // available price signal (item totals are often 0 on these rows),
            // so Σ per-product revenue == cash collected.
            const w = items.map((it: any) => {
              const ppu = num(it.price_per_unit), tp = num(it.total_price), q = num(it.quantity) || 1;
              return ppu > 0 ? ppu * q : tp > 0 ? tp : q;
            });
            const tot = w.reduce((s: number, x: number) => s + x, 0) || 1;
            const orderPkgs = items.reduce((s: number, it: any) => s + num(it.quantity), 0) || 1;
            const deliverShare = deliverRateP / orderPkgs;
            items.forEach((it: any, i: number) => {
              const q = num(it.quantity);
              paidPackages += q;
              const lineRev = price * (w[i] / tot);
              addPaidProduct(o.id, it.product_name || "(unknown)", q, lineRev, deliverShare);
              const unit = q > 0 ? lineRev / q : 0;
              for (let k = 0; k < q; k++) realizedPkg.push(unit);
            });
          } else if (o.product_name) {
            const q = num(o.quantity) || 1;
            paidPackages += q;
            addPaidProduct(o.id, o.product_name, q, price, deliverRateP / q);
            const unit = q > 0 ? price / q : 0;
            for (let k = 0; k < q; k++) realizedPkg.push(unit);
          }
        }
      }
      deliveryCost = r2(deliveryCost); returnLoss = r2(returnLoss); cogsPaid = r2(cogsPaid);
      // VAT owed on collected cash (prices are gross / VAT-inclusive).
      const vatDue = r2(paidRevenue - paidRevenue / (1 + VAT_RATE));
      const clearProfit = r2(paidRevenue - vatDue - cogsPaid - totalSpecialAgentCommissions - deliveryCost - returnLoss);
      // Cost coverage: how much of what sold has a known cost_price. Products
      // without one count €0 COGS (never invent a cost) — surface the gap instead.
      let knownCostPackages = 0;
      const productsMissingCost: string[] = [];
      for (const m of Object.values(paidProdMap) as any[]) {
        if (costByName[m.product] != null) knownCostPackages += m.packages;
        else productsMissingCost.push(m.product);
      }
      productsMissingCost.sort();
      const costCoverage = paidPackages > 0 ? Math.round((knownCostPackages / paidPackages) * 10000) / 10000 : 1;
      const logistics = Object.values(logisticsMap).map((L: any) => ({
        ...L, deliver_cost: r2(L.deliver_cost), return_cost: r2(L.return_cost),
        total_cost: r2(L.deliver_cost + L.return_cost),
      })).sort((a: any, b: any) => b.total_cost - a.total_cost);
      const pureProfitByProduct = Object.values(paidProdMap).map((m: any) => ({
        product: m.product,
        packages: m.packages,
        orders: m.orders,
        unit_cost: m.packages > 0 ? r2(m.cogs / m.packages) : 0,
        unit_price: m.packages > 0 ? r2(m.revenue / m.packages) : 0,
        cogs: r2(m.cogs),
        revenue: r2(m.revenue),
        profit: r2(m.revenue - m.cogs),
        net_revenue: r2(m.revenue / (1 + VAT_RATE)),
        net_profit: r2(m.revenue / (1 + VAT_RATE) - m.cogs),
      })).sort((a: any, b: any) => b.packages - a.packages);

      // ── Margin Lab: realized per-package price + the floor each product needs ──
      // Floor solves  P − P/6 − cogs − deliver − commission = target  ⇒  P = 1.2·(target+cogs+deliver+m),
      // picking the commission tier m (1/2/3 €) consistent with the resulting price.
      const GROSS = 1 + VAT_RATE;
      const floorPriceFor = (cogs: number, deliver: number, target: number): number => {
        for (const m of [1, 2, 3]) { const P = GROSS * (target + cogs + deliver + m); if (packageBonusRate(P) === m) return r2(P); }
        return r2(GROSS * (target + cogs + deliver + 3));
      };
      const sortedPkg = realizedPkg.slice().sort((a, b) => a - b);
      const pctl = (p: number) => (sortedPkg.length ? sortedPkg[Math.min(sortedPkg.length - 1, Math.max(0, Math.round((p / 100) * (sortedPkg.length - 1))))] : 0);
      const marginByProduct = (Object.values(paidProdMap) as any[]).map((m) => {
        const pkgs = m.packages;
        const avgPrice = pkgs > 0 ? m.revenue / pkgs : 0;
        const known = costByName[m.product] != null;
        const cogsUnit = known ? costByName[m.product] : 0;
        const avgDeliver = pkgs > 0 ? m.deliverSum / pkgs : 0;
        const commNow = packageBonusRate(avgPrice);
        const netNow = avgPrice - avgPrice / GROSS * VAT_RATE - cogsUnit - avgDeliver - commNow;
        return {
          product: m.product, packages: pkgs, cost_known: known, cogs_unit: r2(cogsUnit),
          avg_realized_price: r2(avgPrice), avg_delivery_share: r2(avgDeliver),
          net_profit_per_pkg: r2(netNow), clears_target: netNow >= marginTarget,
          floor_price: floorPriceFor(cogsUnit, avgDeliver, marginTarget),
          uplift_pct: avgPrice > 0 ? Math.round((floorPriceFor(cogsUnit, avgDeliver, marginTarget) / avgPrice - 1) * 100) : null,
        };
      }).sort((a, b) => b.packages - a.packages);
      const marginLab = {
        target_profit_per_package: marginTarget,
        vat_rate: VAT_RATE,
        blended_deliver_cost: courierFallback.deliver,        // simulator default delivery/order
        commission_tiers: [{ max: 25, bonus: 1 }, { max: 35, bonus: 2 }, { max: null, bonus: 3 }],
        realized: {
          packages: paidPackages,
          avg: paidPackages > 0 ? r2(paidRevenue / paidPackages) : 0,
          median: r2(pctl(50)), p25: r2(pctl(25)), p75: r2(pctl(75)),
          min: r2(sortedPkg[0] || 0), max: r2(sortedPkg[sortedPkg.length - 1] || 0),
          net_profit_per_pkg: paidPackages > 0 ? r2(clearProfit / paidPackages) : 0,
        },
        by_product: marginByProduct,
      };

      // ── Inventory movement summary ──
      const movement: Record<string, number> = {};
      for (const l of invLogs) movement[l.reason || "manual"] = (movement[l.reason || "manual"] || 0) + Math.abs(num(l.change_amount));

      const topSellers = Object.values(prodMap).sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 20);

      return json({
        meta: { from, to, granularity, generated_at: new Date().toISOString() },
        overview: {
          revenue: soldRevenue,        // value of orders sold (confirmed → paid), not yet-returned
          paid_revenue: paidRevenue,   // cash actually collected
          orders_total: realOrdersCount,
          sold_count: soldCount,
          paid_count: paidCount,
          aov: soldCount > 0 ? soldRevenue / soldCount : 0,
          units_sold: unitsSold,
          // Returns ÷ all orders; cancels ÷ (orders + cancels) — orders and
          // cancels are separate buckets, never mixed.
          return_rate: realOrdersCount > 0 ? returnedCount / realOrdersCount : 0,
          cancel_rate: (realOrdersCount + cancelledCount) > 0 ? cancelledCount / (realOrdersCount + cancelledCount) : 0,
          returns_value: returnsValue,
          pipeline_value: pipelineValue,
          returned_count: returnedCount,
          cancelled_count: cancelledCount,
          trashed_count: trashedCount,
          leads_pending: leadsPending,
        },
        status_distribution: Object.values(statusDist).sort((a: any, b: any) => b.count - a.count),
        revenue_trend: Object.values(trend).sort((a: any, b: any) => a.bucket.localeCompare(b.bucket)),
        sales: {
          by_product: topN(Object.values(prodMap), "revenue", "product"),
          by_city: topN(Object.values(cityMap), "revenue", "city"),
          by_delivery: Object.values(deliveryMap).sort((a: any, b: any) => b.revenue - a.revenue),
          by_source: Object.values(sourceMap).sort((a: any, b: any) => b.revenue - a.revenue),
        },
        agents: perAgent,
        products_stock: {
          top_sellers: topSellers,
          stock,
          low_stock: stock.filter((s: any) => s.state === "low"),
          out_of_stock: stock.filter((s: any) => s.state === "out"),
          movement,
        },
        returns: {
          rate: realOrdersCount > 0 ? returnedCount / realOrdersCount : 0,
          value_lost: returnsValue,
          by_reason: Object.values(retReason).sort((a: any, b: any) => b.count - a.count),
          by_product: topN(Object.values(retProduct), "count", "product"),
          by_city: topN(Object.values(retCity), "count", "city"),
        },
        cancellations: {
          total: cancelledCount,
          trashed: trashedCount,
          by_reason: Object.values(canReason).sort((a: any, b: any) => b.count - a.count),
          by_product: topN(Object.values(canProduct), "count", "product"),
        },
        calls: {
          total: callsTotal,
          answered: callsAnswered,
          answer_rate: callsTotal > 0 ? callsAnswered / callsTotal : 0,
          talk_seconds: talkTotal,
          by_outcome: Object.entries(byOutcome).map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
          per_agent: perAgent.filter((a: any) => a.calls > 0).map((a: any) => ({ name: a.name, calls: a.calls, answered: a.answered, answer_rate: a.answer_rate, talk_seconds: a.talk_seconds })),
        },
        profit: { has_costs: profitRows.length > 0, by_product: profitRows, total_profit: profitRows.reduce((s: number, p: any) => s + p.profit, 0) },

        // === Pure Profit (actuals — money in vs money out) ===
        pure_profit: {
          total_packages: unitsSold,
          avg_price_per_package: unitsSold > 0 ? soldRevenue / unitsSold : 0,
          // Paid-basis totals (match the cash + by_product breakdown below).
          paid_orders: paidCount,
          paid_packages: paidPackages,
          packages_per_order: paidCount > 0 ? r2(paidPackages / paidCount) : 0,
          by_product: pureProfitByProduct,
          // Money in: cash actually collected (paid orders).
          cash_collected: r2(paidRevenue),
          // Money out:
          vat: vatDue,                                     // VAT included in collected cash (gross ÷ 6 at 20%)
          vat_rate: VAT_RATE,
          cogs: cogsPaid,                                  // product cost of what sold
          agent_commissions: totalSpecialAgentCommissions, // first-confirmer bonus (agents only)
          delivery_cost: deliveryCost,                     // courier outbound on all shipped
          return_loss: returnLoss,                         // round-trip loss on every return
          clear_profit: clearProfit,
          // COGS completeness: share of sold packages whose product has a known
          // cost_price, plus the offenders (their cost counts €0 above).
          cost_coverage: costCoverage,
          products_missing_cost: productsMissingCost,
          // Back-compat aliases for older UI keys.
          gross_profit_from_cost: r2(paidRevenue - cogsPaid),
          special_agent_commissions: totalSpecialAgentCommissions,
        },

        // === Margin Lab: realized per-package price + floor each product needs ===
        margin_lab: marginLab,

        // === Logistics spend by courier (which orders went by what) ===
        logistics,

        // === Prediction Lists ROI (which list generated how much money) ===
        prediction_lists: predictionLists,
      });
    }

    // ── Lead Distribution Config ─────────────────────────────
    // GET /api/lead-distribution-config
    if (req.method === "GET" && path === "lead-distribution-config") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data, error } = await adminClient
        .from("lead_distribution_config")
        .select("*")
        .limit(1)
        .single();
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data);
    }

    // PATCH /api/lead-distribution-config
    // GET /api/courier-rates — the editable logistics rate card (admin/manager)
    if (req.method === "GET" && path === "courier-rates") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const { data, error } = await adminClient
        .from("courier_rates")
        .select("id,courier,service,deliver_cost,return_cost,updated_at")
        .order("courier", { ascending: true })
        .order("service", { ascending: true });
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json(data || []);
    }

    // PATCH /api/courier-rates — update deliver/return costs (admin only).
    // Body: { rates: [{ courier, service, deliver_cost, return_cost }, ...] }
    if (req.method === "PATCH" && path === "courier-rates") {
      if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const rows = Array.isArray(body?.rates) ? body.rates : Array.isArray(body) ? body : [];
      if (!rows.length) return json({ error: "No rates provided" }, 400);
      const couriers = ["speedy", "econt"]; const services = ["door", "office"];
      for (const r of rows) {
        if (!couriers.includes(r.courier) || !services.includes(r.service)) {
          return json({ error: `Invalid courier/service: ${r.courier}/${r.service}` }, 400);
        }
        const { error } = await adminClient
          .from("courier_rates")
          .update({
            deliver_cost: Number(r.deliver_cost || 0),
            return_cost: Number(r.return_cost || 0),
            updated_at: new Date().toISOString(),
          })
          .eq("courier", r.courier)
          .eq("service", r.service);
        if (error) return json({ error: sanitizeDbError(error) }, 400);
      }
      return json({ success: true });
    }

    if (req.method === "PATCH" && path === "lead-distribution-config") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);
      const body = await req.json();
      const { strategy, is_active, max_leads_per_agent, priority_threshold } = body;
      const updates: any = { updated_at: new Date().toISOString(), updated_by: user.id };
      if (strategy !== undefined) updates.strategy = strategy;
      if (is_active !== undefined) updates.is_active = is_active;
      if (max_leads_per_agent !== undefined) updates.max_leads_per_agent = max_leads_per_agent;
      if (priority_threshold !== undefined) updates.priority_threshold = priority_threshold;

      const { data: configs } = await adminClient.from("lead_distribution_config").select("id").limit(1);
      if (!configs?.length) return json({ error: "No config found" }, 404);

      const { error } = await adminClient
        .from("lead_distribution_config")
        .update(updates)
        .eq("id", configs[0].id);
      if (error) return json({ error: sanitizeDbError(error) }, 400);
      return json({ success: true });
    }

    // POST /api/lead-distribution/auto-assign
    if (req.method === "POST" && path === "lead-distribution/auto-assign") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      // Get config
      const { data: config } = await adminClient
        .from("lead_distribution_config")
        .select("*")
        .limit(1)
        .single();
      if (!config) return json({ error: "No distribution config" }, 400);

      // Get unassigned pending orders
      const { data: unassigned } = await adminClient
        .from("orders")
        .select("id, price, customer_phone")
        .is("assigned_agent_id", null)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (!unassigned?.length) return json({ assigned: 0, message: "No unassigned orders" });

      // Get online agents
      const { data: allProfiles } = await adminClient
        .from("profiles")
        .select("user_id, full_name")
        .eq("is_active", true);
      const profileIds = (allProfiles || []).map((p: any) => p.user_id);
      const { data: agentRoles } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", profileIds.length > 0 ? profileIds : ["__none__"])
        .in("role", ["agent", "prediction_agent"]);
      const agentUserIds = [...new Set((agentRoles || []).map((r: any) => r.user_id))];
      if (!agentUserIds.length) return json({ assigned: 0, message: "No agents available" });

      // Get current load per agent
      const { data: currentLoads } = await adminClient
        .from("orders")
        .select("assigned_agent_id")
        .in("assigned_agent_id", agentUserIds)
        .in("status", ["pending", "take", "call_again"]);
      const loadMap: Record<string, number> = {};
      for (const uid of agentUserIds) loadMap[uid] = 0;
      for (const o of currentLoads || []) {
        loadMap[o.assigned_agent_id] = (loadMap[o.assigned_agent_id] || 0) + 1;
      }

      // Name map
      const nameMap: Record<string, string> = {};
      for (const p of allProfiles || []) nameMap[p.user_id] = p.full_name;

      // Filter out agents at max capacity
      const availableAgents = agentUserIds.filter(id => loadMap[id] < config.max_leads_per_agent);
      if (!availableAgents.length) return json({ assigned: 0, message: "All agents at max capacity" });

      let assignments: { orderId: string; agentId: string }[] = [];
      const strategy = config.strategy;

      if (strategy === "round_robin") {
        let idx = 0;
        for (const order of unassigned) {
          if (idx >= availableAgents.length) idx = 0;
          const agentId = availableAgents[idx];
          if (loadMap[agentId] < config.max_leads_per_agent) {
            assignments.push({ orderId: order.id, agentId });
            loadMap[agentId]++;
            idx++;
          }
        }
      } else if (strategy === "load_balance") {
        for (const order of unassigned) {
          // Pick agent with lowest load
          const sorted = availableAgents
            .filter(id => loadMap[id] < config.max_leads_per_agent)
            .sort((a, b) => loadMap[a] - loadMap[b]);
          if (!sorted.length) break;
          const agentId = sorted[0];
          assignments.push({ orderId: order.id, agentId });
          loadMap[agentId]++;
        }
      } else if (strategy === "priority") {
        // High-value orders (above threshold) go to agents with lowest load
        // Regular orders use round-robin
        const highValue = unassigned.filter((o: any) => Number(o.price) >= config.priority_threshold);
        const regular = unassigned.filter((o: any) => Number(o.price) < config.priority_threshold);

        // High-value: lowest load agent
        for (const order of highValue) {
          const sorted = availableAgents
            .filter(id => loadMap[id] < config.max_leads_per_agent)
            .sort((a, b) => loadMap[a] - loadMap[b]);
          if (!sorted.length) break;
          assignments.push({ orderId: order.id, agentId: sorted[0] });
          loadMap[sorted[0]]++;
        }

        // Regular: round-robin
        let idx = 0;
        for (const order of regular) {
          const avail = availableAgents.filter(id => loadMap[id] < config.max_leads_per_agent);
          if (!avail.length) break;
          if (idx >= avail.length) idx = 0;
          assignments.push({ orderId: order.id, agentId: avail[idx] });
          loadMap[avail[idx]]++;
          idx++;
        }
      }

      // Execute assignments
      let assigned = 0;
      for (const a of assignments) {
        const { error } = await adminClient
          .from("orders")
          .update({
            assigned_agent_id: a.agentId,
            assigned_agent_name: nameMap[a.agentId] || "",
            assigned_at: new Date().toISOString(),
            assigned_by: nameMap[user.id] || user.id,
          })
          .eq("id", a.orderId)
          .is("assigned_agent_id", null);
        if (!error) assigned++;
      }

      return json({ assigned, total_unassigned: unassigned.length, strategy });
    }

    // ── Operations Command Center ────────────────────────────
    // GET /api/operations-center
    if (req.method === "GET" && path === "operations-center") {
      if (!isAdminOrManager) return json({ error: "Forbidden" }, 403);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      // Today's orders by status
      const { data: todayOrders } = await adminClient
        .from("orders")
        .select("id, status, price, assigned_agent_id, assigned_agent_name, updated_at, created_at")
        .gte("created_at", todayISO);

      const confirmed = (todayOrders || []).filter((o: any) => o.status === "confirmed").length;
      const shipped = (todayOrders || []).filter((o: any) => o.status === "shipped").length;
      const returned = (todayOrders || []).filter((o: any) => o.status === "returned").length;
      const paid = (todayOrders || []).filter((o: any) => o.status === "paid").length;
      const todayRevenue = (todayOrders || [])
        .filter((o: any) => ["shipped", "paid"].includes(o.status))
        .reduce((s: number, o: any) => s + Number(o.price || 0), 0);
      const totalToday = (todayOrders || []).length;

      // Daily activity KPIs — strictly from actual status *transitions* recorded today via order_history.
      // This is the accurate "what we closed / processed today" (e.g. via BigArena CSV upload).
      // An order appears here on the calendar day its status actually became 'paid'/'returned' etc.
      // This prevents duplication and gives real operational visibility separate from cohort-by-created_at numbers.
      const todayHistory = await adminClient
        .from("order_history")
        .select("order_id, to_status, changed_at")
        .gte("changed_at", todayISO)
        .in("to_status", ["confirmed", "shipped", "paid", "returned"]);

      const todayTransitionOrderIds = new Set((todayHistory.data || []).map((h: any) => h.order_id));

      // Fetch current details only for orders that had relevant transitions today
      let todayTransitionOrders: any[] = [];
      if (todayTransitionOrderIds.size > 0) {
        const ids = Array.from(todayTransitionOrderIds);
        const { data: ords } = await adminClient
          .from("orders")
          .select("id, status, price")
          .in("id", ids);
        todayTransitionOrders = ords || [];
      }

      const confirmedToday = todayTransitionOrders.filter((o: any) => o.status === "confirmed").length;
      const shippedToday = todayTransitionOrders.filter((o: any) => o.status === "shipped").length;
      const returnedToday = todayTransitionOrders.filter((o: any) => o.status === "returned").length;
      const paidToday = todayTransitionOrders.filter((o: any) => o.status === "paid").length;
      const revenueToday = todayTransitionOrders
        .filter((o: any) => o.status === "paid")
        .reduce((s: number, o: any) => s + Number(o.price || 0), 0);

      // Online agents with today's activity
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("user_id, full_name, email, last_seen_at")
        .eq("is_active", true);

      const pIds = (profiles || []).map((p: any) => p.user_id);
      const { data: roles } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", pIds.length > 0 ? pIds : ["__none__"]);

      const roleMap2: Record<string, string[]> = {};
      for (const r of roles || []) {
        if (!roleMap2[r.user_id]) roleMap2[r.user_id] = [];
        roleMap2[r.user_id].push(r.role);
      }

      const agentProfiles = (profiles || []).filter((p: any) => {
        const r = roleMap2[p.user_id] || [];
        return r.includes("agent") || r.includes("prediction_agent");
      });

      // Today's shift login logs
      const todayDateStr = new Date().toISOString().split("T")[0];
      const { data: loginLogs } = await adminClient
        .from("shift_login_logs")
        .select("user_id, login_time, logout_time, shift_start_time, shift_end_time")
        .eq("shift_date", todayDateStr);

      const loginMap: Record<string, any> = {};
      for (const log of loginLogs || []) {
        loginMap[log.user_id] = log;
      }

      // Agent activity: orders touched today
      const agentActivity: Record<string, { confirmed: number; total: number }> = {};
      for (const o of todayOrders || []) {
        if (!o.assigned_agent_id) continue;
        if (!agentActivity[o.assigned_agent_id]) agentActivity[o.assigned_agent_id] = { confirmed: 0, total: 0 };
        agentActivity[o.assigned_agent_id].total++;
        if (o.status === "confirmed") agentActivity[o.assigned_agent_id].confirmed++;
      }

      // Active lead counts
      const { data: activeCounts } = await adminClient
        .from("orders")
        .select("assigned_agent_id")
        .in("assigned_agent_id", pIds.length > 0 ? pIds : ["__none__"])
        .in("status", ["pending", "take", "call_again"]);

      const activeMap: Record<string, number> = {};
      for (const o of activeCounts || []) {
        activeMap[o.assigned_agent_id] = (activeMap[o.assigned_agent_id] || 0) + 1;
      }

      // "Online" = a recent presence heartbeat (profiles.last_seen_at within 2 min),
      // exactly like GET /agents/online used by the Assigner — so the two "who's
      // online" views can never disagree. The old check (a shift_login_logs row with
      // no logout_time) wrongly marked active users offline when they never started a
      // shift or closed the tab without logging out, and could pin stale sessions
      // "online" forever. login_time is still surfaced for the "Since …" label.
      const ONLINE_WINDOW_MS = 2 * 60 * 1000;
      const nowMs = Date.now();
      const agentList = agentProfiles.map((p: any) => {
        const login = loginMap[p.user_id];
        const activity = agentActivity[p.user_id] || { confirmed: 0, total: 0 };
        const lastSeen = p.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
        return {
          user_id: p.user_id,
          full_name: p.full_name,
          email: p.email,
          roles: roleMap2[p.user_id] || [],
          is_online: lastSeen > 0 && (nowMs - lastSeen) < ONLINE_WINDOW_MS,
          login_time: login?.login_time || null,
          last_seen_at: p.last_seen_at || null,
          active_leads: activeMap[p.user_id] || 0,
          today_confirmed: activity.confirmed,
          today_total: activity.total,
        };
      });

      return json({
        kpi: {
          total_orders_today: totalToday,
          confirmed_today: confirmedToday,
          shipped_today: shippedToday,
          returned_today: returnedToday,
          paid_today: paidToday,
          revenue_today: revenueToday,
        },
        agents: agentList.sort((a: any, b: any) => b.today_total - a.today_total),
        agents_online: agentList.filter((a: any) => a.is_online).length,
        agents_total: agentList.length,
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("API Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}

// Top-level dispatcher — handles CORS scoping then delegates to handleRequest.
serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = pickAllowedOrigin(origin);

  const response = await handleRequest(req);

  // Only add CORS origin headers when the request actually came from a browser
  // on an allowed origin. Server-to-server callers don't need them.
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Vary", "Origin");
  }

  return response;
});

// Streets + quarters for a settlement from Econt's public Nomenclatures API.
// Merged into one list (the order form's Street field suggests both, so "люл"
// finds жк Люлин and "гоц" finds пл. Гоце Делчев). Cached per settlement on
// the warm instance to avoid hammering Econt.
const econtStreetCache = new Map<string, { streets: string[]; quarters: string[] }>();
async function getEcontStreetsAndQuarters(cityId: string): Promise<{ streets: string[]; quarters: string[] }> {
  if (econtStreetCache.has(cityId)) return econtStreetCache.get(cityId)!;
  const post = async (method: string) => {
    try {
      const res = await fetch(`https://ee.econt.com/services/Nomenclatures/NomenclaturesService.${method}.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityID: Number(cityId) }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  };
  const [s, q] = await Promise.all([post("getStreets"), post("getQuarters")]);
  const result = {
    streets: Array.from(new Set((s?.streets || []).map((x: any) => x.name).filter(Boolean))) as string[],
    quarters: Array.from(new Set((q?.quarters || []).map((x: any) => x.name).filter(Boolean))) as string[],
  };
  econtStreetCache.set(cityId, result);
  return result;
}

// Normalize a Kosovo phone to E.164 (+383XXXXXXXX) - TODO(kosovo): verify digit lengths vs real +383 numbers, matching how the rest
// of the CRM stores phones. Returns "" if there aren't enough digits.
//   0888123456 / 359888123456 / +359888123456 / 00359888123456 → +359888123456
function normalizeBgPhone(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("383")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  digits = digits.replace(/^0+/, "");
  if (digits.length < 8) return "";
  return "+383" + digits;
}

// ── Deterministic recording ↔ call matcher (shared by every surface) ─────────
// Fixes the long-call miss (#1) and the repeat-number swap (#4). The OLD code
// matched by "last-8 phone + nearest timestamp within ±20 min" comparing the
// recording's mtime (≈ call END) against the call's connected_at (call START),
// so any call longer than ~20 min could never match its own recording, and two
// calls to the same number could swap recordings.
//
// This matcher instead:
//   • anchors on the call END (recording mtime ≈ when MixMonitor closed the file
//     ≈ ended_at), so call length is irrelevant — the ±20 min window now only
//     absorbs PBX↔browser clock skew, not the call duration;
//   • prefers true interval OVERLAP when the recording's start is known
//     (elyon-rec.php now returns it), which is exact regardless of length;
//   • gates on the agent (recording extension → agent) when BOTH sides know it,
//     so two agents calling the same number can't cross;
//   • assigns ONE-TO-ONE (greedy by best score) so a recording or a call is used
//     at most once — no more "second call's recording shows on the first".
// Phone uses the last-8 rule (skill: elyon-phone-normalization).
type RecLite = { file?: string; dialed?: string; ext?: string; mtime?: number; start?: number; uniqueid?: string };
type CallLite = {
  id: string; agent_id?: string | null; customer_phone?: string | null;
  started_at?: string | null; connected_at?: string | null; ended_at?: string | null; created_at?: string | null;
};
function matchRecordingsToCalls(
  recordings: RecLite[],
  calls: CallLite[],
  extToAgent: Record<string, string> = {}, // extension -> agent user_id
): Map<string, RecLite> {
  const WINDOW_MS = 20 * 60 * 1000; // end-anchor tolerance (clock skew), NOT call length
  const last8 = (v: any) => String(v || "").replace(/\D/g, "").slice(-8);
  const callEndMs = (c: CallLite) => new Date(c.ended_at || c.connected_at || c.started_at || c.created_at || 0).getTime();
  const callStartMs = (c: CallLite) => new Date(c.connected_at || c.started_at || c.created_at || 0).getTime();
  // The Asterisk uniqueid is "<epoch>.<seq>" and is the LAST hyphen-separated
  // token of the recording filename (out-HHMMSS-ext-cid-to-dialed-<uniqueid>.wav).
  // Its leading integer is the channel-creation time = the call START — so we get
  // a reliable start with no timezone math and WITHOUT any elyon-rec.php change.
  const recStartMs = (rec: RecLite): number | null => {
    if (rec.start) return rec.start * 1000;
    const uid = rec.uniqueid || (rec.file ? String(rec.file).replace(/\.wav$/i, "").split("-").pop() || "" : "");
    const epoch = parseInt(String(uid).split(".")[0], 10);
    return Number.isFinite(epoch) && epoch > 1_000_000_000 ? epoch * 1000 : null;
  };

  const byPhone: Record<string, CallLite[]> = {};
  for (const c of calls) {
    const p = last8(c.customer_phone);
    if (p) (byPhone[p] = byPhone[p] || []).push(c);
  }

  type Pair = { rec: RecLite; call: CallLite; score: number };
  const pairs: Pair[] = [];
  for (const rec of recordings) {
    const p = last8(rec.dialed);
    if (!p || !byPhone[p]) continue;
    const recEnd = (rec.mtime || 0) * 1000;
    const recStart = recStartMs(rec);
    const recAgent = rec.ext ? extToAgent[rec.ext] : undefined;
    for (const call of byPhone[p]) {
      // Agent gate: only when BOTH sides know the agent (newer recordings carry ext).
      if (recAgent && call.agent_id && recAgent !== call.agent_id) continue;
      const cEnd = callEndMs(call);
      const cStart = callStartMs(call);
      let score: number;
      if (recStart) {
        const overlap = Math.min(recEnd, cEnd) - Math.max(recStart, cStart);
        if (overlap > 0) {
          score = overlap; // true overlaps (positive) always beat end-proximity (negative)
        } else {
          const endDist = Math.abs(cEnd - recEnd);
          if (endDist > WINDOW_MS) continue;
          score = -endDist;
        }
      } else {
        // No start known (pre-upgrade elyon-rec.php): anchor on the END only.
        const endDist = Math.abs(cEnd - recEnd);
        if (endDist > WINDOW_MS) continue;
        score = -endDist;
      }
      pairs.push({ rec, call, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map<string, RecLite>(); // call.id -> rec
  const usedRec = new Set<RecLite>();
  const usedCall = new Set<string>();
  for (const { rec, call } of pairs) {
    if (usedRec.has(rec) || usedCall.has(call.id)) continue;
    usedRec.add(rec); usedCall.add(call.id);
    out.set(call.id, rec);
  }
  return out;
}

// HMAC-SHA256 verification for inbound webhooks.
// The sender must include x-webhook-signature: <hex(HMAC_SHA256(rawBody, secret))>.
// FAIL CLOSED: if WEBHOOK_SECRET is unset we REJECT every webhook rather than
// silently accepting unsigned requests. The secret is always set in production,
// so this only guards against a misconfigured/blank-secret deploy opening the
// inbound pipeline to anyone. (Initial-rollout fail-open was removed 2026-06-11.)
async function verifyWebhookSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret) {
    console.error("WEBHOOK_SECRET not set — REJECTING webhook (fail-closed). Set the secret to restore inbound leads.");
    return false;
  }
  const provided = (req.headers.get("x-webhook-signature") || "").toLowerCase();
  if (!provided) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const expected = Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // timing-safe compare
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// Append-only audit log writer. Fire-and-await with error swallow — an
// audit failure should never block the actual operation. The audit_log
// table has BEFORE UPDATE/DELETE triggers that reject mutations, so once
// a row lands it cannot be tampered with even via the service role.
async function audit(
  client: any,
  actorId: string | null,
  actorEmail: string | null,
  action: string,
  opts: {
    target_type?: string;
    target_id?: string | number | null;
    target_name?: string | null;
    payload?: any;
  } = {},
): Promise<void> {
  try {
    await client.from("audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      target_type: opts.target_type ?? null,
      target_id: opts.target_id != null ? String(opts.target_id) : null,
      target_name: opts.target_name ?? null,
      payload: opts.payload ?? {},
    });
  } catch (err) {
    console.error("audit_log insert failed:", err);
  }
}

/**
 * Fire in-app notifications to a set of users. Best-effort: a failure here must
 * NEVER fail the request that triggered it (the same guarantee the DB triggers
 * give for missed-call / returned / low-stock events). De-dupes + drops nulls.
 */
async function notifyUsers(
  client: any,
  userIds: (string | null | undefined)[],
  n: { type: string; title: string; message?: string; link?: string | null },
): Promise<void> {
  const uniq = [...new Set(userIds.filter(Boolean))] as string[];
  if (uniq.length === 0) return;
  try {
    await client.from("notifications").insert(
      uniq.map((uid) => ({
        user_id: uid,
        type: n.type,
        title: n.title,
        message: n.message ?? "",
        link: n.link ?? null,
      })),
    );
  } catch (err) {
    console.error("notifyUsers insert failed:", err);
  }
}

function sanitizeDbError(err: any): string {
  const errorMap: Record<string, string> = {
    '23505': 'Duplicate entry',
    '23503': 'Referenced record not found',
    '23502': 'Required field missing',
    '23514': 'Invalid value',
    '42P01': 'Operation failed',
    '42703': 'Operation failed',
    '42501': 'Permission denied',
  };
  const code = err?.code;
  // Only log the error code, never the full error payload (avoid leaking
  // schema details such as table/column/constraint names into logs).
  console.error('Database error code:', code || 'unknown');
  return errorMap[code] || 'Operation failed';
}

// Per-agent Personal List capacity. Operator-tunable from Settings → System
// Rules (app_settings.personal_list_max_holds). Clamped to a sane range and
// defaults to 50 when unset/invalid.
const PERSONAL_LIST_CAP_DEFAULT = 50;
async function getPersonalListCap(adminClient: any): Promise<number> {
  try {
    const { data } = await adminClient
      .from("app_settings")
      .select("value")
      .eq("key", "personal_list_max_holds")
      .maybeSingle();
    const n = Number(data?.value);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) return Math.floor(n);
  } catch (_) { /* fall through to default */ }
  return PERSONAL_LIST_CAP_DEFAULT;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Strip characters that have meaning in PostgREST's `.or()` filter syntax
// or in LIKE patterns. Defense-in-depth — the Supabase SDK already escapes
// most of these, but we don't want a stray '%' in user input to suddenly
// match every row, and we don't want commas/parens to be interpreted as
// filter separators in our search-string concatenation.
function sanitizeSearch(s: string): string {
  return (s || "").replace(/[%_\\,().]/g, "").trim();
}

// In-memory sliding-window rate limiter for public webhook endpoints.
// 100 requests per 60 seconds per key (slug or IP).
const __webhookRateBuckets = new Map<string, number[]>();
function checkWebhookRateLimit(key: string, limit = 100, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (__webhookRateBuckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) {
    __webhookRateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  __webhookRateBuckets.set(key, arr);
  return true;
}

// Per-user rate limiter for sensitive authed endpoints. Keyed by
// `${userId}:${endpoint}`. Defaults are deliberately generous — these
// are admin operations performed by humans, not bots, so the limit is
// to protect against runaway scripts and automation accidents, not
// against deliberate denial-of-service.
const __userRateBuckets = new Map<string, number[]>();
function checkUserRateLimit(userId: string, endpoint: string, limit = 30, windowMs = 60_000): boolean {
  const key = `${userId}:${endpoint}`;
  const now = Date.now();
  const arr = (__userRateBuckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) {
    __userRateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  __userRateBuckets.set(key, arr);
  return true;
}
