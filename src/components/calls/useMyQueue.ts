import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * Sentinel list_id for the VIRTUAL "Pendings" queue entry. Assigned leads
 * (orders.status='pending') are not prediction segment members, so they have no
 * real list row — but agents must be able to see how many they have left and
 * switch to them at will, which means they need a seat in the same queue
 * dropdown. CallsPage prepends the entry; everything list-scoped in here must
 * short-circuit on it so the sentinel never reaches PostgREST as a UUID.
 */
export const PENDINGS_QUEUE_ID = '__pendings__';

export interface QueueListSummary {
  list_id: string;
  list_name: string;
  list_category: string;
  display_order: number;
  total: number;
  remaining: number;
  /** Set only on the virtual Pendings entry — changes how the label renders. */
  is_pendings?: boolean;
  /** Pendings only: leads this agent already resolved today. */
  talked?: number;
}

export interface QueueMember {
  list_id: string;
  customer_phone: string;
  customer_name: string | null;
  trigger_event_at: string;
  paid_count: number;
  lifetime_value: number;
  avg_package_price?: number | null;   // NEW from priority + 21d migration
}

/**
 * Data layer for an agent's queue. The Calls page consumes this without
 * rendering a visible queue panel — agents see a single live customer at a
 * time, not a list of how many remain. RLS scopes selects to
 * assigned_agent_id = auth.uid() so this is naturally per-agent.
 */
