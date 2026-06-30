import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var ${name} (see .env.example / CHECKLIST.md)`);
  return v.trim();
}
function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN?.trim() || '',
    clientId: process.env.DISCORD_CLIENT_ID?.trim() || '',
    guildId: process.env.DISCORD_GUILD_ID?.trim() || '',
    roles: {
      superadmin: opt('DISCORD_SUPERADMIN_ROLE_ID'),
      teamlead: opt('DISCORD_TEAMLEAD_ROLE_ID'),
      agent: opt('DISCORD_AGENT_ROLE_ID'),
      warehouse: opt('DISCORD_WAREHOUSE_ROLE_ID'),
    },
    auditChannelId: opt('DISCORD_AUDIT_CHANNEL_ID'),
  },
  tz: process.env.BOT_TZ?.trim() || 'Europe/Belgrade',
  identityPath: process.env.IDENTITY_DB_PATH?.trim() || './data/identity.json',
};

/** Validate everything needed to run the bot (gateway + DB). Throws on first problem. */
export function assertRuntimeConfig(): void {
  req('DISCORD_TOKEN');
  req('DISCORD_CLIENT_ID');
  req('DISCORD_GUILD_ID');
  req('DATABASE_URL');
  if (!config.discord.roles.superadmin) {
    throw new Error('Missing required env var DISCORD_SUPERADMIN_ROLE_ID (the bot refuses to start without a superadmin role)');
  }
}

/** Validate the subset needed for the Discord-only scripts (deploy / setup). */
export function assertDiscordConfig(): void {
  req('DISCORD_TOKEN');
  req('DISCORD_CLIENT_ID');
  req('DISCORD_GUILD_ID');
}
