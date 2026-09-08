/** Fail fast and loudly: a bot that boots with half its config is worse than one that refuses. */
function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[config] missing required env var: ${name}`);
    process.exit(1);
  }
  return v.trim();
}
function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  token:        required('DISCORD_TOKEN'),
  clientId:     required('DISCORD_CLIENT_ID'),
  guildId:      required('LIVE_GUILD_ID'),
  databaseUrl:  optional('DATABASE_URL'),
  logLevel:     optional('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  nodeEnv:      optional('NODE_ENV', 'development'),
} as const;

export const isProd = config.nodeEnv === 'production';
