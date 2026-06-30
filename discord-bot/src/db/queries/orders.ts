import { q } from '../pool';
import { OrderRef } from '../../lib/order-ref';

export interface OrderRow {
  id: string;
  display_id: string;
  status: string;
  product_name: string;
  quantity: number;
  price: number;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  customer_address: string;
  postal_code: string | null;
  street: string;
  street_number: string;
  block: string;
  entry: string;
  floor: string;
  apartment: string;
  quarter: string | null;
  delivery_type: string;
  home_courier: string | null;
  courier_office_code: string;
  courier_office_name: string;
  courier_office_city: string;
  delivery_instructions: string;
  gift_note: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_at: string | null;
  confirmed_at: string | null;
  confirmed_by_agent_id: string | null;
  confirmed_by_name: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancellation_reason_notes: string | null;
  returned_at: string | null;
  return_reason: string | null;
  return_reason_notes: string | null;
  source_type: string | null;
  ship_after_date: string | null;
  created_at: string;
  updated_at: string;
}

export async function getOrderByRef(ref: OrderRef): Promise<OrderRow | null> {
  // column is from a fixed allowlist ('id' | 'display_id'); value is parameterised.
  const col = ref.column === 'id' ? 'id' : 'display_id';
  const rows = await q<OrderRow>(`SELECT * FROM orders WHERE ${col} = $1 LIMIT 1`, [ref.value]);
  return rows[0] ?? null;
}

export interface OrderItem {
  product_name: string;
  quantity: number;
  price_per_unit: number;
  total_price: number;
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  return q<OrderItem>(
    `SELECT product_name, quantity, COALESCE(price_per_unit,0)::float AS price_per_unit, COALESCE(total_price,0)::float AS total_price
     FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [orderId],
  );
}

export interface HistoryRow {
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by_name: string | null;
}

export async function getOrderHistory(orderId: string): Promise<HistoryRow[]> {
  return q<HistoryRow>(
    `SELECT from_status, to_status, changed_at, changed_by_name
     FROM order_history WHERE order_id = $1 ORDER BY changed_at`,
    [orderId],
  );
}

/** First time the order reached a given status (for ship/deliver/paid timestamps). */
export function firstReached(history: HistoryRow[], status: string): string | null {
  return history.find((h) => h.to_status === status)?.changed_at ?? null;
}

export interface BriefOrder {
  display_id: string;
  status: string;
  price: number;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  created_at: string;
  owner_name: string | null;
}

const BRIEF_COLS = `display_id, status, COALESCE(price,0)::float AS price, customer_name, customer_phone,
  customer_city, created_at, COALESCE(confirmed_by_name, assigned_agent_name) AS owner_name`;

export async function listOpenOrders(opts: { ownerId?: string; statuses: string[]; limit?: number }): Promise<BriefOrder[]> {
  const params: unknown[] = [opts.statuses];
  let where = `status = ANY($1)`;
  if (opts.ownerId) {
    params.push(opts.ownerId);
    where += ` AND COALESCE(confirmed_by_agent_id, assigned_agent_id) = $${params.length}`;
  }
  const limit = Math.min(opts.limit ?? 50, 100);
  return q<BriefOrder>(`SELECT ${BRIEF_COLS} FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`, params);
}

export async function listCallbacksDue(opts: { ownerId?: string; limit?: number }): Promise<BriefOrder[]> {
  const params: unknown[] = [];
  let where = `status = 'call_again' AND (next_call_after IS NULL OR next_call_after <= now())`;
  if (opts.ownerId) {
    params.push(opts.ownerId);
    where += ` AND COALESCE(confirmed_by_agent_id, assigned_agent_id) = $${params.length}`;
  }
  const limit = Math.min(opts.limit ?? 50, 100);
  return q<BriefOrder>(`SELECT ${BRIEF_COLS} FROM orders WHERE ${where} ORDER BY created_at ASC LIMIT ${limit}`, params);
}

export async function listCodOutstanding(opts: { ownerId?: string; limit?: number }): Promise<BriefOrder[]> {
  const params: unknown[] = [];
  let where = `status = 'shipped'`;
  if (opts.ownerId) {
    params.push(opts.ownerId);
    where += ` AND COALESCE(confirmed_by_agent_id, assigned_agent_id) = $${params.length}`;
  }
  const limit = Math.min(opts.limit ?? 200, 300);
  return q<BriefOrder>(`SELECT ${BRIEF_COLS} FROM orders WHERE ${where} ORDER BY created_at ASC LIMIT ${limit}`, params);
}

/** Confirmed-but-not-yet-shipped = warehouse hand-off backlog. */
export async function listPendingShipment(limit = 300): Promise<BriefOrder[]> {
  return q<BriefOrder>(
    `SELECT ${BRIEF_COLS} FROM orders WHERE status = 'confirmed' ORDER BY confirmed_at ASC NULLS LAST LIMIT ${Math.min(limit, 500)}`,
  );
}

export interface HealthStat {
  total: number;
  paid: number;
  confirmed: number;
  shipped: number;
  pending: number;
  cancelled: number;
  returned: number;
  paid_revenue: number;
  outstanding: number;
}

export async function healthForRange(startISO: string, endISO: string): Promise<HealthStat> {
  const rows = await q<HealthStat>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status='paid')::int AS paid,
       count(*) FILTER (WHERE status IN ('confirmed','shipped','delivered','returned','paid'))::int AS confirmed,
       count(*) FILTER (WHERE status='shipped')::int AS shipped,
       count(*) FILTER (WHERE status='pending')::int AS pending,
       count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
       count(*) FILTER (WHERE status='returned')::int AS returned,
       COALESCE(sum(price) FILTER (WHERE status='paid'),0)::float AS paid_revenue,
       COALESCE(sum(price) FILTER (WHERE status='shipped'),0)::float AS outstanding
     FROM orders WHERE created_at >= $1 AND created_at < $2`,
    [startISO, endISO],
  );
  return rows[0]!;
}

export async function pendingPoolSize(): Promise<number> {
  const r = await q<{ c: number }>(`SELECT count(*)::int AS c FROM orders WHERE status = 'pending'`);
  return r[0]?.c ?? 0;
}

/** Customer dossier: all orders whose phone ends with the same last-8 digits. */
export async function customerOrders(rawPhone: string): Promise<BriefOrder[]> {
  const digits = (rawPhone || '').replace(/\D/g, '');
  const last8 = digits.slice(-8);
  if (last8.length < 6) return [];
  return q<BriefOrder>(
    `SELECT ${BRIEF_COLS} FROM orders
     WHERE right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 8) = $1
     ORDER BY created_at DESC LIMIT 50`,
    [last8],
  );
}
