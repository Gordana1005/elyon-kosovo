import { q } from '../pool';
import { PerfInput, Perf, computePerf } from '../../lib/perf';

export type RawOrder = PerfInput;

export async function fetchOrdersForRange(startISO: string, endISO: string, ownerId?: string): Promise<RawOrder[]> {
  const params: unknown[] = [startISO, endISO];
  let where = `created_at >= $1 AND created_at < $2`;
  if (ownerId) {
    params.push(ownerId);
    where += ` AND COALESCE(confirmed_by_agent_id, assigned_agent_id) = $${params.length}`;
  }
  return q<RawOrder>(
    `SELECT id, status, COALESCE(price,0)::float AS price, COALESCE(quantity,1)::int AS quantity,
            COALESCE(confirmed_by_agent_id, assigned_agent_id) AS owner_id
     FROM orders WHERE ${where}`,
    params,
  );
}

export async function fetchItemsForOrders(ids: string[]): Promise<Record<string, { price_per_unit: number; quantity: number }[]>> {
  if (ids.length === 0) return {};
  const rows = await q<{ order_id: string; price_per_unit: number; quantity: number }>(
    `SELECT order_id, COALESCE(price_per_unit,0)::float AS price_per_unit, COALESCE(quantity,0)::int AS quantity
     FROM order_items WHERE order_id = ANY($1)`,
    [ids],
  );
  const map: Record<string, { price_per_unit: number; quantity: number }[]> = {};
  for (const r of rows) (map[r.order_id] ??= []).push({ price_per_unit: r.price_per_unit, quantity: r.quantity });
  return map;
}

/** Full KPI breakdown for one agent over a range. */
export async function agentPerf(startISO: string, endISO: string, ownerId: string): Promise<Perf> {
  const orders = await fetchOrdersForRange(startISO, endISO, ownerId);
  const paidIds = orders.filter((o) => o.status === 'paid').map((o) => o.id);
  const items = await fetchItemsForOrders(paidIds);
  return computePerf(orders, items);
}

export interface LeaderRow {
  owner_id: string;
  perf: Perf;
}

export async function leaderboard(startISO: string, endISO: string): Promise<LeaderRow[]> {
  const orders = await fetchOrdersForRange(startISO, endISO);
  const paidIds = orders.filter((o) => o.status === 'paid').map((o) => o.id);
  const items = await fetchItemsForOrders(paidIds);

  const byOwner = new Map<string, RawOrder[]>();
  for (const o of orders) {
    if (!o.owner_id) continue;
    let arr = byOwner.get(o.owner_id);
    if (!arr) {
      arr = [];
      byOwner.set(o.owner_id, arr);
    }
    arr.push(o);
  }

  const out: LeaderRow[] = [];
  for (const [owner_id, list] of byOwner) out.push({ owner_id, perf: computePerf(list, items) });
  return out;
}

export interface ReasonCount {
  reason: string;
  count: number;
  value: number;
}

export async function returnsByReason(startISO: string, endISO: string, ownerId?: string): Promise<ReasonCount[]> {
  const params: unknown[] = [startISO, endISO];
  let where = `status = 'returned' AND returned_at >= $1 AND returned_at < $2`;
  if (ownerId) {
    params.push(ownerId);
    where += ` AND COALESCE(confirmed_by_agent_id, assigned_agent_id) = $${params.length}`;
  }
  return q<ReasonCount>(
    `SELECT COALESCE(NULLIF(return_reason, ''), '(none)') AS reason, count(*)::int AS count, COALESCE(sum(price),0)::float AS value
     FROM orders WHERE ${where} GROUP BY 1 ORDER BY count DESC`,
    params,
  );
}

export async function cancellationsByReason(startISO: string, endISO: string, ownerId?: string): Promise<ReasonCount[]> {
  const params: unknown[] = [startISO, endISO];
  let where = `status = 'cancelled' AND cancelled_at >= $1 AND cancelled_at < $2`;
  if (ownerId) {
    params.push(ownerId);
    where += ` AND COALESCE(confirmed_by_agent_id, assigned_agent_id) = $${params.length}`;
  }
  return q<ReasonCount>(
    `SELECT COALESCE(NULLIF(cancellation_reason, ''), '(none)') AS reason, count(*)::int AS count, COALESCE(sum(price),0)::float AS value
     FROM orders WHERE ${where} GROUP BY 1 ORDER BY count DESC`,
    params,
  );
}

export interface ProductRow {
  product_name: string;
  units: number;
  revenue: number;
}

export async function topProducts(startISO: string, endISO: string, limit = 20): Promise<ProductRow[]> {
  return q<ProductRow>(
    `SELECT oi.product_name, sum(oi.quantity)::int AS units, COALESCE(sum(oi.total_price),0)::float AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'paid' AND o.created_at >= $1 AND o.created_at < $2
     GROUP BY oi.product_name ORDER BY revenue DESC LIMIT ${Math.min(limit, 50)}`,
    [startISO, endISO],
  );
}
