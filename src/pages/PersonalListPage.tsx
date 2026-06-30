import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatDistanceToNow } from '@/i18n/dates';
import { Lock, AlertTriangle, ArrowRight, Phone, Loader2, Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import {
  apiGetMyPersonalHolds, apiGetExpiringHolds,
  apiReleasePersonalHold, apiExtendPersonalHold, apiGetAppSettings,
  type PersonalHold,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { MobileCard, MobileCardHeader, MobileCardField, MobileCardActions } from '@/components/ui/mobile-card';
import { cn } from '@/lib/utils';

export default function PersonalListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdminOrManager = user?.isAdmin || user?.isManager;
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get('expiring') === '1' ? 'expiring' : 'mine';
  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: apiGetAppSettings,
    staleTime: 5 * 60_000,
  });
  const cap = appSettings?.personal_list_max_holds ?? 50;
  return (
    <AppLayout title={t('nav.personalList')}>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Lock className="h-6 w-6" /> {t('nav.personalList')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('personalListPage.intro', { count: cap })}
            </p>
          </div>
        </div>

        <Tabs defaultValue={initialTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="mine" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> {t('personalListPage.myHolds')}
            </TabsTrigger>
            {isAdminOrManager && (
              <TabsTrigger value="expiring" className="gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> {t('personalListPage.expiringReview')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="mine"><MyHoldsTab /></TabsContent>
          {isAdminOrManager && <TabsContent value="expiring"><ExpiringTab /></TabsContent>}
        </Tabs>
      </div>
    </AppLayout>
  );
}

function MyHoldsTab() {
  const { t } = useTranslation();
  const { data: holds, isLoading } = useQuery({
    queryKey: ['my-personal-holds'],
    queryFn: apiGetMyPersonalHolds,
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('personalListPage.yourList')}</CardTitle></CardHeader>
      <CardContent className="px-3 sm:px-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>
        ) : !holds?.length ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            <Plus className="h-6 w-6 mx-auto mb-2 opacity-40" />
            {t('personalListPage.noneClaimed')}
          </div>
        ) : (
          <HoldsTable holds={holds} mode="mine" />
        )}
      </CardContent>
    </Card>
  );
}

function ExpiringTab() {
  const { t } = useTranslation();
  const { data: holds, isLoading } = useQuery({
    queryKey: ['expiring-personal-holds'],
    queryFn: apiGetExpiringHolds,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {t('personalListPage.expiredAwaiting')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>
        ) : !holds?.length ? (
          <EmptyState
            title={t('personalListPage.noExpired')}
            description={t('personalListPage.noExpiredDesc')}
            size="sm"
          />
        ) : (
          <HoldsTable holds={holds} mode="admin" />
        )}
      </CardContent>
    </Card>
  );
}

