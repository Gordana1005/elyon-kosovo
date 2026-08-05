import { useTranslation } from 'react-i18next';
import { OrderStatus, statusLabel, STATUS_COLORS } from '@/types';
import { cn } from '@/lib/utils';
import { statusTooltip } from '@/lib/orderReason';

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
  /**
   * The order this badge belongs to. Pass it and a hover tooltip appears
   * carrying the full reason — "Откажано — Ќе размисли — се јави откажа".
   * A cancelled chip on its own tells you nothing about WHY, and the reason is
   * usually the only thing worth knowing about a cancelled order, so every
   * caller that has the order should pass it.
   */
  order?: any;
}

export function StatusBadge({ status, className, order }: StatusBadgeProps) {
  useTranslation(); // subscribe so the label re-renders on language switch
  const label = statusLabel(status);
  const title = order ? statusTooltip(order, label) : undefined;
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-3 py-0 text-[11px] font-semibold leading-4',
        title && 'cursor-help',
        STATUS_COLORS[status],
        className,
      )}
    >
      {label}
    </span>
  );
}
