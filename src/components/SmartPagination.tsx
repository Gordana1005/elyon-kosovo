import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Page numbers shown on each side of the current one (default 1). */
  siblingCount?: number;
  className?: string;
}

const range = (start: number, end: number): number[] =>
  Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);

// Canonical windowed range: first and last page are ALWAYS present and
// clickable; a window slides around the current page; gaps collapse to "…".
// e.g. 20 pages on page 10 → [1, …, 9, 10, 11, …, 20].
function paginationRange(page: number, totalPages: number, siblingCount: number): (number | 'left-dots' | 'right-dots')[] {
  const totalNumbers = siblingCount * 2 + 5; // first + last + current + 2 siblings + 2 dots
  if (totalNumbers >= totalPages) return range(1, totalPages);

  const leftSibling = Math.max(page - siblingCount, 1);
  const rightSibling = Math.min(page + siblingCount, totalPages);
  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < totalPages - 1;
  const edgeCount = 3 + 2 * siblingCount;

  if (!showLeftDots && showRightDots) {
    return [...range(1, edgeCount), 'right-dots', totalPages];
  }
  if (showLeftDots && !showRightDots) {
    return [1, 'left-dots', ...range(totalPages - edgeCount + 1, totalPages)];
  }
  return [1, 'left-dots', ...range(leftSibling, rightSibling), 'right-dots', totalPages];
}

/**
 * Reusable pagination used across every long list (Orders, Call History,
 * segments, …). Fixes the old hand-rolled "always pages 1–5" control: the last
 * page is always reachable and the number window slides as you navigate.
 */
export function SmartPagination({ page, totalPages, onPageChange, siblingCount = 1, className }: SmartPaginationProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  const items = paginationRange(page, totalPages, siblingCount);
  const go = (p: number) => { if (p >= 1 && p <= totalPages && p !== page) onPageChange(p); };
  const base = 'flex h-8 items-center justify-center rounded-lg text-sm font-medium transition-colors';

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label={t('pagination.prev')}
        className={cn(base, 'w-8 border hover:bg-muted disabled:opacity-40 disabled:pointer-events-none')}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {items.map((it, i) =>
        it === 'left-dots' || it === 'right-dots' ? (
          <span key={`${it}-${i}`} className="flex h-8 w-8 items-center justify-center text-sm text-muted-foreground select-none">…</span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => go(it)}
            aria-current={it === page ? 'page' : undefined}
            className={cn(base, 'min-w-8 px-2', it === page ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted')}
          >
            {it}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        aria-label={t('pagination.next')}
        className={cn(base, 'w-8 border hover:bg-muted disabled:opacity-40 disabled:pointer-events-none')}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