function HoldsTable({ holds, mode }: { holds: PersonalHold[]; mode: 'mine' | 'admin' }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-personal-holds'] });
    qc.invalidateQueries({ queryKey: ['expiring-personal-holds'] });
    qc.invalidateQueries({ queryKey: ['expiring-holds-count'] });
    qc.invalidateQueries({ queryKey: ['personal-hold'] });
  };

  const release = async (id: string, label: string) => {
    setBusyId(id);
    try {
      await apiReleasePersonalHold(id);
      toast({ title: mode === 'admin' ? t('personalListPage.returnedToPool') : t('personalListPage.released'), description: label });
      refresh();
    } catch (err: any) {
      toast({ title: t('personalListPage.failed'), description: err?.message, variant: 'destructive' });
    } finally { setBusyId(null); }
  };

  const extend = async (id: string, days: number) => {
    setBusyId(id);
    try {
      await apiExtendPersonalHold(id, days);
      toast({ title: t('personalListPage.extendedBy', { days }) });
      refresh();
    } catch (err: any) {
      toast({ title: t('personalListPage.failed'), description: err?.message, variant: 'destructive' });
    } finally { setBusyId(null); }
  };

  return (
    <>
    {/* Desktop: table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-2 font-medium">{t('personalListPage.colCustomer')}</th>
            {mode === 'admin' && <th className="text-left py-2 font-medium">{t('personalListPage.colAgent')}</th>}
            <th className="text-left py-2 font-medium">{t('personalListPage.colReason')}</th>
            <th className="text-left py-2 font-medium">{t('personalListPage.colClaimed')}</th>
            <th className="text-left py-2 font-medium">{t('personalListPage.colExpires')}</th>
            <th className="text-right py-2 font-medium pr-2">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {holds.map(h => {
            const expired = new Date(h.expires_at) < new Date();
            return (
              <tr key={h.id} className={cn('border-b last:border-0', expired && 'bg-red-50')}>
                <td className="py-2.5 align-top">
                  <button
                    onClick={() => navigate(`/calls?phone=${encodeURIComponent(h.customer_phone)}`)}
                    className="text-left hover:underline"
                  >
                    <div className="font-medium">{h.customer_name || '—'}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{h.customer_phone}</div>
                  </button>
                </td>
                {mode === 'admin' && (
                  <td className="py-2.5 align-top">
                    <span className="text-sm">{h.agent_name}</span>
                  </td>
                )}
                <td className="py-2.5 max-w-[320px] align-top text-[12px] whitespace-pre-wrap">
                  {h.reason}
                  {h.follow_up_by && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {t('personalList.followUpBy', { date: formatDate(new Date(h.follow_up_by), 'd MMM yyyy') })}
                    </div>
                  )}
                </td>
                <td className="py-2.5 align-top text-[11px] text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(h.claimed_at), { addSuffix: true })}
                </td>
                <td className={cn('py-2.5 align-top text-[11px] whitespace-nowrap',
                  expired ? 'text-red-700 font-semibold' : 'text-muted-foreground')}>
                  {expired ? t('personalListPage.expiredPrefix') : ''}{formatDistanceToNow(new Date(h.expires_at), { addSuffix: true })}
                </td>
                <td className="py-2.5 align-top text-right pr-2">
                  <div className="inline-flex gap-1.5">
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                      onClick={() => navigate(`/calls?phone=${encodeURIComponent(h.customer_phone)}`)}
                    >
                      <Phone className="h-3 w-3" /> {t('personalListPage.open')}
                    </Button>
                    {mode === 'admin' && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        disabled={busyId === h.id}
                        onClick={() => extend(h.id, 5)}
                      >
                        +5d
                      </Button>
                    )}
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-rose-700 hover:bg-rose-50"
                      disabled={busyId === h.id}
                      onClick={() => release(h.id, h.customer_name || h.customer_phone)}
                    >
                      {busyId === h.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                      {mode === 'admin' ? t('personalListPage.returnToPool') : t('personalListPage.release')}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Mobile: cards */}
    <div className="md:hidden space-y-2">
      {holds.map(h => {
        const expired = new Date(h.expires_at) < new Date();
        return (
          <MobileCard key={h.id} className={cn(expired && 'bg-red-50')}>
            <MobileCardHeader
              title={
                <button
                  onClick={() => navigate(`/calls?phone=${encodeURIComponent(h.customer_phone)}`)}
                  className="text-left hover:underline"
                >
                  {h.customer_name || '—'}
                </button>
              }
              subtitle={h.customer_phone}
              badge={expired
                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700 whitespace-nowrap">{t('personalListPage.expired')}</span>
                : undefined}
            />
            {mode === 'admin' && <MobileCardField label={t('personalListPage.colAgent')} value={h.agent_name} />}
            <MobileCardField
              label={t('personalListPage.colReason')}
              value={
                <span className="whitespace-pre-wrap">
                  {h.reason}
                  {h.follow_up_by && (
                    <span className="block text-[10px] text-muted-foreground mt-1">
                      {t('personalList.followUpBy', { date: formatDate(new Date(h.follow_up_by), 'd MMM yyyy') })}
                    </span>
                  )}
                </span>
              }
            />
            <MobileCardField label={t('personalListPage.colClaimed')} value={formatDistanceToNow(new Date(h.claimed_at), { addSuffix: true })} />
            <MobileCardField
              label={t('personalListPage.colExpires')}
              value={<span className={cn(expired && 'text-red-700 font-semibold')}>{formatDistanceToNow(new Date(h.expires_at), { addSuffix: true })}</span>}
            />
            <MobileCardActions>
              <Button
                size="sm" variant="outline" className="gap-1"
                onClick={() => navigate(`/calls?phone=${encodeURIComponent(h.customer_phone)}`)}
              >
                <Phone className="h-3.5 w-3.5" /> {t('personalListPage.open')}
              </Button>
              {mode === 'admin' && (
                <Button size="sm" variant="outline" disabled={busyId === h.id} onClick={() => extend(h.id, 5)}>
                  +5d
                </Button>
              )}
              <Button
                size="sm" variant="outline" className="gap-1 text-rose-700 hover:bg-rose-50"
                disabled={busyId === h.id}
                onClick={() => release(h.id, h.customer_name || h.customer_phone)}
              >
                {busyId === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                {mode === 'admin' ? t('personalListPage.returnShort') : t('personalListPage.release')}
              </Button>
            </MobileCardActions>
          </MobileCard>
        );
      })}
    </div>
    </>
  );
}
