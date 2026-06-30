import { useState } from 'react';
import { apiErrorText } from '@/i18n/apiErrors';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGetShifts, apiCreateShift, apiUpdateShift, apiDeleteShift, apiGetAgents, apiGetShiftStatistics, apiGetLoginActivity, apiGetShiftTemplates, apiCreateShiftTemplate, apiUpdateShiftTemplate, apiDeleteShiftTemplate, apiAssignTemplateWeek } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { EmptyState } from '@/components/EmptyState';
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Clock, BarChart3, Calendar as CalendarDays, Briefcase, LogIn, MoreVertical, LayoutTemplate, Users } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths, addDays } from 'date-fns';

interface ShiftAgent { user_id: string; full_name: string; }
interface Shift {
  id: string; name: string; date: string; start_time: string; end_time: string;
  agents: ShiftAgent[]; created_at: string;
}
interface ShiftTemplate {
  id: string; name: string; start_time: string; end_time: string; created_at: string; updated_at: string;
}

interface AgentShiftStats {
  user_id: string;
  full_name: string;
  total_worked_days: number;
  total_weekend_days: number;
  total_hours_scheduled: number;
  total_hours_actual: number;
  total_shifts: number;
  average_hours_per_shift: number;
  weekday_shifts: number;
  weekend_shifts: number;
}

