import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Phone, ShoppingBag } from 'lucide-react';
import { SmartPagination } from '@/components/SmartPagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { MobileCard, MobileCardActions, MobileCardField, MobileCardHeader } from '@/components/ui/mobile-card';
import { statusLabel } from '@/types';
import { formatDistanceToNow } from '@/i18n/dates';
import { formatEur, formatLev } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { apiGetAppSettings, apiGetMyOrders, type MyOrderRow, type MyOrdersTab } from '@/lib/api';

const TABS: MyOrdersTab[] = ['confirmed', 'shipped', 'paid', 'returned'];

// How urgent an unpaid delivery looks. Mirrors the nightly chase job
// (notify_unpaid_shipped_orders): amber from the day the agent starts being
// pinged about it, red at double that age.
type AgeTone = 'normal' | 'warn' | 'urgent';

const TONE_TEXT: Record<AgeTone, string> = {
  normal: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400 font-medium',
  urgent: 'text-red-600 dark:text-red-400 font-semibold',
};

const TONE_BADGE: Record<AgeTone, string> = {
  normal: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  urgent: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const EVENT_FIELD: Record<MyOrdersTab, keyof MyOrderRow> = {
  confirmed: 'confirmed_at',
  shipped: 'shipped_at',
  paid: 'paid_at',
  returned: 'returned_at',
};

// Display-only grouping (+359 88 812 3456). NEVER used for matching — the raw
// E.164 value is what the Call button passes to /calls.
function prettyPhone(p: string | null): string {
  const s = (p || '').trim();
  const m = s.match(/^(\+\d{3})(\d{2})(\d{3})(\d+)$/);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : s || '—';
}

function productSummary(o: MyOrderRow): string {
  if (o.order_items?.length) {
    return o.order_items.map(it => `${it.quantity}× ${it.product_name}`).join(', ');
  }
  if (o.product_name) {
    return `${(o.quantity || 1) > 1 ? `${o.quantity}× ` : ''}${o.product_name}`;
  }
  return '—';
}

export function MyOrdersSection(
  { period, date, from, to }: { period: 'today' | 'month' | 'custom'; date: string; from?: string; to?: string },
) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<MyOrdersTab>('confirmed');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [tab, period, date, from, to]);

  // `/?tab=shipped` is where the unpaid-delivery notification lands the agent.
  // An effect (not just the initial state) because agents usually already sit on
  // the dashboard when the ping arrives, so the component never remounts.
  useEffect(() => {
    const q = searchParams.get('tab');
    if (q && (TABS as string[]).includes(q)) setTab(q as MyOrdersTab);
  }, [searchParams]);

  // Chase threshold, so the colours always match whatever the operator set in
  // Settings. Same query key as PersonalListButton → one shared cached request.
  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: apiGetAppSettings,
    staleTime: 5 * 60_000,
  });
  const chaseDaysRaw = Number(appSettings?.unpaid_chase_days);
  const chaseDays = Number.isFinite(chaseDaysRaw) && chaseDaysRaw > 0 ? Math.floor(chaseDaysRaw) : 3;

  // Custom range needs both bounds before it can query.
  const rangeReady = period !== 'custom' || (!!from && !!to);

  const { data, isLoading } = useQuery({
    queryKey: ['my-orders', tab, period, date, from, to, page],
    queryFn: () => apiGetMyOrders({ tab, period, date, from, to, page }),
    enabled: rangeReady,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const rows = data?.orders || [];
  const counts = data?.counts;
  const limit = data?.limit || 20;
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / limit));

  const dateCell = (o: MyOrderRow): { text: string; tone: AgeTone } => {
    if (tab === 'shipped') {
      // Payment-chase list: how long has this delivery been out unpaid?
      if (!o.shipped_at) return { text: '—', tone: 'normal' };
      const days = Math.floor((Date.now() - new Date(o.shipped_at).getTime()) / 86_400_000);
      return {
        text: days <= 0 ? t('dashboard.shippedToday') : t('dashboard.shippedDaysAgo', { count: days }),
        tone: days >= chaseDays * 2 ? 'urgent' : days >= chaseDays ? 'warn' : 'normal',
      };
    }
    const v = o[EVENT_FIELD[tab]] as string | null;
    return { text: v ? formatDistanceToNow(v, { addSuffix: true }) : '—', tone: 'normal' };
  };

  const callButton = (o: MyOrderRow, compact: boolean) => (
    <Button
      size="sm" variant="outline" className={compact ? 'h-7 text-[11px] gap-1' : 'gap-1'}
      disabled={!o.customer_phone}
      onClick={() => navigate(`/calls?phone=${encodeURIComponent(o.customer_phone || '')}`)}
    >
      <Phone className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> {t('dashboard.callNow')}
    </Button>
  );

  return (
    <Card className="border-none shadow-sm mb-6">
      <CardHeader className="pb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between space-y-0">
        <CardTitle className="text-sm font-semibold text-card-foreground flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" /> {t('dashboard.myOrders')}
        </CardTitle>
        <Tabs value={tab} onValueChange={v => setTab(v as MyOrdersTab)}>
          <TabsList className="h-8">
            {TABS.map(s => (
              <TabsTrigger key={s} value={s} className="text-xs px-2 sm:px-2.5 h-7 gap-1">
                {statusLabel(s)}
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {counts?.[s] ?? 0}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        {isLoading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-5 w-5" />}
            title={tab === 'shipped' ? t('dashboard.noShippedOrders') : t('dashboard.noOrdersInTab')}
            size="sm"
            className="border-0 bg-transparent py-8"
          />
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 font-medium">{t('dashboard.colClient')}</th>
                    <th className="text-left py-2 font-medium">{t('dashboard.colProduct')}</th>
                    <th className="text-right py-2 font-medium">{t('dashboard.colPrice')}</th>
                    <th className="text-left py-2 font-medium pl-4">{t('dashboard.colDate')}</th>
                    <th className="text-right py-2 font-medium pr-2">{t('dashboard.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(o => {
                    const age = dateCell(o);
                    return (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2.5 align-top">
                        <div className="font-medium">{o.customer_name || '—'}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{prettyPhone(o.customer_phone)}</div>
                      </td>
                      <td className="py-2.5 align-top text-[12px] max-w-[260px]">
                        {productSummary(o)}
                        {tab === 'returned' && o.return_reason && (
                          <div className="text-[11px] text-destructive/80 mt-0.5">
                            {t('dashboard.returnReasonLabel')}: {t(`returnReason.${o.return_reason}`)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 align-top text-right tabular-nums font-mono">
                        <div className="font-semibold">{formatEur(o.price)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatLev(o.price)}</div>
                      </td>
                      <td
                        className={cn('py-2.5 align-top text-[11px] whitespace-nowrap pl-4', TONE_TEXT[age.tone])}
                        title={age.tone === 'normal' ? undefined : t('dashboard.chaseOverdue')}
                      >
                        {age.text}
                      </td>
                      <td className="py-2.5 align-top text-right pr-2">{callButton(o, true)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards (no horizontal scroll) */}
            <div className="md:hidden space-y-2">
              {rows.map(o => {
                const age = dateCell(o);
                return (
                <MobileCard key={o.id}>
                  <MobileCardHeader
                    title={o.customer_name || '—'}
                    subtitle={prettyPhone(o.customer_phone)}
                    badge={
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap',
                        TONE_BADGE[age.tone],
                      )}>
                        {age.text}
                      </span>
                    }
                  />
                  <MobileCardField label={t('dashboard.colProduct')} value={productSummary(o)} />
                  <MobileCardField
                    label={t('dashboard.colPrice')}
                    value={<>{formatEur(o.price)} <span className="text-muted-foreground font-normal">({formatLev(o.price)})</span></>}
                  />
                  {tab === 'returned' && o.return_reason && (
                    <MobileCardField
                      label={t('dashboard.returnReasonLabel')}
                      value={t(`returnReason.${o.return_reason}`)}
                    />
                  )}
                  <MobileCardActions>{callButton(o, false)}</MobileCardActions>
                </MobileCard>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('dashboard.pageOf', { page: data?.page || page, totalPages })}
                </span>
                <SmartPagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
