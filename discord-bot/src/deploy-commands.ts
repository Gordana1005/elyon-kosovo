import { REST, Routes } from 'discord.js';
import { config, assertDiscordConfig } from './config';
import { commands } from './commands';

async function main(): Promise<void> {
  assertDiscordConfig();
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  console.log(`Registering ${body.length} slash commands to guild ${config.discord.guildId}…`);
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body });
  console.log('✅ Slash commands registered (guild-scoped → available instantly).');
}

main().catch((e) => {
  console.error('Command registration failed:', e);
  process.exit(1);
});
