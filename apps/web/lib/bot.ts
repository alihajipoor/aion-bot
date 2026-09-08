import { env } from './env';
import type { AionSettings } from '@aion/db';

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

export const getSettings = () => call<{ settings: AionSettings }>('/settings');
export const putSettings = (settings: AionSettings) =>
  call<{ settings: AionSettings }>('/settings', { method: 'PUT', body: JSON.stringify(settings) });

export interface Category { id: string; name: string; channels: { id: string; name: string; type: string }[] }
export const getCategories = () => call<{ categories: Category[] }>('/categories');

export interface VoiceRoom {
  id: string; name: string; parent: string | null;
  members: { id: string; name: string; muted: boolean; deafened: boolean; streaming: boolean }[];
}
export const getVoice = () => call<{ rooms: VoiceRoom[] }>('/voice');

export const decideVerification = (body: { id: number; approve: boolean; staffId: string; staffTag: string; reason?: string }) =>
  call<{ ok: boolean; message: string }>('/verify/decide', { method: 'POST', body: JSON.stringify(body) });

export const liftSanction = (body: { userId: string; section: string; type: string; byId: string }) =>
  call<{ ok: boolean; message: string }>('/moderation/lift', { method: 'POST', body: JSON.stringify(body) });

export interface PanelMember {
  id: string; username: string; nickname: string | null; avatar: string;
  joinedAt: number | null; inVoice: boolean;
  roles: { id: string; name: string; color: string }[];
}
export const getMembers = (q = '', limit = 60) =>
  call<{ total: number; members: PanelMember[] }>(`/members?q=${encodeURIComponent(q)}&limit=${limit}`);

type Act = { ok: boolean; message: string };
const post = (path: string, body: unknown) =>
  call<Act>(path, { method: 'POST', body: JSON.stringify(body) });

export const memberMove = (userId: string, channelId: string) => post('/member/move', { userId, channelId });
export const memberDisconnect = (userId: string) => post('/member/disconnect', { userId });
export const memberVoiceMute = (userId: string, mute: boolean) => post('/member/voicemute', { userId, mute });
export const memberDeafen = (userId: string, deaf: boolean) => post('/member/deafen', { userId, deaf });
export const memberRole = (userId: string, roleId: string, add: boolean) => post('/member/role', { userId, roleId, add });
export const memberTimeout = (userId: string, minutes: number) => post('/member/timeout', { userId, minutes });
export const memberPunish = (b: {
  userId: string; section: string; type: string; minutes: number; reason: string; byId: string; byTag: string;
}) => post('/member/punish', b);
