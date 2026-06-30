// Settings → Leaderboard (admin/manager). Three sections:
//   1. Today's roster — who appears on the TV board today (hides non-working agents)
//   2. Bonus rules — tiered daily bonus per metric (confirmed / avg value / answer rate)
//   3. TV access — the shareable /tv/leaderboard?key=… link + token rotation
// The board itself is the separate daily game layer; it does NOT touch payroll.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trophy, Loader2, Copy, RefreshCw, Trash2, Plus, Tv, Users, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  apiGetAgents,
  apiGetLeaderboardAdmin, apiSetLeaderboardRoster, apiSetLeaderboardRule, apiManageLeaderboardToken,
  type LeaderboardBonusRule, type LeaderboardMetric, type LeaderboardTier, type LeaderboardMode,
} from '@/lib/api';

const METRIC_META: Record<LeaderboardMetric, { label: string; hint: string; unit: string }> = {
  confirmed_count: { label: 'Order milestones', hint: 'Bonus by number of confirmed orders today', unit: 'orders' },
  avg_order_value: { label: 'Average order value', hint: 'Bonus by avg order €. Applies ONLY to agents with 10+ orders.', unit: '€' },
  conversion_rate: { label: 'Conversion (unused)', hint: 'Not used for bonus', unit: '%' },
  revenue_target: { label: 'Team daily revenue targets', hint: 'Bonus when the TEAM’s combined daily revenue crosses each target (€) — shared by every active agent.', unit: '€' },
};
// Which bonus metrics each motion uses (per-package commission is automatic on both).
const METRICS_BY_MODE: Record<LeaderboardMode, LeaderboardMetric[]> = {
  prediction: ['revenue_target'],
  pending: ['confirmed_count', 'avg_order_value'],
};

interface AgentRow { user_id: string; full_name: string; email: string; roles: string[] }

export function LeaderboardTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<LeaderboardMode>('prediction');

  const agentsQ = useQuery({ queryKey: ['lb-agents'], queryFn: apiGetAgents });
  const cfgQ = useQuery({ queryKey: ['lb-admin', mode], queryFn: () => apiGetLeaderboardAdmin(mode) });

  // Only call-agents are eligible for the board (admins/managers never earn).
  const agents: AgentRow[] = useMemo(
    () => (agentsQ.data || []).filter((a: AgentRow) =>
      a.roles?.some((r) => ['agent', 'pending_agent', 'prediction_agent'].includes(r))),
    [agentsQ.data],
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ['lb-admin', mode] });

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" /> Live TV Leaderboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Two boards: <strong>Prediction</strong> (cold lists → daily revenue targets) and <strong>Pending</strong>
            (warm orders → conversion). Neither affects the real paid commission.
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border bg-muted/40 p-1">
          <Button variant={mode === 'prediction' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('prediction')}>Prediction</Button>
          <Button variant={mode === 'pending' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('pending')}>Pending</Button>
        </div>
      </div>

      {(cfgQ.isLoading || agentsQ.isLoading) ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : cfgQ.error ? (
        <div className="py-10 text-destructive">Failed to load leaderboard settings.</div>
      ) : (
        <>
          <RosterSection mode={mode} agents={agents} roster={cfgQ.data!.roster} day={cfgQ.data!.roster_date}
            onSaved={invalidate} toast={toast} />
          <RulesSection mode={mode} rules={cfgQ.data!.rules} onSaved={invalidate} toast={toast} />
          <TokensSection tokens={cfgQ.data!.tokens} onChanged={invalidate} toast={toast} />
        </>
      )}
    </div>
  );
}

