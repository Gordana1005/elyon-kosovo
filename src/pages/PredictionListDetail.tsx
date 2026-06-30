import { useState, useEffect } from 'react';
import { apiErrorText } from '@/i18n/apiErrors';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { predictionLeadLabel, PREDICTION_LEAD_COLORS } from '@/types';
import { UserPlus, UserMinus, ArrowLeft, CheckSquare, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { apiGetPredictionList, apiGetAgents, apiAssignLeads, apiUnassignLeads } from '@/lib/api';

interface LeadEntry {
  id: string;
  name: string;
  telephone: string;
  city: string | null;
  product: string | null;
  status: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
}

interface Agent {
  user_id: string;
  full_name: string;
  email: string;
}

export default function PredictionListDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin;

  const [list, setList] = useState<any>(null);
  const [entries, setEntries] = useState<LeadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [unassigning, setUnassigning] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'unassigned' | 'assigned'>('unassigned');

  const fetchList = () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    apiGetPredictionList(id)
      .then((data) => {
        setList(data);
        setEntries(data.entries || []);
      })
      .catch((err) => {
        console.error('Failed to load prediction list:', err);
        setError(err.message || t('predDetail.failedLoadList'));
        setList(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, [id]);

  const openAssign = () => {
    apiGetAgents().then(setAgents).catch(() => {});
    setAssignOpen(true);
  };

  if (loading) {
    return (
      <AppLayout title={t('titles.predictionList')}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!list && !error) {
    return (
      <AppLayout title={t('titles.predictionList')}>
        <p className="text-muted-foreground">{t('predDetail.listNotFound')}</p>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout title={t('titles.predictionList')}>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchList}>{t('common.retry')}</Button>
        </div>
      </AppLayout>
    );
  }

  const toggleSelect = (entryId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      return next;
    });
  };

  const toggleAll = () => {
    const pool = selectionMode === 'unassigned'
      ? entries.filter(e => !e.assigned_agent_id)
      : entries.filter(e => !!e.assigned_agent_id);
    if (selected.size === pool.length && pool.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pool.map(e => e.id)));
    }
  };

  const switchMode = (mode: 'unassigned' | 'assigned') => {
    setSelectionMode(mode);
    setSelected(new Set());
  };

  const handleBulkAssign = async (agentId: string) => {
    try {
      await apiAssignLeads(id!, agentId, Array.from(selected));
      toast({ title: t('predDetail.entriesAssigned') });
      setSelected(new Set());
      setAssignOpen(false);
      fetchList();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    }
  };

  const handleBulkUnassign = async () => {
    setUnassigning(true);
    try {
      await apiUnassignLeads(Array.from(selected));
      toast({ title: t('predDetail.nUnassigned', { count: selected.size }) });
      setSelected(new Set());
      fetchList();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally {
      setUnassigning(false);
    }
  };

  const unassignedCount = entries.filter(e => !e.assigned_agent_id).length;
  const assignedCount = entries.filter(e => !!e.assigned_agent_id).length;

  const isSelectable = (entry: LeadEntry) => {
    if (selectionMode === 'unassigned') return !entry.assigned_agent_id;
    return !!entry.assigned_agent_id;
  };

  return (
    <AppLayout title={list.name}>
      <div className="mb-4">
        <Link to="/predictions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> {t('nav.predictionLists')}
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{list.total_records} {t('segments.members')}</span>
          <span>{list.assigned_count} {t('segments.assigned')}</span>
          <span>{unassignedCount} {t('segments.unassigned')}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle for admins */}
          {isAdmin && (
            <div className="flex rounded-lg border overflow-hidden">
              <button
                onClick={() => switchMode('unassigned')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  selectionMode === 'unassigned' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'
                )}
              >
                {t('predDetail.selectUnassigned', { count: unassignedCount })}
              </button>
              <button
                onClick={() => switchMode('assigned')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  selectionMode === 'assigned' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'
                )}
              >
                {t('predDetail.selectAssigned', { count: assignedCount })}
              </button>
            </div>
          )}

          {selected.size > 0 && selectionMode === 'unassigned' && (
            <Button onClick={openAssign} className="gap-2">
              <UserPlus className="h-4 w-4" /> {t('predDetail.assignSelected', { count: selected.size })}
            </Button>
          )}
          {selected.size > 0 && selectionMode === 'assigned' && isAdmin && (
            <>
              <Button variant="destructive" onClick={handleBulkUnassign} disabled={unassigning} className="gap-2">
                <UserMinus className="h-4 w-4" /> {t('predDetail.unassignSelected', { count: selected.size })}
              </Button>
              <Button onClick={openAssign} variant="outline" className="gap-2">
                <UserPlus className="h-4 w-4" /> {t('predDetail.reassign')}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left">
                <button onClick={toggleAll} className="flex items-center justify-center">
                  <CheckSquare className={cn('h-4 w-4', selected.size > 0 ? 'text-primary' : 'text-muted-foreground')} />
                </button>
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('search.name')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('predDetail.colTelephone')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('orderModal.city')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('ordersPage.colProduct')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('ordersPage.colStatus')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('search.colAgent')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id} className={cn('border-b last:border-0 transition-colors', selected.has(entry.id) ? 'bg-primary/5' : 'hover:bg-muted/30')}>
                <td className="px-4 py-3">
                  {isSelectable(entry) ? (
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                      className="h-4 w-4 rounded border-muted-foreground accent-primary"
                    />
                  ) : (
                    <span className="h-4 w-4 block" />
                  )}
                </td>
                <td className="px-4 py-3 font-medium">{entry.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{entry.telephone}</td>
                <td className="px-4 py-3">{entry.city}</td>
                <td className="px-4 py-3">{entry.product}</td>
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', PREDICTION_LEAD_COLORS[entry.status as keyof typeof PREDICTION_LEAD_COLORS] || '')}>
                    {predictionLeadLabel(entry.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {entry.assigned_agent_name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                        {entry.assigned_agent_name.charAt(0)}
                      </span>
                      {entry.assigned_agent_name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk Assign/Reassign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectionMode === 'assigned' ? t('predDetail.reassignUser') : t('predDetail.assignUser')}</DialogTitle>
            <DialogDescription>{selectionMode === 'assigned' ? t('predDetail.dialogDescReassign', { count: selected.size }) : t('predDetail.dialogDescAssign', { count: selected.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {agents.map(agent => (
              <button
                key={agent.user_id}
                onClick={() => handleBulkAssign(agent.user_id)}
                className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-muted transition-colors"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {agent.full_name.charAt(0)}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{agent.full_name}</p>
                  <p className="text-xs text-muted-foreground">{agent.email}</p>
                </div>
                {(agent as any).roles && (
                  <span className="text-[10px] text-muted-foreground capitalize">{(agent as any).roles.join(' + ')}</span>
                )}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>{t('common.cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
