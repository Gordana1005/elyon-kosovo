import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Mobile "row as a card" primitives.
 *
 * Wide desktop tables are kept under `hidden md:block`; on phones each row is
 * re-rendered as a <MobileCard> (header + labeled field rows + an action row)
 * so every value is visible at once with no horizontal scrolling.
 *
 * Pattern:
 *   <div className="md:hidden space-y-2">
 *     {rows.map(r => (
 *       <MobileCard key={r.id} onClick={...}>
 *         <MobileCardHeader title={r.name} subtitle={r.phone} badge={<Badge/>} />
 *         <MobileCardField label="Total" value={fmt(r.total)} />
 *         <MobileCardActions><Button .../></MobileCardActions>
 *       </MobileCard>
 *     ))}
 *   </div>
 */

export function MobileCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3 shadow-sm space-y-2',
        props.onClick && 'cursor-pointer hover:bg-muted/30 transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MobileCardHeader({
  title,
  subtitle,
  badge,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned slot, typically a status badge. */
  badge?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <div className="font-semibold text-sm text-card-foreground truncate">{title}</div>
        {subtitle !== undefined && subtitle !== null && (
          <div className="text-xs font-mono text-muted-foreground truncate">{subtitle}</div>
        )}
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </div>
  );
}

export function MobileCardField({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 text-sm', className)}>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium text-card-foreground min-w-0 break-words">{value}</span>
    </div>
  );
}

export function MobileCardActions({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-2 pt-1 [&>*]:flex-1', className)}>
      {children}
    </div>
  );
}
