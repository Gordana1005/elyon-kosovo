import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarDays, Loader2, PhoneCall, Clock, Users, Percent } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { apiGetAgentActivity, apiGetAgents } from '@/lib/api';
import { AgentTimeline } from '@/components/activity/AgentTimeline';
import { KpiCard } from '@/components/insights/KpiCard';
import { fmtDuration } from '@/lib/design-utils';

// ── Call timeline (formerly the standalone "Agent Activity" page) ──
// Embedded in the Insights → Call Activity tab. This is a REPORTING view of
// call telemetry; it is NOT the /calls agent dialer.

const TZ = 'Europe/Skopje';

function skopjeTodayStr(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function parseLocal(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function CallActivityTimeline() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isManager = !!(user?.isAdmin || user?.isManager);

  const todayStr = skopjeTodayStr();
  const [date, setDate] = useState<string>(todayStr);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [calOpen, setCalOpen] = useState(false);

  const isToday = date === todayStr;

  const { data: agents } = useQuery({
    queryKey: ['agents-for-activity'],
    queryFn: apiGetAgents,
    enabled: isManager,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agent-activity', date, agentFilter],
    queryFn: () => apiGetAgentActivity({ date, agent_id: agentFilter !== 'all' ? agentFilter : undefined }),
    refetchInterval: isToday ? 30_000 : false,
  });

  const kpis = useMemo(() => {
    const rows = data?.agents || [];
    let calls = 0, answered = 0, talk = 0;
    for (const a of rows) { calls += a.totals.calls; answered += a.totals.answered; talk += a.totals.talk_seconds; }
    return {
      agents: rows.length,
      calls,
      talk,
      answerRate: calls ? Math.round((answered / calls) * 100) : 0,
    };
  }, [data]);

  const goPrev = () => setDate((d) => addDays(d, -1));
  const goNext = () => { if (!isToday) setDate((d) => addDays(d, 1)); };

  return (
    <div className="space-y-4">
      {/* Day navigator */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={goPrev} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 min-w-[180px] justify-start gap-2 text-sm font-medium">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                {format(parseLocal(date), 'EEE, d MMM yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={parseLocal(date)}
                onSelect={(d) => { if (d) { setDate(ymd(d)); setCalOpen(false); } }}
                disabled={(d) => d > parseLocal(todayStr)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={goNext} disabled={isToday} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setDate(todayStr)}>{t('callTimeline.today')}</Button>
          )}
        </div>

        {isManager && (
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-9 w-48 text-sm">
              <SelectValue placeholder={t('callTimeline.allAgents')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('callTimeline.allAgents')}</SelectItem>
              {(agents || []).map((a: any) => (
                <SelectItem key={a.user_id} value={a.user_id}>{a.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Day KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Users} label={t('callTimeline.agents')} value={String(kpis.agents)} />
        <KpiCard icon={PhoneCall} label={t('callTimeline.calls')} value={String(kpis.calls)} />
        <KpiCard icon={Clock} label={t('callTimeline.talkTime')} value={fmtDuration(kpis.talk)} />
        <KpiCard icon={Percent} label={t('callTimeline.answerRate')} value={`${kpis.answerRate}%`} />
      </div>

      {/* Timeline */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Call timeline
              <span className="ml-2 font-normal text-muted-foreground">
                {isToday ? 'today · live' : format(parseLocal(date), 'd MMM yyyy')}
              </span>
            </h2>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {isError ? (
            <div className="py-10 text-center text-sm text-destructive">{t('callTimeline.failedLoad')}</div>
          ) : isLoading && !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : data ? (
            <AgentTimeline data={data} isToday={isToday} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
