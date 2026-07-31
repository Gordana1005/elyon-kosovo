import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/layouts/AppLayout';
import {
  apiGetAffiliateMe, apiGetAffiliatePortalOffers, apiUpdateAffiliatePostback,
  apiRotateOwnAffiliateKey, apiTestAffiliatePostback, apiChangeAffiliatePassword,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { apiErrorText } from '@/i18n/apiErrors';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Copy, KeyRound, Loader2, Send, Webhook, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;
const EVENTS = ['lead', 'hold', 'approve', 'cancel', 'trash', 'return'] as const;

const maskKey = (key?: string) => (key ? `${key.slice(0, 8)}…${key.slice(-6)}` : '');

export default function AffiliateIntegrationPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading } = useQuery({ queryKey: ['affiliate-portal-me'], queryFn: apiGetAffiliateMe });
  const { data: offers = [] } = useQuery({ queryKey: ['affiliate-portal-offers'], queryFn: apiGetAffiliatePortalOffers });

  const [pbUrl, setPbUrl] = useState('');
  const [pbEnabled, setPbEnabled] = useState(false);
  const [pbEvents, setPbEvents] = useState<Record<string, boolean>>({});
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof apiTestAffiliatePostback>> | null>(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  useEffect(() => {
    if (me) {
      setPbUrl(me.postback_url || '');
      setPbEnabled(me.postback_enabled);
      setPbEvents(me.postback_events || {});
    }
  }, [me?.id]);

  const onError = (err: any) =>
    toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });

  const saveMutation = useMutation({
    mutationFn: () => apiUpdateAffiliatePostback({
      postback_url: pbUrl.trim(),
      postback_enabled: pbEnabled,
      postback_events: pbEvents,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affiliate-portal-me'] });
      toast({ title: t('affiliate.postbackSaved') });
    },
    onError,
  });

  const rotateMutation = useMutation({
    mutationFn: apiRotateOwnAffiliateKey,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['affiliate-portal-me'] });
      setRotatedKey(r.api_key);
    },
    onError,
  });

  const testMutation = useMutation({
    mutationFn: apiTestAffiliatePostback,
    onSuccess: (r) => setTestResult(r),
    onError,
  });

  const passwordMutation = useMutation({
    mutationFn: () => apiChangeAffiliatePassword(pw1),
    onSuccess: () => { setPw1(''); setPw2(''); toast({ title: t('affiliate.passwordChanged') }); },
    onError,
  });
  const pwTooShort = pw1.length > 0 && pw1.length < 8;
  const pwMismatch = pw2.length > 0 && pw1 !== pw2;
  const pwValid = pw1.length >= 8 && pw1 === pw2;

  const copy = (text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: msg });
  };

  if (isLoading || !me) {
    return (
      <AppLayout title={t('affiliate.integrationTitle')}>
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </AppLayout>
    );
  }

  const offerId = offers[0]?.offer_id || 'YOUR_OFFER_ID';
  const curlSnippet = `curl -X POST "${API_BASE}/cpa/lead" \\
  -H "Content-Type: application/json" \\
  -d '{
    "key":    "${me.api_key}",
    "offer":  "${offerId}",
    "id":     "your-lead-id-1",
    "phone":  "0888123456",
    "name":   "Ivan Ivanov",
    "sub1":   "campaign-a",
    "clickid":"{your_tracker_clickid}"
  }'`;
  const phpSnippet = `$ch = curl_init('${API_BASE}/cpa/lead');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => json_encode([
    'key'     => '${me.api_key}',
    'offer'   => '${offerId}',
    'id'      => $yourLeadId,
    'phone'   => $phone,
    'name'    => $name,
    'sub1'    => $sub1,
    'clickid' => $clickid,
  ], JSON_UNESCAPED_UNICODE),
  CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 15,
]);
$res = json_decode(curl_exec($ch), true);
// $res['status'] === 'ok' → accepted; 'duplicate' → do not resend`;
  const nodeSnippet = `const res = await fetch("${API_BASE}/cpa/lead", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    key: "${me.api_key}",
    offer: "${offerId}",
    id: yourLeadId, phone, name, sub1, clickid,
  }),
});
const data = await res.json(); // {status:"ok", id:"ORD-…", uid:"…"}`;

  const macros: Array<[string, string]> = [
    ['{subid}', t('affiliate.macroSubid')],
    ['{status}', t('affiliate.macroStatus')],
    ['{stage}', t('affiliate.macroStage')],
    ['{cash}', t('affiliate.macroCash')],
    ['{hold}', t('affiliate.macroHold')],
    ['{id}', t('affiliate.macroId')],
    ['{oid}', t('affiliate.macroOid')],
    ['{reason}', t('affiliate.macroReason')],
    ['{sub1}…{sub5}', t('affiliate.macroSubs')],
    ['{stage:a|b|c|d|e|f}', t('affiliate.macroCustom')],
  ];

  return (
    <AppLayout title={t('affiliate.integrationTitle')}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* API key */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> {t('affiliate.apiKeyTitle')}</CardTitle>
            <CardDescription>{t('affiliate.apiKeyDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono bg-muted px-3 py-2 rounded flex-1">{maskKey(me.api_key)}</code>
              <Button variant="outline" size="icon" onClick={() => copy(me.api_key, t('affiliate.keyCopied'))}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => { setRotatedKey(null); setRotateOpen(true); }}>
                <KeyRound className="h-4 w-4" /> {t('affiliate.rotate')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('affiliate.endpointLabel')}: <code className="font-mono">{API_BASE}/cpa/lead</code></p>

            {/* Change password — self-service */}
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> {t('affiliate.passwordTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('affiliate.passwordDesc')}</p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                <div className="flex-1 space-y-1">
                  <Input type="password" autoComplete="new-password" placeholder={t('affiliate.newPassword')} value={pw1} onChange={(e) => setPw1(e.target.value)} />
                  {pwTooShort && <p className="text-[11px] text-muted-foreground">{t('affiliate.passwordTooShort')}</p>}
                </div>
                <div className="flex-1 space-y-1">
                  <Input type="password" autoComplete="new-password" placeholder={t('affiliate.confirmPassword')} value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  {pwMismatch && <p className="text-[11px] text-destructive">{t('affiliate.passwordMismatch')}</p>}
                </div>
                <Button onClick={() => passwordMutation.mutate()} disabled={!pwValid || passwordMutation.isPending}>
                  {passwordMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {t('affiliate.changePassword')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Postback config */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Webhook className="h-4 w-4" /> {t('affiliate.postbackTitle')}</CardTitle>
            <CardDescription>{t('affiliate.postbackDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('affiliate.postbackUrl')}</Label>
              <Input
                value={pbUrl}
                onChange={(e) => setPbUrl(e.target.value)}
                placeholder="https://your-tracker.com/postback?subid={subid}&status={status}&payout={cash}"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <p className="text-sm font-medium">{t('affiliate.postbackEnabled')}</p>
              <Switch checked={pbEnabled} onCheckedChange={setPbEnabled} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {EVENTS.map((ev) => (
                <div key={ev} className="flex items-center justify-between rounded-lg border px-2.5 py-2">
                  <span className="text-xs font-mono">{ev}</span>
                  <Switch
                    checked={pbEvents[ev] !== false}
                    onCheckedChange={(v) => setPbEvents((prev) => ({ ...prev, [ev]: v }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t('common.save')}
              </Button>
              <Button
                variant="outline" className="gap-2"
                onClick={() => { setTestResult(null); testMutation.mutate(); }}
                disabled={testMutation.isPending || !me.postback_url}
                title={!me.postback_url ? t('affiliate.testNeedsUrl') : undefined}
              >
                {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t('affiliate.testFire')}
              </Button>
            </div>
            {testResult && (
              <div className={cn(
                'rounded-lg border px-3 py-2 text-xs space-y-1',
                testResult.status === 'delivered'
                  ? 'border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/5'
                  : 'border-destructive/40 bg-destructive/5',
              )}>
                <p><span className="font-semibold">{t('affiliate.testStatus')}:</span> {testResult.status} {testResult.last_response_code ? `(HTTP ${testResult.last_response_code})` : ''}</p>
                {testResult.rendered_url && <p className="font-mono break-all text-muted-foreground">{testResult.rendered_url}</p>}
                {testResult.last_error && <p className="text-destructive">{testResult.last_error}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Snippets */}
        <Card className="shadow-sm xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('affiliate.snippetsTitle')}</CardTitle>
            <CardDescription>{t('affiliate.snippetsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[
              { label: 'curl', code: curlSnippet },
              { label: 'PHP', code: phpSnippet },
              { label: 'Node.js', code: nodeSnippet },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5">
                  <Badge variant="outline" className="text-xs">{s.label}</Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(s.code, t('affiliate.snippetCopied'))}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto font-mono bg-card">{s.code}</pre>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Macro cheat sheet */}
        <Card className="shadow-sm xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('affiliate.macrosTitle')}</CardTitle>
            <CardDescription>{t('affiliate.macrosDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {macros.map(([m, desc]) => (
                    <tr key={m} className="border-b last:border-0">
                      <td className="px-3 py-2 w-[220px]"><code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{m}</code></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rotate confirm */}
      <AlertDialog open={rotateOpen} onOpenChange={(o) => { if (!o) { setRotateOpen(false); setRotatedKey(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('affiliate.rotateTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {rotatedKey ? t('affiliate.rotateDone') : t('affiliate.rotateWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {rotatedKey && (
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-muted px-2 py-1.5 rounded flex-1 break-all">{rotatedKey}</code>
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => copy(rotatedKey, t('affiliate.keyCopied'))}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
          <AlertDialogFooter>
            {rotatedKey ? (
              <AlertDialogAction onClick={() => { setRotateOpen(false); setRotatedKey(null); }}>
                {t('common.close')}
              </AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); rotateMutation.mutate(); }}
                  disabled={rotateMutation.isPending}
                >
                  {rotateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {t('affiliate.rotate')}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
