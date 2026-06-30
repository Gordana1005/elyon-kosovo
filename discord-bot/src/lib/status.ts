// Order status — mirrors the CRM enum (order_status) and src/types/index.ts colours.
export type OrderStatus =
  | 'pending' | 'take' | 'call_again' | 'confirmed' | 'shipped'
  | 'delivered' | 'returned' | 'paid' | 'trashed' | 'cancelled';

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', take: 'Taken', call_again: 'Call Again', confirmed: 'Confirmed',
  shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned', paid: 'Paid',
  trashed: 'Trashed', cancelled: 'Cancelled',
};

export const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳', take: '✋', call_again: '🔁', confirmed: '✅', shipped: '🚚',
  delivered: '📦', returned: '↩️', paid: '💰', trashed: '🗑️', cancelled: '❌',
};

export const STATUS_COLOR: Record<string, number> = {
  pending: 0xf59e0b, take: 0xa855f7, call_again: 0x0ea5e9, confirmed: 0x22c55e,
  shipped: 0x3b82f6, delivered: 0x14b8a6, returned: 0xec4899, paid: 0x059669,
  trashed: 0x6b7280, cancelled: 0xef4444,
};

export function statusLabel(s: string): string { return STATUS_LABEL[s] ?? s; }
export function statusEmoji(s: string): string { return STATUS_EMOJI[s] ?? '•'; }
export function statusColor(s: string): number { return STATUS_COLOR[s] ?? 0x5865f2; }
export function statusBadge(s: string): string { return `${statusEmoji(s)} ${statusLabel(s)}`; }

// Lifecycle buckets — MUST mirror supabase/functions/api/index.ts (agent-performance).
export const CONFIRMED_SET = ['confirmed', 'shipped', 'delivered', 'returned', 'paid'];
export const SHIPPED_SET = ['shipped', 'delivered', 'returned', 'paid'];
export const OPEN_SET = ['pending', 'take', 'call_again'];

export function isConfirmed(s: string): boolean { return CONFIRMED_SET.includes(s); }
export function isShipped(s: string): boolean { return SHIPPED_SET.includes(s); }