// ── 1. Roster ────────────────────────────────────────────────────────────────
function RosterSection({ mode, agents, roster, day, onSaved, toast }: {
  mode: LeaderboardMode; agents: AgentRow[]; roster: string[]; day: string; onSaved: () => void; toast: any;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(roster));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSelected(new Set(roster)); }, [roster]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await apiSetLeaderboardRoster(mode, [...selected]);
      toast({ title: 'Roster saved', description: `${selected.size} agent(s) on today's ${mode} board.` });
      onSaved();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Today's {mode} roster <span className="text-xs text-muted-foreground">({day})</span></h3>
          <p className="text-sm text-muted-foreground">Only the selected agents appear on the {mode} board today. Leave empty to auto-show everyone active.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(agents.map((a) => a.user_id)))}>All</Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>None</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Save roster</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {agents.map((a) => {
          const on = selected.has(a.user_id);
          return (
            <button key={a.user_id} type="button" onClick={() => toggle(a.user_id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${on ? 'border-primary bg-primary/10' : 'bg-card hover:bg-muted/50'}`}>
              <span className="truncate">{a.full_name}</span>
              <Switch checked={on} onClick={(e) => e.stopPropagation()} onCheckedChange={() => toggle(a.user_id)} />
            </button>
          );
        })}
        {agents.length === 0 && <div className="col-span-full py-6 text-center text-sm text-muted-foreground">No call agents found.</div>}
      </div>
    </section>
  );
}

// ── 2. Bonus rules ───────────────────────────────────────────────────────────
function RulesSection({ mode, rules, onSaved, toast }: { mode: LeaderboardMode; rules: LeaderboardBonusRule[]; onSaved: () => void; toast: any }) {
  const desc = mode === 'prediction'
    ? <>Total = automatic <strong>per-package commission</strong> (€1/€2/€3 per package, reversed on returns) <strong>plus</strong> a shared <strong>team-target</strong> bonus: when the whole team's combined daily revenue crosses a target, <strong>every active agent</strong> earns that tier. No conversion/avg bonus — cold lists can't aim for %.</>
    : <>Total = automatic <strong>per-package commission</strong> (€1/€2/€3 per package, reversed on returns) <strong>plus</strong> these milestone bonuses (highest tier reached). The average-order bonus only applies to agents with <strong>10+ orders</strong>.</>;
  const metrics = METRICS_BY_MODE[mode];
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-medium flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" /> {mode === 'prediction' ? 'Revenue targets' : 'Daily bonus tiers'}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <div className={`grid gap-3 ${metrics.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {metrics.map((metric) => {
          const rule = rules.find((r) => r.metric === metric) || { metric, tiers: [], is_active: true };
          return <RuleCard key={metric} mode={mode} rule={rule} onSaved={onSaved} toast={toast} />;
        })}
      </div>
    </section>
  );
}

function RuleCard({ mode, rule, onSaved, toast }: { mode: LeaderboardMode; rule: LeaderboardBonusRule; onSaved: () => void; toast: any }) {
  const meta = METRIC_META[rule.metric];
  const [tiers, setTiers] = useState<LeaderboardTier[]>(rule.tiers);
  const [active, setActive] = useState<boolean>(rule.is_active);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTiers(rule.tiers); setActive(rule.is_active); }, [rule]);

  const upd = (i: number, field: 'min' | 'bonus', v: string) =>
    setTiers((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: Number(v) || 0 } : t));
  const addTier = () => setTiers((prev) => [...prev, { min: 0, bonus: 0 }]);
  const delTier = (i: number) => setTiers((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      const sorted = [...tiers].sort((a, b) => a.min - b.min);
      await apiSetLeaderboardRule(mode, { metric: rule.metric, tiers: sorted, is_active: active });
      toast({ title: 'Saved', description: meta.label });
      onSaved();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className={`rounded-lg border bg-card p-3 ${active ? '' : 'opacity-60'}`}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">{meta.label}</div>
          <div className="text-xs text-muted-foreground">{meta.hint}</div>
        </div>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>
      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>≥ {meta.unit === '€' ? 'value (€)' : meta.unit === '%' ? 'rate (%)' : meta.unit}</span>
          <span>bonus (€)</span><span />
        </div>
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <Input type="number" value={t.min} onChange={(e) => upd(i, 'min', e.target.value)} className="h-8" />
            <Input type="number" value={t.bonus} onChange={(e) => upd(i, 'bonus', e.target.value)} className="h-8" />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => delTier(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full" onClick={addTier}><Plus className="h-4 w-4 mr-1" /> Add tier</Button>
      </div>
      <Button size="sm" className="mt-3 w-full" onClick={save} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Save
      </Button>
    </div>
  );
}

// ── 3. TV access tokens ──────────────────────────────────────────────────────
function TokensSection({ tokens, onChanged, toast }: { tokens: any[]; onChanged: () => void; toast: any }) {
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const act = async (body: Parameters<typeof apiManageLeaderboardToken>[0]) => {
    setBusy(true);
    try { await apiManageLeaderboardToken(body); onChanged(); }
    catch (e: any) { toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const copy = (url: string) => { navigator.clipboard?.writeText(url); toast({ title: 'Copied', description: 'TV link copied to clipboard.' }); };

  const active = tokens.filter((t) => t.is_active);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium flex items-center gap-2"><Tv className="h-4 w-4 text-primary" /> TV access link</h3>
          <p className="text-sm text-muted-foreground">Open this URL on the office TV (no login needed). Rotate to instantly invalidate the old link.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => act({ action: 'rotate', label: 'Office TV' })} disabled={busy}>
            <RefreshCw className="h-4 w-4 mr-1" /> Rotate
          </Button>
          <Button size="sm" onClick={() => act({ action: 'create', label: 'TV' })} disabled={busy}>
            <Plus className="h-4 w-4 mr-1" /> New link
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {active.length === 0 && <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">No active link. Create one above.</div>}
        {active.map((t) => {
          const url = `${origin}/tv/leaderboard?key=${t.token}`;
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border bg-card p-2">
              <Badge variant="secondary" className="shrink-0">{t.label || 'TV'}</Badge>
              <Input readOnly value={url} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copy(url)}><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => act({ action: 'revoke', id: t.id })} disabled={busy}><Trash2 className="h-4 w-4" /></Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