export function useMyQueue(activeListId: string | null, onMembersLoaded?: (listId: string, members: QueueMember[]) => void) {
  const { user } = useAuth();

  const queues = useQuery<QueueListSummary[]>({
    queryKey: ['my-queue-summary', user?.id],
    queryFn: async () => {
      if (!user) return [];
      // Page through assigned-to-me member rows; aggregate counts client-side.
      const all: any[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('prediction_segment_members')
          .select('list_id, customer_phone, is_completed, in_call_again_until, prediction_segment_lists(id, name, category, display_order)')
          .eq('assigned_agent_id', user.id)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      const now = Date.now();
      const byList = new Map<string, QueueListSummary>();
      for (const row of all) {
        const info = row.prediction_segment_lists;
        if (!info) continue;
        if (!byList.has(info.id)) {
          byList.set(info.id, {
            list_id: info.id,
            list_name: info.name,
            list_category: info.category,
            display_order: info.display_order ?? 0,
            total: 0,
            remaining: 0,
          });
        }
        const slot = byList.get(info.id)!;
        slot.total++;
        const onHold = row.in_call_again_until && new Date(row.in_call_again_until).getTime() > now;
        if (!row.is_completed && !onHold) slot.remaining++;
      }
      // Hardening note (post Option 1 exclusive redesign + 21-day floor):
      // A customer phone now belongs to *at most one* active prediction_segment_members row across all lists (zero duplicates).
      // This summary still correctly supports agents having work from *multiple different lists* (different phones).
      // Composite list scoping + per-list member queries remain robust. Backend recompute enforces exclusivity.
      return [...byList.values()].sort((a, b) => a.display_order - b.display_order);
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const members = useQuery<QueueMember[]>({
    queryKey: ['my-queue-members', user?.id, activeListId],
    queryFn: async () => {
      // The Pendings sentinel is not a real list — leads are served straight
      // from the orders query in CallsPage, so there are no members to fetch.
      if (!user || !activeListId || activeListId === PENDINGS_QUEUE_ID) return [];
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('prediction_segment_members')
        .select('list_id, customer_phone, customer_name, trigger_event_at, paid_count, lifetime_value, avg_package_price, in_call_again_until, is_completed')
        .eq('assigned_agent_id', user.id)
        .eq('list_id', activeListId)
        .eq('is_completed', false)
        .or(`in_call_again_until.is.null,in_call_again_until.lt.${nowIso}`)
        .order('trigger_event_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const raw = (data || []).map(d => ({
        list_id: d.list_id,
        customer_phone: d.customer_phone,
        customer_name: d.customer_name,
        trigger_event_at: d.trigger_event_at,
        paid_count: d.paid_count,
        lifetime_value: Number(d.lifetime_value || 0),
        avg_package_price: d.avg_package_price != null ? Number(d.avg_package_price) : null,
      }));
      if (raw.length === 0) return raw;
      // Exclusive model hardening: query is already scoped to one list_id + assigned_agent.
      // Per Option 1 (chosen for minimal blast radius), same phone cannot appear in another list.
      // Filter out phones currently held by OTHER agents — they have an
      // exclusive Personal-List claim. Phones held by the current agent
      // stay visible (they should still call those customers).
      const phones = raw.map(r => r.customer_phone);
      const { data: holds } = await supabase
        .from('personal_list_holds')
        .select('customer_phone, agent_id')
        .in('customer_phone', phones)
        .eq('status', 'active');
      const heldByOthers = new Set(
        (holds || [])
          .filter(h => h.agent_id !== user.id)
          .map(h => h.customer_phone)
      );
      return heldByOthers.size > 0 ? raw.filter(r => !heldByOthers.has(r.customer_phone)) : raw;
    },
    enabled: !!user && !!activeListId && activeListId !== PENDINGS_QUEUE_ID,
  });

  useEffect(() => {
    if (activeListId && activeListId !== PENDINGS_QUEUE_ID && members.data) {
      onMembersLoaded?.(activeListId, members.data);
    }
  }, [activeListId, members.data, onMembersLoaded]);

  return { queues: queues.data || [], queuesLoading: queues.isLoading, members: members.data || [] };
}

export function useQueueMutations() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return {
    markAfterCall: async (listId: string, customerPhone: string, outcome: string, opts?: { retryMs?: number }) => {
      if (!user) return;

      // Outcomes that schedule a retry (not completed):
      //   no_answer / call_again / didnt_answer → short cooldown, then resurface
      //
      // Outcomes that finish the customer for this list:
      //   confirmed, cancelled, trash, wrong_number, interested, not_interested
      //
      // 'trash' specifically also means "do not contact again" — same
      // is_completed=true here. If the customer ever generates a new order,
      // the segment classifier will re-evaluate them; no soft-delete column
      // for now.
      // No-answer / call-again apply a SHORT cooldown (~3–4h): the customer is
      // skipped in the calling bucket for a few hours, then resurfaces. This is
      // an OPTIMISTIC value only — the authoritative schedule (2 calls/day, the
      // ~09:00 next-day resume once the daily cap is hit, and the 9-strike
      // auto-trash → Unreachable) is owned server-side by POST /call-logs and
      // overwrites this on the next refetch. We match its intra-day ~3.5h gap.
      const RETRY_COOLDOWN_MS = 3.5 * 60 * 60 * 1000;
      const isRetry = outcome === 'no_answer' || outcome === 'call_again' || outcome === 'didnt_answer';
      const retryMs = opts?.retryMs ?? RETRY_COOLDOWN_MS;

      const update: Record<string, any> = {
        last_call_at: new Date().toISOString(),
        // Persist as a valid leaf outcome — 'didnt_answer' maps to 'no_answer'.
        last_call_outcome: outcome === 'didnt_answer' ? 'no_answer' : outcome,
      };
      if (isRetry) {
        update.in_call_again_until = new Date(Date.now() + retryMs).toISOString();
        update.is_completed = false;
      } else {
        update.is_completed = true;
        update.in_call_again_until = null;
      }
      await supabase
        .from('prediction_segment_members')
        .update(update)
        .eq('list_id', listId)
        .eq('customer_phone', customerPhone)
        .eq('assigned_agent_id', user.id);
      qc.invalidateQueries({ queryKey: ['my-queue-summary'] });
      qc.invalidateQueries({ queryKey: ['my-queue-members'] });
    },
    skipMember: async (listId: string, customerPhone: string) => {
      if (!user) return;
      await supabase
        .from('prediction_segment_members')
        .update({
          in_call_again_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          last_call_outcome: 'skipped',
          last_call_at: new Date().toISOString(),
        })
        .eq('list_id', listId)
        .eq('customer_phone', customerPhone)
        .eq('assigned_agent_id', user.id);
      qc.invalidateQueries({ queryKey: ['my-queue-summary'] });
      qc.invalidateQueries({ queryKey: ['my-queue-members'] });
    },
  };
}
