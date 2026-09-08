/** Registers slash commands to the single guild (instant, unlike global). */
import { REST, Routes } from 'discord.js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { logger } from './lib/log.js';
import type { Command } from './types.js';

const log = logger('register');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'commands');

const body: unknown[] = [];
for (const f of await readdir(dir)) {
  if (!/\.(ts|js)$/.test(f) || f.endsWith('.d.ts')) continue;
  const mod = await import(pathToFileURL(join(dir, f)).href) as { default?: Command };
  if (mod.default?.data) body.push(mod.default.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(config.token);
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
log.info(`registered ${body.length} command(s) to guild ${config.guildId}`);
