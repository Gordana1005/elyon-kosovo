import { ChatInputCommandInteraction, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { Tier } from '../lib/authz';
import { AgentLink } from '../identity/store';

export interface Ctx {
  tiers: Set<Tier>;
  isSuper: boolean;
  isLead: boolean;
  isAgent: boolean;
  isWarehouse: boolean;
  /** True when the invoker should see masked customer PII (team leads). */
  masked: boolean;
  /** The invoker's linked CRM agent, if any. */
  link: AgentLink | null;
}

export interface BotCommand {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  allowedTiers: Tier[];
  /** If true, anyone can run it (bypasses the tier gate) — e.g. /help. */
  public?: boolean;
  /** Default reply visibility. PII/personal commands should be ephemeral. */
  ephemeral?: boolean;
  execute(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void>;
}
