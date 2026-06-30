const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrderRef {
  column: 'id' | 'display_id';
  value: string;
  pretty: string;
}

/**
 * Resolve user input into an order lookup key.
 *  - "13346", "ord-13346", "ORD-13346", "#13346" -> display_id "ORD-13346"
 *  - a UUID -> id
 * display_id is generated as 'ORD-' || LPAD(seq, 5, '0') in the CRM.
 */
export function resolveOrderRef(input: string): OrderRef | null {
  const t = (input || '').trim();
  if (!t) return null;
  if (UUID_RE.test(t)) return { column: 'id', value: t, pretty: t.slice(0, 8) };
  const digits = t.replace(/\D/g, '');
  if (!digits) return null;
  const display = `ORD-${digits.padStart(5, '0')}`;
  return { column: 'display_id', value: display, pretty: display };
}
