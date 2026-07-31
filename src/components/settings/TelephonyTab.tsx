import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Loader2, Gauge } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  apiGetVoipAgents, apiSetAgentCallerId, apiGetAppSettings, apiUpdateAppSettings,
  type VoipMinutesBundle,
} from '@/lib/api';

export function TelephonyTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['voip-agents'], queryFn: apiGetVoipAgents });
  const [saving, setSaving] = useState<string | null>(null);

  const agents = data?.agents || [];
  const dids = data?.dids || [];

  // ── A1 minutes bundle (commercial terms, so operator-tunable) ──
  const settings = useQuery({ queryKey: ['app-settings'], queryFn: apiGetAppSettings });
  const [bundle, setBundle] = useState<VoipMinutesBundle | null>(null);
  const [savingBundle, setSavingBundle] = useState(false);
  useEffect(() => {
    if (settings.data?.voip_minutes_bundle) setBundle(settings.data.voip_minutes_bundle);
  }, [settings.data]);

  const saveBundle = async () => {
    if (!bundle) return;
    setSavingBundle(true);
    try {
      await apiUpdateAppSettings({ voip_minutes_bundle: bundle });
      toast({ title: t('telephony.bundleSaved') });
      qc.invalidateQueries({ queryKey: ['app-settings'] });
      qc.invalidateQueries({ queryKey: ['voip-minutes'] });
    } catch (e: any) {
      toast({ title: t('telephony.failedUpdate'), description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSavingBundle(false);
    }
  };

  const setCid = async (userId: string, cid: string) => {
    setSaving(userId);
    try {
      await apiSetAgentCallerId(userId, cid);
      toast({ title: t('telephony.callerIdUpdated'), description: t('telephony.applies2min') });
      qc.invalidateQueries({ queryKey: ['voip-agents'] });
    } catch (e: any) {
      toast({ title: t('telephony.failedUpdate'), description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" /> Agent caller IDs
        </h2>
        <p className="text-sm text-muted-foreground">
          Every agent calls out from <span className="font-mono">02 423 4100</span> by default. Change an agent's
          outbound number here — it applies on the PBX within ~2 minutes. Only the company's own numbers can be selected.
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('search.colAgent')}</TableHead>
              <TableHead>{t('telephony.extension')}</TableHead>
              <TableHead>{t('telephony.outboundCallerId')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">{t('common.loading')}</TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-destructive">{t('telephony.loadFailed')}</TableCell></TableRow>
            ) : agents.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">{t('telephony.noLines')}</TableCell></TableRow>
            ) : agents.map((a) => (
              <TableRow key={a.user_id}>
                <TableCell className="font-medium">
                  {a.full_name}
                  {a.email && <div className="text-xs text-muted-foreground">{a.email}</div>}
                </TableCell>
                <TableCell className="font-mono text-sm">{a.extension}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select value={a.primary_caller_id} onValueChange={(v) => setCid(a.user_id, v)} disabled={saving === a.user_id}>
                      <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dids.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {saving === a.user_id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {bundle && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" /> {t('telephony.bundleTitle')}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('telephony.bundleDesc')}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bundle-included">{t('telephony.bundleIncluded')}</Label>
                <Input
                  id="bundle-included" type="number" min={0} max={1000000}
                  value={bundle.included_minutes}
                  onChange={(e) => setBundle({ ...bundle, included_minutes: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bundle-day">{t('telephony.bundleBillingDay')}</Label>
                <Input
                  id="bundle-day" type="number" min={1} max={28}
                  value={bundle.billing_day}
                  onChange={(e) => setBundle({ ...bundle, billing_day: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">{t('telephony.bundleBillingDayHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t('telephony.bundleMetric')}</Label>
                <Select
                  value={bundle.metric}
                  onValueChange={(v) => setBundle({ ...bundle, metric: v as 'talk' | 'total' })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="talk">{t('telephony.bundleMetricTalk')}</SelectItem>
                    <SelectItem value="total">{t('telephony.bundleMetricTotal')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bundle-warn">{t('telephony.bundleWarnPct')}</Label>
                <Input
                  id="bundle-warn" type="number" min={1} max={99}
                  value={bundle.warn_pct}
                  onChange={(e) => setBundle({ ...bundle, warn_pct: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bundle-critical">{t('telephony.bundleCriticalPct')}</Label>
                <Input
                  id="bundle-critical" type="number" min={2} max={100}
                  value={bundle.critical_pct}
                  onChange={(e) => setBundle({ ...bundle, critical_pct: Number(e.target.value) })}
                />
              </div>
            </div>
            <Button onClick={saveBundle} disabled={savingBundle}>
              {savingBundle && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {t('telephony.bundleSave')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
