import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Horizontal "swipe strip" for toolbars / filter bars on mobile.
 *
 * On phones the children stay in ONE row and scroll sideways (the same feel as
 * the Insights tabs and the Orders filter bar); from `md` up they wrap normally.
 * Give each child `shrink-0` so it keeps its natural width inside the strip.
 */
export function ScrollStrip({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 overflow-x-auto scrollbar-thin snap-x pb-1',
        'md:flex-wrap md:overflow-visible md:pb-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
