import { useState, useMemo, useEffect } from 'react';
import { apiErrorText } from '@/i18n/apiErrors';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/layouts/AppLayout';
import {
  apiGetUnassignedPending, apiBulkAssignOrders, apiGetOnlineAgents,
  apiGetSegments, apiAutoAssignSegment, apiBulkUnassignSegment,
  apiGetSegment, apiAssignSegmentMembers, apiGetOrders, apiBulkUnassignOrders,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import i18n from '@/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  Loader2, UserPlus, Users, Inbox, Clock, Layers, Split, ChevronRight, UserX,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';
import { MobileCard, MobileCardHeader, MobileCardField } from '@/components/ui/mobile-card';
import { SegmentMemberTable, type SegmentMember } from '@/components/assigner/SegmentMemberTable';
import { AgentPickerChips } from '@/components/assigner/AgentPickerChips';
import { CrossListBasketBar, type BasketItem } from '@/components/assigner/CrossListBasketBar';

interface UnassignedOrder {
  id: string;
  display_id: string;
  customer_name: string;
  customer_phone: string;
  product_name: string;
  source_type: string;
  created_at: string;
}

interface AssignedPendingOrder {
  id: string;
  display_id: string;
  customer_name: string;
  customer_phone: string;
  product_name: string;
  source_type: string;
  created_at: string;
  assigned_at: string | null;
}

interface OnlineAgent {
  user_id: string;
  full_name: string;
  email: string;
  roles: string[];
  active_leads: number;
  shift: { start_time: string; end_time: string } | null;
  is_online: boolean;
  last_seen_at: string | null;
}

interface SegmentList {
  id: string;
  name: string;
  description: string;
  category: 'value' | 'prestige' | 'cancel' | 'return' | 'other';
  member_count: number;
  assigned_count: number;
  completed_count: number;
  is_active: boolean;
  is_static?: boolean;
  display_order: number;
}

const PAGE_SIZE = 50;

function lastSeenLabel(iso: string | null): string {
  if (!iso) return i18n.t('assigner.neverSeen');
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return i18n.t('dashboard.justNow');
  if (mins < 60) return i18n.t('dashboard.minsAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return i18n.t('dashboard.hoursAgo', { count: hrs });
  return i18n.t('dashboard.daysAgo', { count: Math.floor(hrs / 24) });
}

export default function AssignerPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [inspectAgent, setInspectAgent] = useState<OnlineAgent | null>(null);
  const [inspectTab, setInspectTab] = useState<'pendings' | 'lists'>('pendings');
  const [inspectPendingSelected, setInspectPendingSelected] = useState<string[]>([]);
  const [inspectPendingBusy, setInspectPendingBusy] = useState(false);
  const [inspectListId, setInspectListId] = useState('');
  const [inspectListPage, setInspectListPage] = useState(1);
  const [inspectListCompleted, setInspectListCompleted] = useState<'all' | 'no'>('no');
  const [inspectMemberSelected, setInspectMemberSelected] = useState<string[]>([]);
  const [inspectMemberBusy, setInspectMemberBusy] = useState(false);

  // For the inspector: which prediction lists actually have members assigned to the current inspectAgent
  const [agentAssignedListIds, setAgentAssignedListIds] = useState<string[]>([]);
  const [agentListsLoading, setAgentListsLoading] = useState(false);

  // Cross-list basket — hand-picked members keyed `${listId}|${phone}`,
  // accumulated across every expanded list.
  const [basket, setBasket] = useState<Map<string, BasketItem>>(new Map());
  const [basketBusy, setBasketBusy] = useState(false);

  const { data: orders = [], isLoading: ordersLoading } = useQuery<UnassignedOrder[]>({
    queryKey: ['unassigned-pending'],
    queryFn: apiGetUnassignedPending,
    refetchInterval: 10000,
  });

  const { data: agents = [], isLoading: agentsLoading } = useQuery<OnlineAgent[]>({
    queryKey: ['online-agents'],
    queryFn: apiGetOnlineAgents,
    refetchInterval: 15000,
  });

  const { data: segments = [], isLoading: segmentsLoading } = useQuery<SegmentList[]>({
    queryKey: ['segments'],
    queryFn: apiGetSegments,
    refetchInterval: 30000,
  });

  const { data: assignedPendingData, isLoading: assignedPendingLoading } = useQuery<{ orders: AssignedPendingOrder[] }>({
    queryKey: ['assigned-pending', inspectAgent?.user_id],
    queryFn: () => apiGetOrders({ status: 'pending', agent_id: inspectAgent?.user_id, limit: 200 }),
    enabled: !!inspectAgent?.user_id,
  });

  const { data: assignedMemberData, isLoading: assignedMemberLoading } = useQuery<{ members: SegmentMember[]; total: number }>({
    queryKey: ['agent-assigned-members', inspectAgent?.user_id, inspectListId, inspectListPage, inspectListCompleted],
    queryFn: () => apiGetSegment(inspectListId, {
      page: inspectListPage,
      limit: PAGE_SIZE,
      assigned: inspectAgent?.user_id,
      completed: inspectListCompleted === 'all' ? undefined : 'no',
    }),
    enabled: !!inspectAgent?.user_id && !!inspectListId,
  });

  const assignMutation = useMutation({
    mutationFn: () => apiBulkAssignOrders(selectedOrders, selectedAgent),
    onSuccess: (data: any) => {
      toast({ title: t('assigner.pendingAssigned', { count: data.assigned }) });
      setSelectedOrders([]);
      setSelectedAgent('');
      queryClient.invalidateQueries({ queryKey: ['unassigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['online-agents'] });
    },
    onError: (err: any) => toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' }),
  });

  const toggleOrder = (id: string) =>
    setSelectedOrders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleAllOrders = () =>
    setSelectedOrders(selectedOrders.length === orders.length ? [] : orders.map(o => o.id));

  const onlineAgents = agents.filter(a => a.is_online);
  const agentsSorted = useMemo(() => [...agents].sort((a, b) => {
    if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
    return a.active_leads - b.active_leads;
  }), [agents]);
  const totalUnassignedInLists = segments.reduce((s, x) => s + (x.member_count - x.assigned_count), 0);

  // When the inspected agent changes, reset UI state and prefer "all states" in the lists tab
  // so the manager can immediately see every member currently assigned to that agent.
  useEffect(() => {
    if (!inspectAgent) {
      setInspectListId('');
      setAgentAssignedListIds([]);
      return;
    }

    setInspectListPage(1);
    setInspectPendingSelected([]);
    setInspectMemberSelected([]);
    setInspectListCompleted('all'); // show everything assigned to the agent, not just "not called"
  }, [inspectAgent?.user_id]);

  // Discover which lists the currently inspected agent actually has assignments in.
  // We do cheap count-only probes (limit:1) so the inspector can prioritize the relevant lists.
  useEffect(() => {
    if (!inspectAgent?.user_id || segments.length === 0) {
      setAgentAssignedListIds([]);
      return;
    }

    const loadAgentLists = async () => {
      setAgentListsLoading(true);
      try {
        const activeSegments = segments.filter(s => s.is_active);
        const checks = await Promise.all(
          activeSegments.map(async (s) => {
            try {
              const res: any = await apiGetSegment(s.id, {
                assigned: inspectAgent.user_id,
                limit: 1,
                completed: 'all'
              });
              return (res?.total ?? 0) > 0 ? s.id : null;
            } catch {
              return null;
            }
          })
        );
        setAgentAssignedListIds(checks.filter(Boolean) as string[]);
      } finally {
        setAgentListsLoading(false);
      }
    };

    loadAgentLists();
  }, [inspectAgent?.user_id, segments]);

  // Smart default list selection for the inspector:
  // 1. Prefer a list the agent actually has assignments in (from the discovery above).
  // 2. Fall back to the first globally active list.
  useEffect(() => {
    if (!inspectAgent || segments.length === 0) return;

    // Only auto-pick if user hasn't manually chosen something yet for this agent,
    // or if the previous choice is no longer valid.
    const currentStillValid = inspectListId && segments.some(s => s.id === inspectListId);

    if (agentAssignedListIds.length > 0) {
      const firstForAgent = agentAssignedListIds.find(id => segments.some(s => s.id === id));
      if (firstForAgent && (!currentStillValid || !agentAssignedListIds.includes(inspectListId))) {
        setInspectListId(firstForAgent);
        setInspectListPage(1);
      }
    } else if (!currentStillValid) {
      // No assignments found for this agent yet — fall back to global first
      const firstGlobal = segments
        .filter(s => s.is_active)
        .sort((a, b) => a.display_order - b.display_order)[0];
      if (firstGlobal) {
        setInspectListId(firstGlobal.id);
        setInspectListPage(1);
      }
    }
  }, [agentAssignedListIds, segments, inspectAgent?.user_id]);

  // ── Basket helpers ──
  const isInBasket = (listId: string, phone: string) => basket.has(`${listId}|${phone}`);
  const toggleBasketMember = (listId: string, listName: string, m: SegmentMember) => {
    const key = `${listId}|${m.customer_phone}`;
    setBasket(prev => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { key, listId, listName, phone: m.customer_phone, name: m.customer_name });
      return next;
    });
  };
  const setBasketForMembers = (listId: string, listName: string, members: SegmentMember[], add: boolean) => {
    setBasket(prev => {
      const next = new Map(prev);
      for (const m of members) {
        const key = `${listId}|${m.customer_phone}`;
        if (add) next.set(key, { key, listId, listName, phone: m.customer_phone, name: m.customer_name });
        else next.delete(key);
      }
      return next;
    });
  };

  const invalidateAfterAssign = (touchedListIds: string[]) => {
    queryClient.invalidateQueries({ queryKey: ['segments'] });
    queryClient.invalidateQueries({ queryKey: ['segment'] });
    queryClient.invalidateQueries({ queryKey: ['online-agents'] });
    queryClient.invalidateQueries({ queryKey: ['my-queue-summary'] });
  };

  const assignBasket = async (agentIds: string[]) => {
    if (agentIds.length === 0) return;
    setBasketBusy(true);
    try {
      const items = [...basket.values()];
      // Shuffle so a multi-agent split isn't biased by list/insert order.
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      // Round-robin into agents.
      const perAgent: Record<string, BasketItem[]> = {};
      agentIds.forEach(a => { perAgent[a] = []; });
      items.forEach((it, i) => perAgent[agentIds[i % agentIds.length]].push(it));
      // Per (agent, list) assign call.
      for (const [agentId, its] of Object.entries(perAgent)) {
        const byList: Record<string, string[]> = {};
        for (const it of its) (byList[it.listId] ||= []).push(it.phone);
        for (const [listId, phones] of Object.entries(byList)) {
          await apiAssignSegmentMembers(listId, phones, agentId);
        }
      }
      const names = agentIds.map(id => agents.find(a => a.user_id === id)?.full_name || 'Agent').join(', ');
      toast({ title: t('assigner.customersAssigned', { count: items.length }), description: agentIds.length > 1 ? t('assigner.splitAcross', { names }) : t('assigner.toNames', { names }) });
      setBasket(new Map());
      invalidateAfterAssign([...new Set(items.map(i => i.listId))]);
    } catch (err: any) {
      toast({ title: t('assigner.assignmentFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setBasketBusy(false);
    }
  };

  const unassignBasket = async () => {
    setBasketBusy(true);
    try {
      const items = [...basket.values()];
      const byList: Record<string, string[]> = {};
      for (const it of items) (byList[it.listId] ||= []).push(it.phone);
      for (const [listId, phones] of Object.entries(byList)) {
        await apiAssignSegmentMembers(listId, phones, null);
      }
      toast({ title: t('assigner.customersUnassigned', { count: items.length }) });
      setBasket(new Map());
      invalidateAfterAssign(Object.keys(byList));
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setBasketBusy(false);
    }
  };

  const assignedPendings = assignedPendingData?.orders ?? [];
  const pendingAllSelected = assignedPendings.length > 0 && inspectPendingSelected.length === assignedPendings.length;
  const assignedMembers = assignedMemberData?.members ?? [];
  const assignedTotal = assignedMemberData?.total ?? 0;
  const assignedTotalPages = Math.max(1, Math.ceil(assignedTotal / PAGE_SIZE));
  const assignedAllOnPageSelected = assignedMembers.length > 0 && assignedMembers.every(m => inspectMemberSelected.includes(m.customer_phone));

  const toggleInspectPending = (id: string) =>
    setInspectPendingSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleInspectPendingAll = () =>
    setInspectPendingSelected(pendingAllSelected ? [] : assignedPendings.map(o => o.id));

  const toggleInspectMember = (phone: string) =>
    setInspectMemberSelected(prev => prev.includes(phone) ? prev.filter(x => x !== phone) : [...prev, phone]);
  const toggleInspectMembersAll = () =>
    setInspectMemberSelected(assignedAllOnPageSelected ? [] : assignedMembers.map(m => m.customer_phone));

  const unassignInspectPendings = async () => {
    if (inspectPendingSelected.length === 0) return;
    setInspectPendingBusy(true);
    try {
      const res: any = await apiBulkUnassignOrders(inspectPendingSelected);
      toast({ title: t('assigner.pendingsUnassigned', { count: res?.unassigned ?? inspectPendingSelected.length }) });
      setInspectPendingSelected([]);
      queryClient.invalidateQueries({ queryKey: ['assigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['unassigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['online-agents'] });
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setInspectPendingBusy(false);
    }
  };

  // One-click unassign for a single pending order in the per-agent inspector
  const unassignSingleInspectPending = async (orderId: string) => {
    setInspectPendingBusy(true);
    try {
      const res: any = await apiBulkUnassignOrders([orderId]);
      toast({ title: t('assigner.pendingUnassigned') });
      setInspectPendingSelected(prev => prev.filter(id => id !== orderId));
      queryClient.invalidateQueries({ queryKey: ['assigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['unassigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['online-agents'] });
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setInspectPendingBusy(false);
    }
  };

  const unassignAllInspectPendings = async () => {
    if (assignedPendings.length === 0) return;
    setInspectPendingBusy(true);
    try {
      const ids = assignedPendings.map(o => o.id);
      const res: any = await apiBulkUnassignOrders(ids);
      toast({ title: t('assigner.pendingsUnassignedFor', { count: res?.unassigned ?? ids.length, name: inspectAgent?.full_name }) });
      setInspectPendingSelected([]);
      queryClient.invalidateQueries({ queryKey: ['assigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['unassigned-pending'] });
      queryClient.invalidateQueries({ queryKey: ['online-agents'] });
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setInspectPendingBusy(false);
    }
  };

  const unassignInspectMembers = async () => {
    if (!inspectListId || inspectMemberSelected.length === 0) return;
    setInspectMemberBusy(true);
    try {
      await apiAssignSegmentMembers(inspectListId, inspectMemberSelected, null);
      toast({ title: t('assigner.customersUnassigned', { count: inspectMemberSelected.length }) });
      setInspectMemberSelected([]);
      invalidateAfterAssign([inspectListId]);
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setInspectMemberBusy(false);
    }
  };

  // One-click unassign for a single customer while viewing an agent's assignments in the inspector
  const unassignSingleInspectMember = async (m: SegmentMember) => {
    if (!inspectListId) return;
    setInspectMemberBusy(true);
    try {
      await apiAssignSegmentMembers(inspectListId, [m.customer_phone], null);
      toast({ title: t('assigner.unassignedCustomer', { name: m.customer_name || m.customer_phone }) });
      setInspectMemberSelected(prev => prev.filter(p => p !== m.customer_phone));
      invalidateAfterAssign([inspectListId]);
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setInspectMemberBusy(false);
    }
  };

  const unassignInspectListAll = async () => {
    if (!inspectAgent || !inspectListId) return;
    setInspectMemberBusy(true);
    try {
      const res: any = await apiBulkUnassignSegment(inspectListId, inspectAgent.user_id);
      toast({ title: t('assigner.customersUnassigned', { count: res?.unassigned ?? 0 }) });
      setInspectMemberSelected([]);
      invalidateAfterAssign([inspectListId]);
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setInspectMemberBusy(false);
    }
  };

  return (
    <AppLayout title={t('nav.assigner')}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] min-w-0">
        {/* ── Left ── */}
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <Card className="border-none shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--warning))]">
                  <Inbox className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('assigner.pendings')}</p>
                  <p className="text-xl font-bold">{orders.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
                  <Layers className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('assigner.unassignedInLists')}</p>
                  <p className="text-xl font-bold">{totalUnassignedInLists.toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--success))]">
                  <Users className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('assigner.onlineAgents')}</p>
                  <p className="text-xl font-bold">{onlineAgents.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="prediction_lists">
            <TabsList className="mb-3">
              <TabsTrigger value="prediction_lists">Prediction Lists ({segments.length})</TabsTrigger>
              <TabsTrigger value="pendings">Pendings ({orders.length})</TabsTrigger>
            </TabsList>

            {/* ── Tab: Prediction Lists ── */}
            <TabsContent value="prediction_lists" className="space-y-4 mt-0">
              {segmentsLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : segments.length === 0 ? (
                <EmptyState
                  icon={<Layers className="h-5 w-5" />}
                  title={t('assigner.noListsYet')}
                  description={t('assigner.uploadToCreate')}
                  size="md"
                />
              ) : (
                <div className="space-y-2">
                  {segments
                    .filter(s => s.is_active && s.member_count > 0)
                    .sort((a, b) => a.display_order - b.display_order)
                    .map(list => (
                      <PredictionListRow
                        key={list.id}
                        list={list}
                        agents={agentsSorted}
                        isInBasket={isInBasket}
                        toggleBasketMember={toggleBasketMember}
                        setBasketForMembers={setBasketForMembers}
                        onMutated={() => invalidateAfterAssign([list.id])}
                      />
                    ))}
                </div>
              )}
            </TabsContent>

            {/* ── Tab: Pendings ── */}
            <TabsContent value="pendings" className="space-y-4 mt-0">
              <div className="flex items-center gap-3 rounded-xl border bg-card/80 backdrop-blur-sm p-3 shadow-sm">
                <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                  <SelectTrigger className="w-56 h-9 text-sm rounded-lg"><SelectValue placeholder={t('assigner.selectAgent')} /></SelectTrigger>
                  <SelectContent>
                    {agentsSorted.map(a => (
                      <SelectItem key={a.user_id} value={a.user_id}>
                        <span className="flex items-center gap-2">
                          <span className={cn('h-1.5 w-1.5 rounded-full', a.is_online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                          {a.full_name}
                          <Badge variant="outline" className="text-[10px] ml-1">{a.active_leads} active</Badge>
                        </span>
                      </SelectItem>
                    ))}
                    {agentsSorted.length === 0 && <SelectItem value="__none" disabled>{t('assigner.noAgents')}</SelectItem>}
                  </SelectContent>
                </Select>
                <Button
                  size="sm" className="h-9 gap-1.5 rounded-lg"
                  disabled={selectedOrders.length === 0 || !selectedAgent || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                >
                  {assignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {t('assigner.assignCount', { count: selectedOrders.length })}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">{orders.length} pending</span>
              </div>

              <div className="hidden md:block rounded-xl border bg-card shadow-sm overflow-hidden">
                {ordersLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 w-10">
                          <Checkbox checked={orders.length > 0 && selectedOrders.length === orders.length} onCheckedChange={toggleAllOrders} aria-label={t('missedCalls.selectAll')} />
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('search.name')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('search.phone')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('ordersPage.colProduct')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('ordersPage.colSource')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('assigner.colReceived')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(order => (
                        <tr key={order.id}
                          className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer', selectedOrders.includes(order.id) && 'bg-primary/5')}
                          onClick={() => toggleOrder(order.id)}>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <Checkbox checked={selectedOrders.includes(order.id)} onCheckedChange={() => toggleOrder(order.id)} />
                          </td>
                          <td className="px-4 py-3 font-medium">{order.customer_name || '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs">{order.customer_phone}</td>
                          <td className="px-4 py-3">
                            {order.product_name ? <Badge variant="outline" className="text-xs">{order.product_name}</Badge> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className="text-[10px]">
                              {order.source_type === 'inbound_lead' ? t('ordersPage.sourceWebhook')
                                : order.source_type === 'prediction_lead' ? t('ordersPage.sourceLead')
                                : order.source_type === 'opencart' ? t('ordersPage.sourceSite')
                                : order.source_type === 'opencart_abandoned' ? t('ordersPage.sourceSiteAbandoned')
                                : t('ordersPage.sourceManual')}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(order.created_at), 'MMM d, HH:mm')}</td>
                        </tr>
                      ))}
                      {orders.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <EmptyState
                              icon={<Inbox className="h-5 w-5" />}
                              title={t('assigner.noPendingToAssign')}
                              description={t('assigner.allCaughtUp')}
                              size="sm"
                              className="border-0 bg-transparent hover:shadow-none py-8"
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Cards — mobile */}
              <div className="md:hidden space-y-2">
                {ordersLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : orders.length === 0 ? (
                  <EmptyState icon={<Inbox className="h-5 w-5" />} title={t('assigner.noPendingToAssign')} description={t('assigner.allCaughtUp')} size="sm" />
                ) : orders.map(order => (
                  <MobileCard key={order.id} className={cn(selectedOrders.includes(order.id) && 'ring-1 ring-primary')} onClick={() => toggleOrder(order.id)}>
                    <div className="flex items-start gap-2">
                      <Checkbox className="mt-1 shrink-0" checked={selectedOrders.includes(order.id)} onCheckedChange={() => toggleOrder(order.id)} onClick={e => e.stopPropagation()} />
                      <div className="min-w-0 flex-1">
                        <MobileCardHeader
                          title={order.customer_name || '—'}
                          subtitle={order.customer_phone}
                          badge={
                            <Badge variant="secondary" className="text-[10px]">
                              {order.source_type === 'inbound_lead' ? t('ordersPage.sourceWebhook')
                                : order.source_type === 'prediction_lead' ? t('ordersPage.sourceLead')
                                : order.source_type === 'opencart' ? t('ordersPage.sourceSite')
                                : order.source_type === 'opencart_abandoned' ? t('ordersPage.sourceSiteAbandoned')
                                : t('ordersPage.sourceManual')}
                            </Badge>
                          }
                        />
                      </div>
                    </div>
                    <MobileCardField label="Product" value={order.product_name ? <Badge variant="outline" className="text-xs">{order.product_name}</Badge> : '—'} />
                    <MobileCardField label={t('assigner.colReceived')} value={format(new Date(order.created_at), 'MMM d, HH:mm')} />
                  </MobileCard>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Right: Agents panel ── */}
        <div className="space-y-4 min-w-0">
          <Card className="border-none shadow-sm sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Agents
                <span className="ml-auto text-xs font-normal text-muted-foreground">{onlineAgents.length} online</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {agentsLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : agentsSorted.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-4 w-4" />}
                  title={t('assigner.noAgentsFound')}
                  size="sm"
                  className="border-0 bg-transparent py-4"
                />
              ) : agentsSorted.map(agent => (
                <button
                  key={agent.user_id}
                  type="button"
                  onClick={() => { setInspectAgent(agent); setInspectTab('pendings'); }}
                  className={cn('w-full text-left flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-muted/50', !agent.is_online && 'opacity-60', 'bg-muted/30')}
                >
                  <div className="relative">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {agent.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', agent.is_online ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground/40')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{agent.full_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{agent.active_leads} open</span>
                      <span>•</span>
                      {agent.is_online ? <span className="text-emerald-600 font-medium">online</span> : <span>seen {lastSeenLabel(agent.last_seen_at)}</span>}
                      {agent.shift && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{agent.shift.start_time?.slice(0, 5)} - {agent.shift.end_time?.slice(0, 5)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={!!inspectAgent} onOpenChange={(open) => { if (!open) setInspectAgent(null); }}>
        <SheetContent side="right" className="w-[min(860px,100vw)] sm:max-w-[860px] flex flex-col">
          <SheetHeader className="shrink-0">
            <SheetTitle>{inspectAgent?.full_name || 'Agent'}</SheetTitle>
            <SheetDescription>
              Review assignments and unassign pendings or list members.
            </SheetDescription>
          </SheetHeader>

          {/* Make the main content (Tabs + everything inside) scrollable */}
          <div className="flex-1 overflow-y-auto mt-6 pr-1">
            <Tabs value={inspectTab} onValueChange={(v) => setInspectTab(v as 'pendings' | 'lists')} >
            <TabsList>
              <TabsTrigger value="pendings">Pendings ({assignedPendings.length})</TabsTrigger>
              <TabsTrigger value="lists">{t('nav.predictionLists')}</TabsTrigger>
            </TabsList>

            <TabsContent value="pendings" className="space-y-4 mt-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
                <Button size="sm" variant="outline" disabled={inspectPendingSelected.length === 0 || inspectPendingBusy} onClick={unassignInspectPendings}>
                  {inspectPendingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                  Unassign selected ({inspectPendingSelected.length})
                </Button>
                <Button size="sm" variant="destructive" disabled={assignedPendings.length === 0 || inspectPendingBusy} onClick={unassignAllInspectPendings}>
                  {inspectPendingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                  Unassign all ({assignedPendings.length})
                </Button>
                <span className="text-xs text-muted-foreground">for {inspectAgent?.full_name}</span>
              </div>

              <div className="hidden md:block rounded-xl border bg-card shadow-sm overflow-hidden">
                {assignedPendingLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 w-10">
                          <Checkbox checked={pendingAllSelected} onCheckedChange={toggleInspectPendingAll} aria-label={t('missedCalls.selectAll')} />
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('search.name')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('search.phone')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('ordersPage.colProduct')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('predLists.colAssigned')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('assigner.colReceived')}</th>
                        <th className="px-4 py-3 w-10 text-center font-medium text-muted-foreground">{t('assigner.colAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignedPendings.map(order => (
                        <tr key={order.id}
                          className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer', inspectPendingSelected.includes(order.id) && 'bg-primary/5')}
                          onClick={() => toggleInspectPending(order.id)}>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <Checkbox checked={inspectPendingSelected.includes(order.id)} onCheckedChange={() => toggleInspectPending(order.id)} />
                          </td>
                          <td className="px-4 py-3 font-medium">{order.customer_name || '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs">{order.customer_phone}</td>
                          <td className="px-4 py-3">
                            {order.product_name ? <Badge variant="outline" className="text-xs">{order.product_name}</Badge> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {order.assigned_at ? format(new Date(order.assigned_at), 'MMM d, HH:mm') : '—'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(order.created_at), 'MMM d, HH:mm')}</td>
                          <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                              onClick={() => unassignSingleInspectPending(order.id)}
                              title={t('assigner.unassignThisPending')}
                              disabled={inspectPendingBusy}
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {assignedPendings.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <EmptyState
                              icon={<Users className="h-5 w-5" />}
                              title={t('assigner.noPendingForAgent')}
                              description={t('assigner.pendingForAgentDesc')}
                              size="sm"
                              className="border-0 bg-transparent hover:shadow-none py-8"
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Cards — mobile */}
              <div className="md:hidden space-y-2">
                {assignedPendingLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : assignedPendings.length === 0 ? (
                  <EmptyState icon={<Users className="h-5 w-5" />} title={t('assigner.noPendingForAgent')} description={t('assigner.pendingForAgentDesc')} size="sm" />
                ) : assignedPendings.map(order => (
                  <MobileCard key={order.id} className={cn(inspectPendingSelected.includes(order.id) && 'ring-1 ring-primary')} onClick={() => toggleInspectPending(order.id)}>
                    <div className="flex items-start gap-2">
                      <Checkbox className="mt-1 shrink-0" checked={inspectPendingSelected.includes(order.id)} onCheckedChange={() => toggleInspectPending(order.id)} onClick={e => e.stopPropagation()} />
                      <div className="min-w-0 flex-1">
                        <MobileCardHeader
                          title={order.customer_name || '—'}
                          subtitle={order.customer_phone}
                          badge={order.product_name ? <Badge variant="outline" className="text-xs">{order.product_name}</Badge> : undefined}
                        />
                      </div>
                    </div>
                    <MobileCardField label={t('predLists.colAssigned')} value={order.assigned_at ? format(new Date(order.assigned_at), 'MMM d, HH:mm') : '—'} />
                    <MobileCardField label={t('assigner.colReceived')} value={format(new Date(order.created_at), 'MMM d, HH:mm')} />
                    <div className="pt-1">
                      <Button
                        variant="outline" size="sm" className="w-full gap-1.5 text-rose-600"
                        onClick={(e) => { e.stopPropagation(); unassignSingleInspectPending(order.id); }}
                        disabled={inspectPendingBusy}
                      >
                        <UserX className="h-3.5 w-3.5" /> Unassign
                      </Button>
                    </div>
                  </MobileCard>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="lists" className="space-y-4 mt-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
                <Select value={inspectListId} onValueChange={(v) => { setInspectListId(v); setInspectListPage(1); setInspectMemberSelected([]); }}>
                  <SelectTrigger className="w-[260px] h-9 text-sm rounded-lg"><SelectValue placeholder={t('assigner.selectList')} /></SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const active = segments.filter(s => s.is_active);
                      const agentOnes = active.filter(s => agentAssignedListIds.includes(s.id));
                      const others = active.filter(s => !agentAssignedListIds.includes(s.id));

                      return (
                        <>
                          {agentOnes.length > 0 && (
                            <>
                              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Assigned to this agent {agentListsLoading ? '(checking...)' : `(${agentOnes.length})`}
                              </div>
                              {agentOnes
                                .sort((a, b) => a.display_order - b.display_order)
                                .map(list => (
                                  <SelectItem key={list.id} value={list.id}>
                                    {list.name}
                                    <span className="ml-1 text-[10px] text-emerald-600">· assigned</span>
                                  </SelectItem>
                                ))}
                              {others.length > 0 && <div className="my-1 border-t" />}
                            </>
                          )}
                          {others
                            .sort((a, b) => a.display_order - b.display_order)
                            .map(list => (
                              <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                            ))}
                          {active.length === 0 && <SelectItem value="__none" disabled>{t('assigner.noLists')}</SelectItem>}
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
                <Select value={inspectListCompleted} onValueChange={(v) => { setInspectListCompleted(v as 'all' | 'no'); setInspectListPage(1); }}>
                  <SelectTrigger className="w-[180px] h-9 text-sm rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">{t('assigner.notCalled')}</SelectItem>
                    <SelectItem value="all">{t('assigner.allStates')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={inspectMemberSelected.length === 0 || inspectMemberBusy} onClick={unassignInspectMembers}>
                  {inspectMemberBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                  Unassign selected ({inspectMemberSelected.length})
                </Button>
                <Button size="sm" variant="ghost" disabled={!inspectListId || inspectMemberBusy} onClick={unassignInspectListAll} className="text-rose-700 hover:bg-rose-50">
                  <UserX className="h-3.5 w-3.5" /> Unassign all in list
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">{assignedTotal.toLocaleString()} assigned</span>
              </div>

              {inspectListId ? (
                <SegmentMemberTable
                  members={assignedMembers}
                  isSelected={(phone) => inspectMemberSelected.includes(phone)}
                  onToggle={(m) => toggleInspectMember(m.customer_phone)}
                  onToggleAll={toggleInspectMembersAll}
                  allOnPageSelected={assignedAllOnPageSelected}
                  page={inspectListPage}
                  totalPages={assignedTotalPages}
                  onPageChange={setInspectListPage}
                  loading={assignedMemberLoading}
                  compact
                  onUnassignSingle={unassignSingleInspectMember}
                />
              ) : (
                <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
                  {agentAssignedListIds.length === 0 && !agentListsLoading
                    ? t('assigner.noListAssignments', { name: inspectAgent?.full_name || t('assigner.thisAgent') })
                    : t('assigner.chooseListHint')}
                </div>
              )}
            </TabsContent>
          </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      <CrossListBasketBar
        items={[...basket.values()]}
        agents={agentsSorted}
        busy={basketBusy}
        onAssign={assignBasket}
        onUnassign={unassignBasket}
        onClear={() => setBasket(new Map())}
        onRemove={(key) => setBasket(prev => { const n = new Map(prev); n.delete(key); return n; })}
      />
    </AppLayout>
  );
}

interface RowProps {
  list: SegmentList;
  agents: OnlineAgent[];
  isInBasket: (listId: string, phone: string) => boolean;
  toggleBasketMember: (listId: string, listName: string, m: SegmentMember) => void;
  setBasketForMembers: (listId: string, listName: string, members: SegmentMember[], add: boolean) => void;
  onMutated: () => void;
}

/** Expandable list row: a Distribute bar (whole/half/custom × N agents +
 *  unassign-all) plus the inline member table whose checkboxes feed the
 *  cross-list basket. */
function PredictionListRow({ list, agents, isInBasket, toggleBasketMember, setBasketForMembers, onMutated }: RowProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [scope, setScope] = useState<'unassigned' | 'all'>('unassigned');
  const [amount, setAmount] = useState<'whole' | 'half' | 'custom'>('whole');
  const [customN, setCustomN] = useState('20');
  const [busy, setBusy] = useState(false);

  // Inline table state
  const [page, setPage] = useState(1);
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [completedFilter, setCompletedFilter] = useState('no');

  const unassigned = list.member_count - list.assigned_count;
  // Static lists (Trashed, Due to Reorder, and any operator-made informational
  // list) are never distributed — hide the distribute bar and make the table
  // read-only. Falls back to the legacy name check for safety pre-migration.
  const informational = list.is_static === true || list.name === 'Trashed';

  const { data, isLoading } = useQuery<{ members: SegmentMember[]; total: number }>({
    queryKey: ['segment', list.id, page, assignedFilter, completedFilter],
    queryFn: () => apiGetSegment(list.id, {
      page, limit: PAGE_SIZE,
      assigned: assignedFilter !== 'all' ? assignedFilter : undefined,
      completed: completedFilter !== 'all' ? completedFilter : undefined,
    }),
    enabled: expanded,
  });

  const members = data?.members ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allOnPageInBasket = members.length > 0 && members.every(m => isInBasket(list.id, m.customer_phone));

  const togglePicked = (uid: string) =>
    setPicked(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);

  const distributePreview = useMemo(() => {
    if (picked.length === 0) return null;
    const eligible = scope === 'unassigned' ? unassigned : list.member_count;
    const cap = amount === 'whole' ? eligible
      : amount === 'half' ? Math.ceil(eligible / 2)
      : Math.min(parseInt(customN) || 0, eligible);
    if (cap <= 0) return 'nothing to distribute';
    if (picked.length === 1) return `${cap.toLocaleString()} → 1 agent`;
    return `~${Math.ceil(cap / picked.length)} each to ${picked.length} agents`;
  }, [picked, scope, amount, customN, unassigned, list.member_count]);

  const distribute = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const opts = amount === 'whole' ? undefined
        : amount === 'half' ? { fraction: 0.5 }
        : { limit: Math.max(0, parseInt(customN) || 0) };
      const res: any = await apiAutoAssignSegment(list.id, picked, scope, opts);
      const breakdown = res.per_agent
        ? Object.entries(res.per_agent).map(([aid, n]) => `${agents.find(a => a.user_id === aid)?.full_name || 'Agent'}: ${n}`).join(' · ')
        : '';
      toast({ title: t('assigner.nDistributed', { count: res.distributed ?? 0 }), description: breakdown || undefined });
      setPicked([]);
      onMutated();
    } catch (err: any) {
      toast({ title: t('assigner.distributionFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const unassignAll = async () => {
    setBusy(true);
    try {
      const res: any = await apiBulkUnassignSegment(list.id, 'all');
      toast({ title: t('assigner.nUnassigned', { count: res.unassigned ?? 0 }) });
      onMutated();
    } catch (err: any) {
      toast({ title: t('assigner.unassignFailed'), description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left">
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{list.name}</div>
          <div className="text-xs text-muted-foreground truncate">{list.description}</div>
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <Badge variant="outline" className="text-[10px]">{list.member_count.toLocaleString()} total</Badge>
          {informational
            ? <Badge variant="secondary" className="text-[10px]">{t('assigner.informational')}</Badge>
            : unassigned > 0
            ? <Badge className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/15">{unassigned.toLocaleString()} unassigned</Badge>
            : <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/15">all assigned</Badge>}
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 p-4 space-y-4">
          {/* ── Distribute bar (hidden for informational lists like "Trashed") ── */}
          {informational ? (
            <div className="rounded-lg border border-dashed bg-card/60 p-3 text-xs text-muted-foreground">
              {t('assigner.notDistributable')}
            </div>
          ) : (
          <div className="rounded-lg border bg-card p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('assigner.distribute')}</div>
            <AgentPickerChips agents={agents} selected={picked} onToggle={togglePicked} />
            <div className="flex flex-wrap items-center gap-4">
              {/* Scope */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{t('assigner.scope')}</span>
                {(['unassigned', 'all'] as const).map(s => (
                  <button key={s} onClick={() => setScope(s)}
                    className={cn('rounded-full px-2.5 py-1 border text-xs', scope === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted')}>
                    {s === 'unassigned' ? t('assigner.unassignedOnly') : t('assigner.allReassign')}
                  </button>
                ))}
              </div>
              {/* Amount */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{t('assigner.amount')}</span>
                {(['whole', 'half', 'custom'] as const).map(a => (
                  <button key={a} onClick={() => setAmount(a)}
                    className={cn('rounded-full px-2.5 py-1 border text-xs capitalize', amount === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted')}>
                    {a}
                  </button>
                ))}
                {amount === 'custom' && (
                  <Input type="number" min={1} value={customN} onChange={e => setCustomN(e.target.value)} className="h-7 w-20 text-xs" />
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" className="h-9 gap-1.5" disabled={picked.length === 0 || busy} onClick={distribute}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : picked.length > 1 ? <Split className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                {t('assigner.distribute')}
              </Button>
              {distributePreview && <span className="text-xs text-muted-foreground">{distributePreview}</span>}
              <Button size="sm" variant="outline" className="h-9 gap-1.5 ml-auto text-rose-700 hover:bg-rose-50"
                disabled={busy || list.assigned_count === 0} onClick={unassignAll}>
                <UserX className="h-3.5 w-3.5" /> {t('assigner.unassignAll', { count: list.assigned_count.toLocaleString() })}
              </Button>
            </div>
          </div>
          )}

          {/* ── Manual table → feeds basket ── */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={assignedFilter} onValueChange={(v) => { setAssignedFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('segmentDetail.allMembers')}</SelectItem>
                  <SelectItem value="none">{t('segmentDetail.unassignedOnly')}</SelectItem>
                  {agents.map(a => <SelectItem key={a.user_id} value={a.user_id}>{t('segmentDetail.assignedTo', { name: a.full_name })}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={completedFilter} onValueChange={(v) => { setCompletedFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('segmentDetail.anyState')}</SelectItem>
                  <SelectItem value="no">{t('segmentDetail.notYetCalled')}</SelectItem>
                  <SelectItem value="yes">{t('segmentDetail.alreadyCalled')}</SelectItem>
                </SelectContent>
              </Select>
              <span className="ml-auto text-xs text-muted-foreground">{total.toLocaleString()} matching{!informational && ' · tick rows to add to basket'}</span>
            </div>
            <SegmentMemberTable
              members={members}
              isSelected={(phone) => isInBasket(list.id, phone)}
              onToggle={(m) => toggleBasketMember(list.id, list.name, m)}
              onToggleAll={() => setBasketForMembers(list.id, list.name, members, !allOnPageInBasket)}
              allOnPageSelected={allOnPageInBasket}
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              loading={isLoading}
              compact
              selectable={!informational}
            />
          </div>
        </div>
      )}
    </div>
  );
}