// ── Inline Template Card with date/agent assignment ──
function TemplateCard({ template, agents, onEdit, onDelete, onAssign, isAssigning }: {
  template: ShiftTemplate;
  agents: { user_id: string; full_name: string; email: string }[];
  onEdit: () => void;
  onDelete: () => void;
  onAssign: (data: { template_id: string; agent_ids: string[]; week_start: string; days: string[] }) => void;
  isAssigning: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 1 : (day === 1 ? 0 : 8 - day);
    const nextMon = addDays(now, diff);
    return format(nextMon, 'yyyy-MM-dd');
  });
  const [days, setDays] = useState<boolean[]>([true, true, true, true, true, false, false]);

  const handleAssign = () => {
    if (selectedAgents.length === 0) return;
    const weekStartDate = new Date(weekStart + 'T12:00:00');
    const selectedDays: string[] = [];
    days.forEach((checked, i) => {
      if (checked) {
        const d = new Date(weekStartDate);
        d.setDate(d.getDate() + i);
        selectedDays.push(d.toISOString().substring(0, 10));
      }
    });
    if (selectedDays.length === 0) return;
    onAssign({ template_id: template.id, agent_ids: selectedAgents, week_start: weekStart, days: selectedDays });
  };

  const toggleAgent = (id: string) => setSelectedAgents(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  const dayLabels = [t('shifts.dayMon'), t('shifts.dayTue'), t('shifts.dayWed'), t('shifts.dayThu'), t('shifts.dayFri'), t('shifts.daySat'), t('shifts.daySun')];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button className="flex items-center gap-3 text-left flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{template.name}</p>
            <p className="text-sm text-muted-foreground">{template.start_time.substring(0, 5)} → {template.end_time.substring(0, 5)}</p>
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setExpanded(!expanded)}>
            {expanded ? t('shifts.closeBtn') : t('shifts.assign')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-2" /> {t('shifts.editTemplate')}</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common.delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
          {/* Week start + days */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t('shifts.weekStartMon')}</Label>
              <Input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="w-40 h-8 text-sm" />
            </div>
            <div className="flex gap-1">
              {dayLabels.map((label, i) => (
                <button
                  key={label}
                  onClick={() => { const next = [...days]; next[i] = !next[i]; setDays(next); }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${days[i] ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Agents */}
          <div>
            <Label className="text-xs text-muted-foreground">{t('shifts.agents')}</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {agents.map(a => (
                <button
                  key={a.user_id}
                  onClick={() => toggleAgent(a.user_id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${selectedAgents.includes(a.user_id) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                >
                  {a.full_name}
                </button>
              ))}
            </div>
          </div>

          <Button size="sm" onClick={handleAssign} disabled={isAssigning || selectedAgents.length === 0} className="w-full">
            {isAssigning ? t('shifts.assigning') : t('shifts.assignToAgents', { count: selectedAgents.length })}
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function ShiftsManagementPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [calMonth, setCalMonth] = useState(new Date());

  // Statistics filters
  const [statsFrom, setStatsFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [statsTo, setStatsTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  // Login Activity filters
  const [activityFrom, setActivityFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [activityTo, setActivityTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [activityAgent, setActivityAgent] = useState('all');
  const [activityStatus, setActivityStatus] = useState('all');

  // Shift form state
  const [formName, setFormName] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formDateEnd, setFormDateEnd] = useState('');
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('17:00');
  const [formAgents, setFormAgents] = useState<string[]>([]);

  // Template state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplStart, setTplStart] = useState('09:00');
  const [tplEnd, setTplEnd] = useState('17:00');

  const { data: shifts = [], isLoading } = useQuery<Shift[]>({
    queryKey: ['shifts', filterAgent, filterFrom, filterTo],
    queryFn: () => apiGetShifts({
      agent_id: filterAgent !== 'all' ? filterAgent : undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    }),
  });

  const { data: agents = [] } = useQuery<{ user_id: string; full_name: string; email: string }[]>({
    queryKey: ['agents'],
    queryFn: apiGetAgents,
  });

  const { data: shiftStats = [], isLoading: statsLoading } = useQuery<AgentShiftStats[]>({
    queryKey: ['shift-statistics', statsFrom, statsTo],
    queryFn: () => apiGetShiftStatistics({ from: statsFrom, to: statsTo }),
  });

  const { data: loginActivityData, isLoading: activityLoading } = useQuery<{ activities: any[]; summary: any[] }>({
    queryKey: ['login-activity', activityFrom, activityTo, activityAgent, activityStatus],
    queryFn: () => apiGetLoginActivity({
      from: activityFrom, to: activityTo,
      agent_id: activityAgent !== 'all' ? activityAgent : undefined,
      status: activityStatus !== 'all' ? activityStatus : undefined,
    }),
  });
  const loginActivities = loginActivityData?.activities || [];
  const loginSummary = loginActivityData?.summary || [];

  const { data: templates = [] } = useQuery<ShiftTemplate[]>({
    queryKey: ['shift-templates'],
    queryFn: apiGetShiftTemplates,
  });

  // Shift mutations
  const createMutation = useMutation({
    mutationFn: apiCreateShift,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); closeDialog(); toast({ title: t('shifts.shiftCreated') }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiUpdateShift(id, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); closeDialog(); toast({ title: t('shifts.shiftUpdated') }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });
  const deleteMutation = useMutation({
    mutationFn: apiDeleteShift,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); toast({ title: t('shifts.shiftDeleted') }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });

  // Template mutations
  const createTemplateMutation = useMutation({
    mutationFn: apiCreateShiftTemplate,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shift-templates'] }); closeTemplateDialog(); toast({ title: t('shifts.templateCreated') }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiUpdateShiftTemplate(id, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shift-templates'] }); queryClient.invalidateQueries({ queryKey: ['shifts'] }); closeTemplateDialog(); toast({ title: t('shifts.templateUpdatedFuture') }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });
  const deleteTemplateMutation = useMutation({
    mutationFn: apiDeleteShiftTemplate,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shift-templates'] }); toast({ title: t('shifts.templateDeleted') }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });
  const assignWeekMutation = useMutation({
    mutationFn: apiAssignTemplateWeek,
    onSuccess: (data: any) => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); toast({ title: t('shifts.assignedForDays', { count: data.days }) }); },
    onError: (e: any) => toast({ title: t('common.error'), description: apiErrorText(e), variant: 'destructive' }),
  });

  const closeDialog = () => { setDialogOpen(false); setEditingShift(null); resetForm(); };
  const resetForm = () => { setFormName(''); setFormDate(''); setFormDateEnd(''); setFormStart('09:00'); setFormEnd('17:00'); setFormAgents([]); };

  const openCreate = () => { resetForm(); setEditingShift(null); setDialogOpen(true); };
  const openEdit = (shift: Shift) => {
    setEditingShift(shift);
    setFormName(shift.name);
    setFormDate(shift.date);
    setFormDateEnd('');
    setFormStart(shift.start_time.substring(0, 5));
    setFormEnd(shift.end_time.substring(0, 5));
    setFormAgents(shift.agents.map(a => a.user_id));
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formName.trim() || !formDate || !formStart || !formEnd) {
      toast({ title: t('shifts.fillRequired'), variant: 'destructive' }); return;
    }
    if (editingShift) {
      updateMutation.mutate({ id: editingShift.id, body: { name: formName.trim(), date: formDate, start_time: formStart, end_time: formEnd, agent_ids: formAgents } });
    } else {
      createMutation.mutate({ name: formName.trim(), date: formDate, date_end: formDateEnd || undefined, start_time: formStart, end_time: formEnd, agent_ids: formAgents });
    }
  };

  const toggleAgent = (id: string) => {
    setFormAgents(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  // Template helpers
  const closeTemplateDialog = () => { setTemplateDialogOpen(false); setEditingTemplate(null); setTplName(''); setTplStart('09:00'); setTplEnd('17:00'); };
  const openCreateTemplate = () => { setEditingTemplate(null); setTplName(''); setTplStart('09:00'); setTplEnd('17:00'); setTemplateDialogOpen(true); };
  const openEditTemplate = (tpl: ShiftTemplate) => {
    setEditingTemplate(tpl);
    setTplName(tpl.name);
    setTplStart(tpl.start_time.substring(0, 5));
    setTplEnd(tpl.end_time.substring(0, 5));
    setTemplateDialogOpen(true);
  };
  const handleTemplateSubmit = () => {
    if (!tplName.trim() || !tplStart || !tplEnd) {
      toast({ title: t('shifts.fillAll'), variant: 'destructive' }); return;
    }
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, body: { name: tplName.trim(), start_time: tplStart, end_time: tplEnd } });
    } else {
      createTemplateMutation.mutate({ name: tplName.trim(), start_time: tplStart, end_time: tplEnd });
    }
  };


  // Calendar helpers
  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const calendarDays = eachDayOfInterval({ start: startOfWeek(monthStart, { weekStartsOn: 1 }), end: endOfWeek(monthEnd, { weekStartsOn: 1 }) });
  const getShiftsForDay = (day: Date) => shifts.filter(s => isSameDay(new Date(s.date), day));

  // Statistics summary totals
  const totalScheduledHours = shiftStats.reduce((sum, s) => sum + s.total_hours_scheduled, 0);
  const totalWeekendShifts = shiftStats.reduce((sum, s) => sum + s.weekend_shifts, 0);
  const totalWeekdayShifts = shiftStats.reduce((sum, s) => sum + s.weekday_shifts, 0);
  const totalActualHours = shiftStats.reduce((sum, s) => sum + s.total_hours_actual, 0);

  if (!user?.isAdmin && !user?.isManager) return <AppLayout title={t('titles.accessDenied')}><div className="p-6">{t('titles.accessDenied')}</div></AppLayout>;

  return (
    <AppLayout title={t('nav.shiftsManagement')}>
      <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">{t('nav.shiftsManagement')}</h1>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> {t('shifts.createShift')}</Button>
          </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">{t('shifts.colAgent')}</Label>
            <Select value={filterAgent} onValueChange={setFilterAgent}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('shifts.allAgents')}</SelectItem>
                {agents.map(a => <SelectItem key={a.user_id} value={a.user_id}>{a.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t('shifts.from')}</Label>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t('shifts.to')}</Label>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="w-40" />
          </div>
          {(filterFrom || filterTo || filterAgent !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterAgent('all'); setFilterFrom(''); setFilterTo(''); }}>{t('shifts.clear')}</Button>
          )}
        </div>

        <Tabs defaultValue="templates">
          <TabsList>
            <TabsTrigger value="templates" className="gap-1"><LayoutTemplate className="h-3.5 w-3.5" /> {t('shifts.tabTemplates')}</TabsTrigger>
            <TabsTrigger value="list">{t('shifts.tabListView')}</TabsTrigger>
            <TabsTrigger value="calendar">{t('shifts.tabCalendarView')}</TabsTrigger>
            <TabsTrigger value="statistics" className="gap-1"><BarChart3 className="h-3.5 w-3.5" /> {t('shifts.tabStatistics')}</TabsTrigger>
            <TabsTrigger value="login-activity" className="gap-1"><LogIn className="h-3.5 w-3.5" /> {t('shifts.tabLoginActivity')}</TabsTrigger>
          </TabsList>

          {/* ═══════════ TEMPLATES TAB ═══════════ */}
          <TabsContent value="templates">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">{t('shifts.shiftTemplates')}</h2>
                <Button size="sm" onClick={openCreateTemplate}><Plus className="h-4 w-4 mr-1" /> New Template</Button>
              </div>

              {templates.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<LayoutTemplate className="h-6 w-6" />}
                    title={t('shifts.noTemplates')}
                    description={t('shifts.createOneToStart')}
                    size="md"
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {templates.map(tpl => (
                    <TemplateCard
                      key={tpl.id}
                      template={tpl}
                      agents={agents}
                      onEdit={() => openEditTemplate(tpl)}
                      onDelete={() => { if (confirm(`Delete template "${tpl.name}"?`)) deleteTemplateMutation.mutate(tpl.id); }}
                      onAssign={(data) => assignWeekMutation.mutate(data)}
                      isAssigning={assignWeekMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ═══════════ LIST TAB ═══════════ */}
          <TabsContent value="list">
            {isLoading ? (
              <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
            ) : shifts.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-5 w-5" />}
                title={t('shifts.noShifts')}
                description={t('shifts.shiftsAppearHere')}
                size="md"
              />
            ) : (
              <div className="rounded-lg border bg-card divide-y">
                {shifts.map(shift => (
                  <div key={shift.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4 min-w-0">
                      <div>
                        <p className="font-medium text-foreground">{shift.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(shift.date), 'MMM d, yyyy')} · {shift.start_time.substring(0, 5)} – {shift.end_time.substring(0, 5)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-wrap gap-1">
                        {shift.agents.length === 0
                          ? <span className="text-muted-foreground text-xs">{t('shifts.unassigned')}</span>
                          : shift.agents.map(a => (
                            <Badge key={a.user_id} variant="secondary" className="text-xs">{a.full_name}</Badge>
                          ))}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(shift)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm(t('shifts.deleteShiftConfirm'))) deleteMutation.mutate(shift.id); }}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ═══════════ CALENDAR TAB ═══════════ */}
          <TabsContent value="calendar">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <Button variant="ghost" size="icon" onClick={() => setCalMonth(subMonths(calMonth, 1))}><ChevronLeft className="h-4 w-4" /></Button>
                  <h3 className="text-lg font-semibold text-foreground">{format(calMonth, 'MMMM yyyy')}</h3>
                  <Button variant="ghost" size="icon" onClick={() => setCalMonth(addMonths(calMonth, 1))}><ChevronRight className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
                  ))}
                  {calendarDays.map(day => {
                    const dayShifts = getShiftsForDay(day);
                    return (
                      <div key={day.toISOString()} className={`bg-card min-h-[80px] p-1 ${!isSameMonth(day, calMonth) ? 'opacity-40' : ''}`}>
                        <div className={`text-xs font-medium mb-1 ${isSameDay(day, new Date()) ? 'text-primary font-bold' : 'text-foreground'}`}>{format(day, 'd')}</div>
                        <div className="space-y-0.5">
                          {dayShifts.slice(0, 3).map(s => (
                            <div key={s.id} className="text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 truncate cursor-pointer hover:bg-primary/20" onClick={() => openEdit(s)} title={`${s.name} (${s.start_time.substring(0, 5)}-${s.end_time.substring(0, 5)})`}>
                              {s.start_time.substring(0, 5)} {s.name}
                            </div>
                          ))}
                          {dayShifts.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayShifts.length - 3} more</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ STATISTICS TAB ═══════════ */}
          <TabsContent value="statistics">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('shifts.from')}</Label>
                  <Input type="date" value={statsFrom} onChange={e => setStatsFrom(e.target.value)} className="w-40" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('shifts.to')}</Label>
                  <Input type="date" value={statsTo} onChange={e => setStatsTo(e.target.value)} className="w-40" />
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  setStatsFrom(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
                  setStatsTo(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
                }}>{t('shifts.thisMonth')}</Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card><CardContent className="p-4"><div className="flex items-center gap-2 mb-1"><Briefcase className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{t('shifts.totalScheduledHours')}</span></div><p className="text-2xl font-bold text-foreground">{totalScheduledHours.toFixed(1)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><div className="flex items-center gap-2 mb-1"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{t('shifts.totalActualHours')}</span></div><p className="text-2xl font-bold text-foreground">{totalActualHours.toFixed(1)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><div className="flex items-center gap-2 mb-1"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{t('shifts.weekdayShifts')}</span></div><p className="text-2xl font-bold text-foreground">{totalWeekdayShifts}</p></CardContent></Card>
                <Card><CardContent className="p-4"><div className="flex items-center gap-2 mb-1"><CalendarDays className="h-4 w-4 text-primary" /><span className="text-xs text-muted-foreground">{t('shifts.weekendShifts')}</span></div><p className="text-2xl font-bold text-primary">{totalWeekendShifts}</p></CardContent></Card>
              </div>

              {statsLoading ? (
                <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
              ) : shiftStats.length === 0 ? (
                <EmptyState
                  icon={<BarChart3 className="h-5 w-5" />}
                  title={t('shifts.noShiftData')}
                  size="md"
                />
              ) : (
                <div className="rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('shifts.colAgent')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colTotalDays')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colWeekendDays')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colTotalShifts')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colWeekday')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colWeekend')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colScheduledHours')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colActualHours')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colAvgHours')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shiftStats.map(stat => (
                        <TableRow key={stat.user_id}>
                          <TableCell className="font-medium">{stat.full_name}</TableCell>
                          <TableCell className="text-center">{stat.total_worked_days}</TableCell>
                          <TableCell className="text-center">{stat.total_weekend_days > 0 ? <Badge variant="secondary" className="text-xs">{stat.total_weekend_days}</Badge> : '0'}</TableCell>
                          <TableCell className="text-center">{stat.total_shifts}</TableCell>
                          <TableCell className="text-center">{stat.weekday_shifts}</TableCell>
                          <TableCell className="text-center">{stat.weekend_shifts > 0 ? <span className="text-primary font-medium">{stat.weekend_shifts}</span> : '0'}</TableCell>
                          <TableCell className="text-center">{stat.total_hours_scheduled}h</TableCell>
                          <TableCell className="text-center">{stat.total_hours_actual}h</TableCell>
                          <TableCell className="text-center">{stat.average_hours_per_shift}h</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ═══════════ LOGIN ACTIVITY TAB ═══════════ */}
          <TabsContent value="login-activity">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('shifts.colAgent')}</Label>
                  <Select value={activityAgent} onValueChange={setActivityAgent}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('shifts.allAgents')}</SelectItem>
                      {agents.map(a => <SelectItem key={a.user_id} value={a.user_id}>{a.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('shifts.from')}</Label>
                  <Input type="date" value={activityFrom} onChange={e => setActivityFrom(e.target.value)} className="w-40" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('shifts.to')}</Label>
                  <Input type="date" value={activityTo} onChange={e => setActivityTo(e.target.value)} className="w-40" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('shifts.colStatus')}</Label>
                  <Select value={activityStatus} onValueChange={setActivityStatus}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('shifts.allStatuses')}</SelectItem>
                      <SelectItem value="On Time">{t('shifts.onTime')}</SelectItem>
                      <SelectItem value="Late Login">{t('shifts.lateLogin')}</SelectItem>
                      <SelectItem value="Early Logout">{t('shifts.earlyLogout')}</SelectItem>
                      <SelectItem value="Outside Shift (Blocked)">{t('shifts.outsideShift')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  setActivityFrom(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
                  setActivityTo(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
                  setActivityAgent('all');
                  setActivityStatus('all');
                }}>{t('shifts.reset')}</Button>
              </div>

              {loginSummary.length > 0 && (
                <div className="rounded-lg border bg-card">
                  <div className="p-3 border-b"><h3 className="text-sm font-semibold text-foreground">{t('shifts.attendanceSummary')}</h3></div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('shifts.colAgent')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colTotalShifts')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colAttended')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colLateLogins')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colEarlyLogouts')}</TableHead>
                        <TableHead className="text-center">{t('shifts.colBlockedAttempts')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loginSummary.map((s: any) => (
                        <TableRow key={s.user_id}>
                          <TableCell className="font-medium">{s.user_name}</TableCell>
                          <TableCell className="text-center">{s.total_shifts}</TableCell>
                          <TableCell className="text-center">{s.attended}</TableCell>
                          <TableCell className="text-center">{s.late > 0 ? <Badge variant="destructive" className="text-xs">{s.late}</Badge> : '0'}</TableCell>
                          <TableCell className="text-center">{s.early > 0 ? <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">{s.early}</Badge> : '0'}</TableCell>
                          <TableCell className="text-center">{s.blocked > 0 ? <Badge variant="destructive" className="text-xs">{s.blocked}</Badge> : '0'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {activityLoading ? (
                <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
              ) : loginActivities.length === 0 ? (
                <EmptyState
                  icon={<LogIn className="h-5 w-5" />}
                  title={t('shifts.noLoginActivity')}
                  size="md"
                />
              ) : (
                <div className="rounded-lg border bg-card">
                  <div className="p-3 border-b"><h3 className="text-sm font-semibold text-foreground">Login Activity ({loginActivities.length} entries)</h3></div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('shifts.colUser')}</TableHead>
                        <TableHead>{t('shifts.colRole')}</TableHead>
                        <TableHead>{t('shifts.colDate')}</TableHead>
                        <TableHead>{t('shifts.colShiftStart')}</TableHead>
                        <TableHead>{t('shifts.colShiftEnd')}</TableHead>
                        <TableHead>{t('shifts.colLoginTime')}</TableHead>
                        <TableHead>{t('shifts.colLogoutTime')}</TableHead>
                        <TableHead>{t('shifts.colDuration')}</TableHead>
                        <TableHead>{t('shifts.colStatus')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loginActivities.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.user_name}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs capitalize">{a.role}</Badge></TableCell>
                          <TableCell>{a.shift_date}</TableCell>
                          <TableCell>{a.shift_start || '—'}</TableCell>
                          <TableCell>{a.shift_end || '—'}</TableCell>
                          <TableCell>{a.login_time ? format(new Date(a.login_time), 'HH:mm') : '—'}</TableCell>
                          <TableCell>{a.logout_time ? format(new Date(a.logout_time), 'HH:mm') : <span className="text-muted-foreground text-xs">{t('shifts.active')}</span>}</TableCell>
                          <TableCell>{a.session_duration != null ? `${Math.floor(a.session_duration / 60)}h ${Math.round(a.session_duration % 60)}m` : '—'}</TableCell>
                          <TableCell>
                            <Badge
                              variant={a.status === t('shifts.onTime') ? 'default' : a.status === t('shifts.lateLogin') ? 'destructive' : a.status === t('shifts.earlyLogout') ? 'secondary' : 'destructive'}
                              className={`text-xs ${a.status === t('shifts.earlyLogout') ? 'bg-orange-100 text-orange-700' : a.status === t('shifts.onTime') ? 'bg-green-100 text-green-700' : ''}`}
                            >
                              {a.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Shift Dialog */}
        <Dialog open={dialogOpen} onOpenChange={v => { if (!v) closeDialog(); else setDialogOpen(true); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingShift ? t('shifts.editShift') : t('shifts.createShift')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('shifts.shiftNameReq')}</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('shifts.namePlaceholder')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{editingShift ? t('shifts.dateReq') : t('shifts.startDateReq')}</Label>
                  <Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} />
                </div>
                {!editingShift && (
                  <div>
                    <Label>{t('shifts.endDateOpt')}</Label>
                    <Input type="date" value={formDateEnd} onChange={e => setFormDateEnd(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('shifts.startTimeReq')}</Label>
                  <Input type="time" value={formStart} onChange={e => setFormStart(e.target.value)} />
                </div>
                <div>
                  <Label>{t('shifts.endTimeReq')}</Label>
                  <Input type="time" value={formEnd} onChange={e => setFormEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>{t('shifts.assignAgents')}</Label>
                <div className="mt-1 border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                  {agents.length === 0 ? (
                    <EmptyState
                      icon={<Users className="h-4 w-4" />}
                      title={t('shifts.noAgentsAvailable')}
                      size="sm"
                      className="border-0 bg-transparent py-1 text-xs"
                    />
                  ) : agents.map(a => (
                    <label key={a.user_id} className="flex items-center gap-2 cursor-pointer hover:bg-muted rounded px-2 py-1">
                      <input type="checkbox" checked={formAgents.includes(a.user_id)} onChange={() => toggleAgent(a.user_id)} className="rounded" />
                      <span className="text-sm">{a.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeDialog}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingShift ? t('shifts.update') : t('shifts.create')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Create/Edit Template Dialog */}
        <Dialog open={templateDialogOpen} onOpenChange={v => { if (!v) closeTemplateDialog(); else setTemplateDialogOpen(true); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingTemplate ? t('shifts.editTemplate') : t('shifts.createTemplate')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('shifts.templateNameReq')}</Label>
                <Input value={tplName} onChange={e => setTplName(e.target.value)} placeholder={t('shifts.namePlaceholder')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('shifts.startTimeReq')}</Label>
                  <Input type="time" value={tplStart} onChange={e => setTplStart(e.target.value)} />
                </div>
                <div>
                  <Label>{t('shifts.endTimeReq')}</Label>
                  <Input type="time" value={tplEnd} onChange={e => setTplEnd(e.target.value)} />
                </div>
              </div>
              {editingTemplate && (
                <p className="text-xs text-muted-foreground">{t('shifts.editTemplateNote')}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeTemplateDialog}>{t('common.cancel')}</Button>
                <Button onClick={handleTemplateSubmit} disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending}>
                  {editingTemplate ? t('shifts.update') : t('shifts.create')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </AppLayout>
  );
}
