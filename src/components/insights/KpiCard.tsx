import type { ElementType } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Shared KPI / metric card for the analytics hub (Insights tabs, etc.).
 * Single source for what used to be a `Kpi` component duplicated in
 * ManagementInsightsPage and AgentActivityPage.
 *
 * `icon` is a lucide (or any) component type — pass `Coins`, not `<Coins />`.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ElementType;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-3">
          <div className={cn('rounded-full p-2.5', tone || 'bg-primary/10')}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold tabular-nums break-all">{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
