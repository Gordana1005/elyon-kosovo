import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { isPast } from 'date-fns';
import { formatDistanceToNow } from '@/i18n/dates';
import { Clock, Phone, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { apiGetCallAgainQueue, type CallAgainEntry } from '@/lib/api';
import { formatEur, formatLev } from '@/lib/currency';
import { MobileCard, MobileCardHeader, MobileCardField, MobileCardActions } from '@/components/ui/mobile-card';
import { cn } from '@/lib/utils';

export default function CallAgainPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdminOrManager = user?.isAdmin || user?.isManager;
  return (
    <AppLayout title={t('nav.callAgain')}>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="h-6 w-6 text-purple-700" /> {t('nav.callAgain')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('callAgainPage.intro')}
          </p>
        </div>

        <Tabs defaultValue="mine" className="space-y-4">
          <TabsList>
            <TabsTrigger value="mine" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> {t('callAgainPage.myQueue')}
            </TabsTrigger>
            {isAdminOrManager && (
              <TabsTrigger value="all" className="gap-1.5">
                <Users className="h-3.5 w-3.5" /> {t('callAgainPage.everyonesQueue')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="mine"><QueueTab mine /></TabsContent>
          {isAdminOrManager && <TabsContent value="all"><QueueTab mine={false} /></TabsContent>}
        </Tabs>
      </div>
    </AppLayout>
  );
}

function QueueTab({ mine }: { mine: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['call-again-queue', mine],
    queryFn: () => apiGetCallAgainQueue(mine),
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {mine ? t('callAgainPage.yourFollowUps') : t('callAgainPage.allAgentsPending')}
          <span className="text-muted-foreground font-normal text-sm">({data?.length ?? 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>
        ) : !data?.length ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            <Clock className="h-6 w-6 mx-auto mb-2 opacity-40" />
            {mine
              ? t('callAgainPage.noCallbacksMine')
              : t('callAgainPage.noCallbacksTeam')}
          </div>
        ) : (
          <QueueTable rows={data} showAgent={!mine} />
        )}
      </CardContent>
    </Card>
  );
}

function QueueTable({ rows, showAgent }: { rows: CallAgainEntry[]; showAgent: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
    {/* Desktop: table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-2 font-medium">{t('callAgainPage.colCustomer')}</th>
            {showAgent && <th className="text-left py-2 font-medium">{t('callAgainPage.colAgent')}</th>}
            <th className="text-left py-2 font-medium">{t('callAgainPage.colSourceList')}</th>
            <th className="text-right py-2 font-medium">{t('callAgainPage.colLifetime')}</th>
            <th className="text-right py-2 font-medium">{t('callAgainPage.colAvgPkg')}</th>
            <th className="text-left py-2 font-medium">{t('callAgainPage.colLastCalled')}</th>
            <th className="text-left py-2 font-medium">{t('callAgainPage.colDue')}</th>
            <th className="text-right py-2 font-medium pr-2">{t('callAgainPage.colAction')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const due = r.in_call_again_until ? new Date(r.in_call_again_until) : null;
            const ready = due ? isPast(due) : true;
            return (
              <tr key={`${r.list_id}-${r.customer_phone}`} className={cn('border-b last:border-0', ready && 'bg-purple-50/50')}>
                <td className="py-2.5 align-top">
                  <div className="font-medium">{r.customer_name || '—'}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{r.customer_phone}</div>
                </td>
                {showAgent && (
                  <td className="py-2.5 align-top">{r.assigned_agent_name || '—'}</td>
                )}
                <td className="py-2.5 align-top text-[12px] text-muted-foreground">
                  {r.prediction_segment_lists?.name || '—'}
                </td>
                <td className="py-2.5 align-top text-right tabular-nums font-mono">
                  <div className="font-semibold">{formatEur(r.lifetime_value)}</div>
                  <div className="text-[10px] text-muted-foreground">{formatLev(r.lifetime_value)}</div>
                </td>
                <td className="py-2.5 align-top text-right tabular-nums font-mono text-xs">
                  {r.avg_package_price != null ? (
                    <>
                      <div className="font-semibold">{formatEur(r.avg_package_price)}</div>
                      <div className="text-[10px] text-muted-foreground">{formatLev(r.avg_package_price)}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2.5 align-top text-[11px] text-muted-foreground whitespace-nowrap">
                  {r.last_call_at
                    ? formatDistanceToNow(new Date(r.last_call_at), { addSuffix: true })
                    : '—'}
                </td>
                <td className={cn('py-2.5 align-top text-[11px] whitespace-nowrap',
                  ready ? 'text-purple-700 font-semibold' : 'text-muted-foreground')}>
                  {due
                    ? (ready ? t('callAgainPage.readyPrefix') : '') + formatDistanceToNow(due, { addSuffix: true })
                    : t('callAgainPage.noDate')}
                </td>
                <td className="py-2.5 align-top text-right pr-2">
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                    onClick={() => navigate(`/calls?phone=${encodeURIComponent(r.customer_phone)}`)}
                  >
                    <Phone className="h-3 w-3" /> {t('callAgainPage.callNow')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Mobile: cards (every field visible, no horizontal scroll) */}
    <div className="md:hidden space-y-2">
      {rows.map(r => {
        const due = r.in_call_again_until ? new Date(r.in_call_again_until) : null;
        const ready = due ? isPast(due) : true;
        return (
          <MobileCard key={`${r.list_id}-${r.customer_phone}`} className={cn(ready && 'bg-purple-50/50')}>
            <MobileCardHeader
              title={r.customer_name || '—'}
              subtitle={r.customer_phone}
              badge={
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap',
                  ready ? 'bg-purple-100 text-purple-700' : 'bg-muted text-muted-foreground')}>
                  {due ? (ready ? t('callAgainPage.ready') : formatDistanceToNow(due, { addSuffix: true })) : t('callAgainPage.noDate')}
                </span>
              }
            />
            {showAgent && <MobileCardField label={t('callAgainPage.colAgent')} value={r.assigned_agent_name || '—'} />}
            <MobileCardField label={t('callAgainPage.colSourceList')} value={r.prediction_segment_lists?.name || '—'} />
            <MobileCardField
              label={t('callAgainPage.lifetimeShort')}
              value={<>{formatEur(r.lifetime_value)} <span className="text-muted-foreground font-normal">({formatLev(r.lifetime_value)})</span></>}
            />
            <MobileCardField
              label={t('callAgainPage.colAvgPkg')}
              value={r.avg_package_price != null
                ? <>{formatEur(r.avg_package_price)} <span className="text-muted-foreground font-normal">({formatLev(r.avg_package_price)})</span></>
                : '—'}
            />
            <MobileCardField
              label={t('callAgainPage.colLastCalled')}
              value={r.last_call_at ? formatDistanceToNow(new Date(r.last_call_at), { addSuffix: true }) : '—'}
            />
            <MobileCardActions>
              <Button
                size="sm" variant="outline" className="gap-1"
                onClick={() => navigate(`/calls?phone=${encodeURIComponent(r.customer_phone)}`)}
              >
                <Phone className="h-3.5 w-3.5" /> {t('callAgainPage.callNow')}
              </Button>
            </MobileCardActions>
          </MobileCard>
        );
      })}
    </div>
    </>
  );
}
