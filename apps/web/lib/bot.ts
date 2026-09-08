import { env } from './env';

/** Calls the bot's loopback control API. */
async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${env.botApi()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.botApiSecret()}`,
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    // The bot may be restarting; the panel must still render.
    return null;
  }
}

export interface Health {
  ok: boolean; uptimeMs: number; ping: number; rssMb: number;
  guild: {
    name: string; members: number; humans: number; online: number;
    inVoice: number; roles: number; channels: number; boostTier: number;
  };
}

export const getHealth = () => call<Health>('/health');
export const getChannels = () => call<{ channels: { id: string; name: string; parent: string | null }[] }>('/channels');
export const getRoles = () => call<{ roles: { id: string; name: string; color: string; members: number }[] }>('/roles');

export const sendAnnouncement = (body: {
  channelId: string; content: string; mentions: string[]; asCard: boolean;
}) => call<{ ok: boolean; messageId: string }>('/announce', {
  method: 'POST', body: JSON.stringify(body),
});
