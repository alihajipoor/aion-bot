import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './lib/log.js';
import type { Command, EventHandler } from './types.js';

const log = logger('client');
const here = dirname(fileURLToPath(import.meta.url));

export class AionClient extends Client {
  readonly commands = new Collection<string, Command>();
  readonly startedAt = Date.now();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,          // privileged
        GatewayIntentBits.GuildPresences,        // privileged — online counts
        GatewayIntentBits.MessageContent,        // privileged — edit/delete logs
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,       // bans + audit-log entry events
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution,
      ],
      // Without these, deletes/edits of uncached messages never fire.
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
    });
  }

  async loadAll(): Promise<void> {
    await this.#load('commands', async (mod, file) => {
      const cmd = (mod as { default?: Command }).default;
      if (!cmd?.data) return log.warn(`skipping ${file}: no default export with .data`);
      this.commands.set(cmd.data.name, cmd);
    });
    await this.#load('events', async (mod, file) => {
      const ev = (mod as { default?: EventHandler }).default;
      if (!ev?.name) return log.warn(`skipping ${file}: no default export with .name`);
      const bound = (...args: unknown[]) => {
        void Promise.resolve(ev.run(this, ...args)).catch(e => log.error(`event ${ev.name} threw`, e));
      };
      ev.once ? this.once(ev.name, bound) : this.on(ev.name, bound);
    });
    log.info(`loaded ${this.commands.size} command(s)`);
  }

  async #load(dir: string, add: (mod: unknown, file: string) => Promise<void>): Promise<void> {
    const path = join(here, dir);
    let files: string[];
    try { files = await readdir(path); } catch { return; }
    for (const f of files) {
      if (!/\.(ts|js)$/.test(f) || f.endsWith('.d.ts')) continue;
      await add(await import(pathToFileURL(join(path, f)).href), f);
    }
  }
}
