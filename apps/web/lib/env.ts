const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
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

/** Roles allowed into the panel at all. */
export const GATE_ROLES = ['Consultant', 'PowerAdmin', 'A I O N'];
