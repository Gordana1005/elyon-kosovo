// Competitor (Monadon / "MONADLIST") product → OUR substitute product.
// Agents call these legacy customers; showing "Brand / Our substitute" tells them
// exactly what to offer. Display-only — Monadon orders stay excluded from all
// money/insights. Raw data lives in ./monadonSubstitutes.json so the Node import +
// refresh scripts read the SAME source (one source of truth, no drift).
import rawMap from './monadonSubstitutes.json';
import { formatProductWithQuantity } from './utils';

export interface MonadonSubstitute {
  /** UPPERCASE competitor brand, matched as a prefix of the order's product_name. */
  brand: string;
  /** Pretty original brand shown to the agent (e.g. "Testoy"). */
  display: string;
  /** Our product to pitch instead (e.g. "Enduro Max"). */
  substitute: string;
}

// Longest brand first so a more specific brand wins if two share a prefix
// (defensive — brands here don't nest, and startsWith already avoids the
// "O CAPS" ⊂ "PRO CAPS" substring trap).
const MAP: MonadonSubstitute[] = [...(rawMap as MonadonSubstitute[])]
  .sort((a, b) => b.brand.length - a.brand.length);

/**
 * Resolve a competitor product string to our substitute, or null when there is
 * no mapping (SPIRULINA, appliances, or anything unknown → show the original).
 */
export function monadonSubstitute(productName: string): MonadonSubstitute | null {
  if (!productName) return null;
  const up = productName.trim().toUpperCase();
  for (const e of MAP) if (up.startsWith(e.brand)) return e;
  return null;
}

/**
 * Render a Monadon product cell as "Brand / Our substitute" for mapped brands,
 * or the original text untouched for unmapped ones. Handles the few comma-joined
 * multi-brand cells by mapping each part.
 */
export function formatMonadonProducts(productName: string): string {
  if (!productName || !productName.trim()) return '—';
  return productName
    .split(',')
    .map((raw) => {
      const part = raw.trim();
      if (!part) return '';
      const m = monadonSubstitute(part);
      return m ? `${m.display} / ${m.substitute}` : part;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Canonical product label for ANY agent-facing order/history row.
 * - Monadon (competitor) order → "Brand / Our substitute".
 * - Everything else → the normal "Name xN, …" label.
 * Tolerant of the different order shapes across surfaces: `order_items` vs `items`,
 * and `product_name` vs `product_name_fallback`.
 */
export function formatOrderProducts(order: any): string {
  const rawName = order?.product_name || order?.product_name_fallback || '';
  if (order?.source_type === 'monadon_legacy' && rawName) {
    return formatMonadonProducts(rawName);
  }
  const items = order?.order_items || order?.items || [];
  if (items.length > 0) {
    return items
      .map((i: any) => formatProductWithQuantity(i.product_name, i.quantity))
      .join(', ');
  }
  return rawName ? formatProductWithQuantity(rawName, order?.quantity || 1) : '—';
}
