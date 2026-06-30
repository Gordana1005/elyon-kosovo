import { Client, GatewayIntentBits, Events, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import { config, assertRuntimeConfig } from './config';
import { commandMap } from './commands';
import { Ctx } from './commands/_types';
import { memberRoleIds, tiersFor, canRun, tierLabel } from './lib/authz';
import { identity } from './identity/store';
import { audit } from './lib/audit';
import { errorEmbed } from './lib/embeds';
import { pingDb } from './db/pool';

async function safeError(interaction: ChatInputCommandInteraction, msg: string): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [errorEmbed(msg)] });
    else await interaction.reply({ embeds: [errorEmbed(msg)], flags: MessageFlags.Ephemeral });
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  assertRuntimeConfig();

  try {
    await pingDb();
    console.log('[db] connected (read-only)');
  } catch (e: any) {
    console.error('[db] connection FAILED:', e.message);
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`[bot] logged in as ${c.user.tag} — ${commandMap.size} commands ready`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = commandMap.get(interaction.commandName);
    const tiers = tiersFor(memberRoleIds(interaction));

    if (!cmd) {
      await safeError(interaction, 'Unknown command.');
      return;
    }

    // ---- fail-closed permission gate (authoritative) ----
    if (!cmd.public && !canRun(tiers, cmd.allowedTiers)) {
      await audit(client, interaction, tierLabel(tiers), 'denied');
      await safeError(interaction, 'You don’t have permission to use this command.');
      return;
    }

    const isSuper = tiers.has('SUPERADMIN');
    const isLead = !isSuper && tiers.has('TEAMLEAD');
    const isAgent = !isSuper && !isLead && tiers.has('AGENT');
    const ctx: Ctx = {
      tiers,
      isSuper,
      isLead,
      isAgent,
      isWarehouse: tiers.has('WAREHOUSE'),
      masked: isLead, // team leads see masked customer PII
      link: identity.get(interaction.user.id),
    };

    try {
      await interaction.deferReply(cmd.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      await audit(client, interaction, tierLabel(tiers), 'ok');
      await cmd.execute(interaction, ctx);
    } catch (err) {
      console.error(`[cmd:${interaction.commandName}]`, err);
      await safeError(interaction, 'Something went wrong running that command. Try again or contact an admin.');
    }
  });

  await client.login(config.discord.token);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
