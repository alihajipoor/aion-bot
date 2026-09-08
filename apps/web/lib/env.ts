const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  // A short signing secret is worse than a missing one: it fails silently.
  if (/SECRET/.test(name) && v.length < 32) {
    throw new Error(`${name} is too short (${v.length} chars) — use at least 32`);
  }
  return v;
};

export const env = {
  clientId: () => need('DISCORD_CLIENT_ID'),
  clientSecret: () => need('DISCORD_CLIENT_SECRET'),
  botToken: () => need('DISCORD_TOKEN'),
  guildId: () => need('LIVE_GUILD_ID'),
  sessionSecret: () => need('PANEL_SESSION_SECRET'),
  baseUrl: () => process.env.PANEL_BASE_URL ?? 'https://aion.neoxify.com',
  botApi: () => process.env.BOT_API_URL ?? 'http://127.0.0.1:4785',
  botApiSecret: () => need('BOT_API_SECRET'),
};

/**
 * Roles allowed into the panel. PowerAdmin is deliberately excluded: it is a
 * moderation tier, not a configuration tier. `A I O N` is the configurer role.
 * The server owner is always allowed, checked separately.
 */
export const GATE_ROLES = ['Consultant', 'Dev'];
