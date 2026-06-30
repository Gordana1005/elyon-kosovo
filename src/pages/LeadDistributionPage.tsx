import { useState, useEffect } from 'react';
import { apiErrorText } from '@/i18n/apiErrors';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiGetLeadDistributionConfig, apiUpdateLeadDistributionConfig, apiAutoAssignLeads, apiGetOnlineAgents } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';
import {
  Shuffle, Scale, Star, Loader2, Play, Settings2,
  Users, Zap, CheckCircle2, AlertTriangle,
} from 'lucide-react';

interface DistConfig {
  id: string;
  strategy: string;
  is_active: boolean;
  max_leads_per_agent: number;
  priority_threshold: number;
}

interface AgentLoad {
  user_id: string;
  full_name: string;
  active_leads: number;
  is_online: boolean;
}

// Labels/descriptions resolved at render via t().
const STRATEGIES = [
  { value: 'round_robin', labelKey: 'leadDist.roundRobin', icon: Shuffle, descKey: 'leadDist.roundRobinDesc' },
  { value: 'load_balance', labelKey: 'leadDist.loadBalance', icon: Scale, descKey: 'leadDist.loadBalanceDesc' },
  { value: 'priority', labelKey: 'leadDist.priority', icon: Star, descKey: 'leadDist.priorityDesc' },
];

export default function LeadDistributionPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setConfig] = useState<DistConfig | null>(null);
  const [agents, setAgents] = useState<AgentLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ assigned: number; message?: string } | null>(null);

  // Local form state
  const [strategy, setStrategy] = useState('round_robin');
  const [isActive, setIsActive] = useState(false);
  const [maxLeads, setMaxLeads] = useState('50');
  const [priorityThreshold, setPriorityThreshold] = useState('500');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cfg, agentData] = await Promise.all([
        apiGetLeadDistributionConfig(),
        apiGetOnlineAgents().catch(() => []),
      ]);
      setConfig(cfg);
      setStrategy(cfg.strategy);
      setIsActive(cfg.is_active);
      setMaxLeads(String(cfg.max_leads_per_agent));
      setPriorityThreshold(String(cfg.priority_threshold));
      setAgents(agentData || []);
    } catch (err: any) {
      toast({ title: t('leadDist.errorLoadingConfig'), description: apiErrorText(err), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiUpdateLeadDistributionConfig({
        strategy,
        is_active: isActive,
        max_leads_per_agent: parseInt(maxLeads) || 50,
        priority_threshold: parseFloat(priorityThreshold) || 500,
      });
      toast({ title: t('leadDist.configSaved') });
      fetchData();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleRunDistribution = async () => {
    setRunning(true);
    setLastResult(null);
    try {
      const result = await apiAutoAssignLeads();
      setLastResult(result);
      toast({ title: t('leadDist.distributionComplete'), description: t('leadDist.distributionCompleteDesc', { count: result.assigned, strategy: result.strategy }) });
      fetchData();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally { setRunning(false); }
  };

  if (loading) {
    return (
      <AppLayout title={t('nav.leadDistribution')}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const onlineAgents = agents.filter(a => a.is_online);

  return (
    <AppLayout title={t('titles.leadDistributionEngine')}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{t('titles.leadDistributionEngine')}</h1>
              <p className="text-xs text-muted-foreground">{t('leadDist.configureRules')}</p>
            </div>
          </div>
          <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
            {isActive ? t('leadDist.engineActive') : t('leadDist.engineDisabled')}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuration */}
          <div className="lg:col-span-2 space-y-6">
            {/* Strategy Selection */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings2 className="h-4 w-4" /> {t('leadDist.strategy')}
                </CardTitle>
                <CardDescription>{t('leadDist.chooseHow')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {STRATEGIES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setStrategy(s.value)}
                      className={cn(
                        'flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all',
                        strategy === s.value
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/30 hover:bg-muted/30'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <s.icon className={cn('h-4 w-4', strategy === s.value ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="text-sm font-semibold">{t(s.labelKey)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t(s.descKey)}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Settings */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">{t('leadDist.configuration')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">{t('leadDist.enableAuto')}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('leadDist.enableAutoDesc')}</p>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">{t('leadDist.maxLeads')}</Label>
                    <Input type="number" value={maxLeads} onChange={e => setMaxLeads(e.target.value)} min="1" max="500" className="mt-1" />
                    <p className="text-[10px] text-muted-foreground mt-1">{t('leadDist.maxLeadsDesc')}</p>
                  </div>
                  {strategy === 'priority' && (
                    <div>
                      <Label className="text-xs">{t('leadDist.highValue')}</Label>
                      <Input type="number" value={priorityThreshold} onChange={e => setPriorityThreshold(e.target.value)} min="0" className="mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-1">{t('leadDist.highValueDesc')}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    {t('leadDist.saveConfig')}
                  </Button>
                  <Button variant="outline" onClick={handleRunDistribution} disabled={running} className="gap-2">
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {t('leadDist.runNow')}
                  </Button>
                </div>

                {lastResult && (
                  <div className={cn(
                    'rounded-lg border p-3 text-sm',
                    lastResult.assigned > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
                  )}>
                    {lastResult.assigned > 0 ? (
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Successfully assigned {lastResult.assigned} leads
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        {lastResult.message || 'No leads to assign'}
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agent Load Sidebar */}
          <div className="space-y-4">
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" /> {t('leadDist.agentWorkload')}
                </CardTitle>
                <CardDescription>{t('leadDist.agentsAvailable', { count: onlineAgents.length })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {agents.length === 0 ? (
                  <EmptyState
                    icon={<Users className="h-4 w-4" />}
                    title={t('leadDist.noAgents')}
                    size="sm"
                    className="border-0 bg-transparent py-3"
                  />
                ) : (
                  agents.sort((a, b) => a.active_leads - b.active_leads).map(agent => {
                    const loadPercent = Math.min((agent.active_leads / (parseInt(maxLeads) || 50)) * 100, 100);
                    const isAtCapacity = agent.active_leads >= (parseInt(maxLeads) || 50);
                    return (
                      <div key={agent.user_id} className={cn('rounded-lg border p-3 space-y-2', !agent.is_online && 'opacity-50')}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={cn('h-2 w-2 rounded-full', agent.is_online ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                            <span className="text-xs font-medium truncate max-w-[120px]">{agent.full_name}</span>
                          </div>
                          <Badge variant={isAtCapacity ? 'destructive' : 'secondary'} className="text-[10px]">
                            {agent.active_leads} / {maxLeads}
                          </Badge>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', isAtCapacity ? 'bg-destructive' : loadPercent > 70 ? 'bg-amber-500' : 'bg-primary')}
                            style={{ width: `${loadPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
