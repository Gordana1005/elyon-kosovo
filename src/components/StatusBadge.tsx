import { useTranslation } from 'react-i18next';
import { OrderStatus, statusLabel, STATUS_COLORS } from '@/types';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  useTranslation(); // subscribe so the label re-renders on language switch
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-3 py-0 text-[11px] font-semibold leading-4', STATUS_COLORS[status], className)}>
      {statusLabel(status)}
    </span>
  );
}
