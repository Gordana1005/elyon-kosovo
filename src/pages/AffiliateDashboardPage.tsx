import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/layouts/AppLayout';
import { apiGetAffiliatePortalStats, apiGetAffiliatePortalLeads } from '@/lib/api';
import { formatEur } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { SmartPagination } from '@/components/SmartPagination';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';

// Affiliate-facing money is EUR-only (TV-board precedent) — the lev twin is an
// internal operator convention, not something partners bill in.
const STAGES = ['wait', 'hold', 'approve', 'cancel', 'trash', 'return'] as const;

export const stageBadge: Record<string, string> = {
  wait: 'bg-slate-500/10 text-slate-600 border-slate-200',
  hold: 'bg-amber-500/10 text-amber-600 border-amber-200',
  approve: 'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30',
  cancel: 'bg-destructive/10 text-destructive border-destructive/30',
  trash: 'bg-muted text-muted-foreground border-border',
  return: 'bg-orange-500/10 text-orange-600 border-orange-200',
};

export default function AffiliateDashboardPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState('30');
  const [stage, setStage] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 30;

  const from = new Date(Date.now() - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['affiliate-portal-stats', from],
    queryFn: () => apiGetAffiliatePortalStats(from),
  });
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['affiliate-portal-leads', stage, page],
    queryFn: () => apiGetAffiliatePortalLeads({ page, limit, stage: stage === 'all' ? undefined : stage }),
  });

  const totals = stats?.totals;
  const approveRate = totals && totals.sent > 0
    ? Math.round(((totals.hold + totals.paid) / totals.sent) * 100) : 0;
  const buyoutRate = totals && (totals.hold + totals.paid + totals.returned) > 0
    ? Math.round((totals.paid / (totals.hold + totals.paid + totals.returned)) * 100) : 0;

  const rows = leads?.rows || [];
  const total = leads?.total || 0;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <AppLayout
      title={t('affiliate.dashboardTitle')}
      headerActions={
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[130px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t('affiliate.last7')}</SelectItem>
            <SelectItem value="30">{t('affiliate.last30')}</SelectItem>
            <SelectItem value="90">{t('affiliate.last90')}</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-6">
        {/* KPI tiles */}
        {statsLoading || !totals ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: t('affiliate.kpiSent'), value: totals.sent },
              { label: t('affiliate.kpiApproveRate'), value: `${approveRate}%` },
              { label: t('affiliate.kpiBuyoutRate'), value: `${buyoutRate}%` },
              { label: t('affiliate.kpiHold'), value: totals.hold },
              { label: t('affiliate.kpiPayoutHold'), value: formatEur(totals.payout_hold) },
              { label: t('affiliate.kpiPayoutEarned'), value: formatEur(totals.payout_earned), highlight: true },
            ].map((s, i) => (
              <div key={i} className={cn(
                'rounded-xl border bg-card shadow-sm px-4 py-4',
                s.highlight && 'border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/5',
              )}>
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Leads */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('affiliate.myLeads')}</h2>
          <Select value={stage} onValueChange={(v) => { setStage(v); setPage(1); }}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('affiliate.allStages')}</SelectItem>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{t(`affiliate.stage.${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colDate')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colYourId')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colClickid')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colSub1')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colOffer')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colCustomer')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colPayout')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('affiliate.colStage')}</th>
                </tr>
              </thead>
              <tbody>
                {leadsLoading ? (
                  <tr><td colSpan={8} className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin text-primary inline-block" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <EmptyState
                        icon={<Inbox className="h-5 w-5" />}
                        title={t('affiliate.noLeads')}
                        description={t('affiliate.noLeadsDesc')}
                        size="sm"
                        className="border-0 bg-transparent hover:shadow-none py-8"
                      />
                    </td>
                  </tr>
                ) : rows.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(l.created_at), 'MMM d, HH:mm')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{l.ext_id || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs truncate max-w-[140px]" title={l.clickid || ''}>{l.clickid || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{l.sub1 || '—'}</td>
                    <td className="px-4 py-3">{l.offer_name || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {l.customer_name}
                      {l.phone_masked && <span className="text-muted-foreground ml-1.5 font-mono">{l.phone_masked}</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold">{formatEur(l.payout_eur)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn('text-xs', stageBadge[l.stage])}>
                        {t(`affiliate.stage.${l.stage}`)}
                      </Badge>
                      {l.reason && <p className="text-[11px] text-muted-foreground mt-0.5">{l.reason}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('affiliate.pageOf', { page, pages, total })}</span>
            <SmartPagination page={page} totalPages={pages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
