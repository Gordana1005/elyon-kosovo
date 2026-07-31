import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface AgentChip {
  user_id: string;
  full_name: string;
  is_online?: boolean;
  active_leads?: number;
  /** Open (not-done) prediction-list clients currently assigned to the agent. */
  members_open?: number;
}

interface Props {
  agents: AgentChip[];
  selected: string[];
  onToggle: (agentId: string) => void;
  className?: string;
  /** Show the current load next to each name. */
  showLoad?: boolean;
}

/**
 * Multi-select agent chips. Shows ALL agents (online first), each with a
 * presence dot (green=online, grey=offline) and optionally their current
 * load — open prediction-list clients (falls back to open orders for old
 * payloads) — so the operator can balance while distributing lists. Offline
 * agents are fully selectable — assignment is allowed regardless of presence.
 */
export function AgentPickerChips({ agents, selected, onToggle, className, showLoad = true }: Props) {
  const { t } = useTranslation();
  const load = (a: AgentChip) => a.members_open ?? a.active_leads ?? 0;
  const sorted = [...agents].sort((a, b) => {
    if (!!a.is_online !== !!b.is_online) return a.is_online ? -1 : 1;
    return load(a) - load(b);
  });
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {sorted.map(a => {
        const on = selected.includes(a.user_id);
        return (
          <button
            key={a.user_id}
            type="button"
            onClick={() => onToggle(a.user_id)}
            title={showLoad ? t('assigner.openClientsTooltip') : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              on
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background hover:bg-muted border-border',
            )}
          >
            {on
              ? <Check className="h-3 w-3" />
              : <span className={cn('h-1.5 w-1.5 rounded-full', a.is_online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />}
            {a.full_name}
            {showLoad && (
              <span className={cn('opacity-70', on && 'opacity-90')}>· {load(a)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
