import { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits, Guild, OverwriteResolvable } from 'discord.js';
import { config, assertDiscordConfig } from '../config';

// Idempotent: creates only what's missing on your EXISTING server, leaves the rest alone.

const ROLE_DEFS = [
  { key: 'superadmin', name: 'Superadmin', color: 0xe11d48 },
  { key: 'teamlead', name: 'Team Lead', color: 0x2563eb },
  { key: 'agent', name: 'Agent', color: 0x16a34a },
  { key: 'warehouse', name: 'Warehouse', color: 0xd97706 },
] as const;

type RoleKey = (typeof ROLE_DEFS)[number]['key'];

const CATEGORY_NAME = '📊 ELYON CRM';

const CHANNELS: { name: string; roles: RoleKey[]; topic: string }[] = [
  { name: 'agent-lookup', roles: ['agent', 'teamlead', 'superadmin'], topic: 'Agents: /order /myday /mycallbacks /myshift — replies are private (ephemeral)' },
  { name: 'team-reports', roles: ['teamlead', 'superadmin'], topic: 'Team leads: /leaderboard /reportdaily /pending /callbacksdue' },
  { name: 'admin-reports', roles: ['superadmin'], topic: 'Admin: /returns /cancellations /reportrange /topproducts' },
  { name: 'customer-lookup', roles: ['superadmin'], topic: 'Admin only: /customer (customer PII)' },
  { name: 'cod-and-payroll', roles: ['superadmin', 'teamlead'], topic: '/codoutstanding /mycommission' },
  { name: 'warehouse-handoff', roles: ['warehouse', 'superadmin'], topic: 'Warehouse: /pendingshipment' },
  { name: 'bot-audit', roles: ['superadmin'], topic: 'Audit log — who ran what, when' },
];

async function ensureRole(guild: Guild, name: string, color: number): Promise<string> {
  const existing = guild.roles.cache.find((r) => r.name === name);
  if (existing) {
    console.log(`  role ✓ ${name}`);
    return existing.id;
  }
  const role = await guild.roles.create({ name, color, mentionable: false, permissions: [], reason: 'Elyon bot setup' });
  console.log(`  role + ${name} (created)`);
  return role.id;
}

async function ensureCategory(guild: Guild, name: string): Promise<string> {
  const existing = guild.channels.cache.find((c) => c?.type === ChannelType.GuildCategory && c.name === name);
  if (existing) {
    console.log(`category ✓ ${name}`);
    return existing.id;
  }
  const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'Elyon bot setup' });
  console.log(`category + ${name} (created)`);
  return cat.id;
}

function buildOverwrites(guild: Guild, botId: string, roleIds: Record<RoleKey, string>, roles: RoleKey[]): OverwriteResolvable[] {
  const ow: OverwriteResolvable[] = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // @everyone hidden
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];
  for (const rk of roles) {
    ow.push({
      id: roleIds[rk],
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.UseApplicationCommands,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  return ow;
}

async function ensureChannel(guild: Guild, name: string, parentId: string, topic: string, overwrites: OverwriteResolvable[]): Promise<string> {
  const existing = guild.channels.cache.find((c) => c?.type === ChannelType.GuildText && c.name === name);
  if (existing && existing.type === ChannelType.GuildText) {
    await existing.edit({ parent: parentId, topic, permissionOverwrites: overwrites });
    console.log(`  channel ✓ #${name} (perms enforced)`);
    return existing.id;
  }
  const ch = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId,
    topic,
    permissionOverwrites: overwrites,
    reason: 'Elyon bot setup',
  });
  console.log(`  channel + #${name} (created)`);
  return ch.id;
}

async function main(): Promise<void> {
  assertDiscordConfig();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discord.token);
  await new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));

  const guild = await client.guilds.fetch(config.discord.guildId);
  const full = await guild.fetch();
  await full.roles.fetch();
  await full.channels.fetch();
  const me = await full.members.fetchMe();

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    console.error('❌ The bot needs "Manage Roles" + "Manage Channels" for setup. Re-invite with those, run setup, then you may remove them.');
    await client.destroy();
    process.exit(1);
  }

  console.log('Ensuring roles…');
  const roleIds = {} as Record<RoleKey, string>;
  for (const r of ROLE_DEFS) roleIds[r.key] = await ensureRole(full, r.name, r.color);

  console.log('Ensuring channels…');
  const categoryId = await ensureCategory(full, CATEGORY_NAME);
  const channelIds: Record<string, string> = {};
  for (const ch of CHANNELS) {
    channelIds[ch.name] = await ensureChannel(full, ch.name, categoryId, ch.topic, buildOverwrites(full, me.id, roleIds, ch.roles));
  }

  console.log('\n✅ Setup complete. Put these into your .env:\n');
  console.log(`DISCORD_SUPERADMIN_ROLE_ID=${roleIds.superadmin}`);
  console.log(`DISCORD_TEAMLEAD_ROLE_ID=${roleIds.teamlead}`);
  console.log(`DISCORD_AGENT_ROLE_ID=${roleIds.agent}`);
  console.log(`DISCORD_WAREHOUSE_ROLE_ID=${roleIds.warehouse}`);
  console.log(`DISCORD_AUDIT_CHANNEL_ID=${channelIds['bot-audit']}`);
  console.log('\nNext: drag teammates into the roles, then run `npm run deploy-commands`.');

  await client.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Setup failed:', e);
  process.exit(1);
});
