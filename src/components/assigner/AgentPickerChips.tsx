import { AgentSelectList } from './AgentSelectList';

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
  onClear?: () => void;
  className?: string;
}

/**
 * Inline agent multi-select for the distribute panel. Shows ALL agents (online
 * first, then lightest load), each with a presence dot and its current load —
 * open prediction-list clients — so the operator can balance while
 * distributing. Offline agents stay selectable; assignment does not depend on
 * presence.
 *
 * Rendering is delegated to AgentSelectList, shared with the basket bar's
 * popover, so the two pickers cannot drift apart. It also caps its own height:
 * at ~45 agents the old free-wrapping chip list pushed everything below it off
 * the page.
 */
export function AgentPickerChips({ agents, selected, onToggle, onClear, className }: Props) {
  return (
    <AgentSelectList
      agents={agents}
      selected={selected}
      onToggle={onToggle}
      onClear={onClear}
      maxHeightClass="max-h-[240px]"
      className={className}
    />
  );
}
