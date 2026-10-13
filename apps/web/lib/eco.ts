import { env } from './env';
import type { AionSettings } from '@aion/db';

/**
 * The panel's side of AION Coin: the bot's /eco/* routes.
 *
 * Unlike call() in bot.ts, a refusal keeps its message — "faghat 12 coin
 * dare" is the answer the Dev needs, not a generic failure — and only a bot
 * that does not answer at all comes back as null.
 */
async function eco<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${env.botApi()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${env.botApiSecret()}`, ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    if (res.status >= 500 || res.status === 401 || res.status === 404 && !path.startsWith('/eco/member')) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export interface Act { ok: boolean; message: string }
const post = (path: string, body: Record<string, unknown>) => eco<Act>(path, { method: 'POST', body: JSON.stringify(body) });

export type Economy = AionSettings['economy'];

export interface Overview {
  economy: Economy;
  mintedWeek: number; spentWeek: number; inCirculation: number;
  holders: number; pendingOrders: number; heldInvites: number;
}
export interface Product {
  id: number; name: string; description: string | null; note: string | null; price: number;
  stockPerMonth: number | null; perUserMonth: number | null; active: boolean; sortOrder: number;
  image: string | null; soldThisMonth: number; createdAt: string; updatedAt: string;
}
export interface Order {
  id: number; userId: string; buyer: string | null; productId: number; productName: string; price: number;
  status: 'pending' | 'delivered' | 'rejected' | 'cancelled'; note: string | null;
  createdAt: string; decidedAt: string | null; decidedBy: string | null; decider: string | null;
}
export interface Entry {
  id: number; userId: string; member?: string | null; delta: number; kind: string; reason: string | null;
  refId: string | null; actorId: string | null; actor: string | null; createdAt: string;
}
export interface Member {
  userId: string; name: string | null; username: string | null; inServer: boolean;
  balance: number; earned: number; voiceMinutes: number; frozen: boolean; lastVoiceAt: string | null;
  history: Entry[];
}
export interface HeldInvite {
  inviteeId: string; invitee: string | null; inviterId: string; inviter: string | null;
  joinedAt: string; verifiedAt: string;
}

export const getOverview = () => eco<Overview>('/eco/overview');
export const getProducts = () => eco<{ products: Product[] }>('/eco/products');
export const getOrders = (status: string) => eco<{ orders: Order[] }>(`/eco/orders?status=${encodeURIComponent(status)}`);
export const getMember = (q: string) => eco<{ member?: Member; ok?: boolean; message?: string }>(`/eco/member?q=${encodeURIComponent(q)}`);
export const getHeldInvites = () => eco<{ invites: HeldInvite[] }>('/eco/invites');
export const getLog = () => eco<{ entries: Entry[] }>('/eco/log');

export const ecoLaunch = (enabled: boolean, actorId: string) => post('/eco/launch', { enabled, actorId });
export const ecoRules = (rules: Partial<Economy>, actorId: string) => post('/eco/rules', { rules, actorId });
export const ecoProduct = (body: Record<string, unknown>, actorId: string) => post('/eco/product', { ...body, actorId });
export const ecoRemoveProduct = (id: number, actorId: string) => post('/eco/product/remove', { id, actorId });
export const ecoDecideOrder = (id: number, mode: 'send' | 'done' | 'reject', text: string, actorId: string) =>
  post('/eco/order/decide', { id, mode, text, actorId });
export const ecoAdjust = (userId: string, delta: number, reason: string, actorId: string) =>
  post('/eco/adjust', { userId, delta, reason, actorId });
export const ecoFreeze = (userId: string, frozen: boolean, actorId: string) => post('/eco/freeze', { userId, frozen, actorId });
export const ecoDecideInvite = (inviteeId: string, approve: boolean, actorId: string) =>
  post('/eco/invite/decide', { inviteeId, approve, actorId });

/** The picture goes as its own bytes, not JSON: the bot's JSON reader stops at 64 KB. */
export async function ecoImage(id: number, file: File | null, actorId: string): Promise<Act | null> {
  const q = `/eco/product/image?id=${id}&actorId=${encodeURIComponent(actorId)}${file ? '' : '&clear=1'}`;
  return eco<Act>(q, {
    method: 'POST',
    headers: { 'content-type': file?.type || 'application/octet-stream' },
    body: file ? Buffer.from(await file.arrayBuffer()) : '',
  });
}
