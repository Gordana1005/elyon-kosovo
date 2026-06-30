// Per-package agent commission — mirrors supabase/functions/api/index.ts (565-605).
// Earned ONLY on status='paid', credited to the confirming agent. Admins/managers earn 0.
export function packageBonusRate(unitPrice: number): number {
  if (unitPrice >= 35) return 3;
  if (unitPrice > 25) return 2;
  return 1;
}

export interface BonusItem { price_per_unit: number; quantity: number; }

export function orderPackageBonus(o: {
  status: string;
  price: number;
  quantity: number;
  items?: BonusItem[];
}): number {
  if (o.status !== 'paid') return 0;
  const items = o.items ?? [];
  if (items.length > 0) {
    let total = 0;
    for (const it of items) total += packageBonusRate(Number(it.price_per_unit || 0)) * Number(it.quantity || 0);
    return total;
  }
  // Legacy fallback: no order_items rows.
  const units = Number(o.quantity || 0) || 1;
  const unit = Number(o.price || 0) / Math.max(1, units);
  return packageBonusRate(unit) * units;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
