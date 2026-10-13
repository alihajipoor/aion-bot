import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Guild } from 'discord.js';
import * as S from './service.js';

/**
 * The web panel's door into AION Coin: /eco/* on the bot's loopback API.
 *
 * Authentication is the API's own bearer secret, checked before anything here
 * runs. Who on the panel may do what (Dev for anything that writes) is checked
 * by the panel, which knows the signed-in member; every write carries their
 * Discord id as `actorId`, so economy-log says who did it, exactly as it would
 * for a button press in Discord.
 *
 * All the work is in service.ts, shared with the Discord buttons and /eco.
 */

type Json = (res: ServerResponse, code: number, body: unknown) => void;
type Body = (req: IncomingMessage) => Promise<Record<string, unknown>>;

const MAX_IMAGE = 8 * 1024 * 1024;

/** A raw request body — the image upload — capped well above JSON's 64 KB. */
async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error('image too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const int = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const actorOf = (b: Record<string, unknown>) => str(b.actorId);

/** Handles /eco/*; returns false for any other path so the API carries on routing. */
export async function ecoRoute(req: IncomingMessage, res: ServerResponse, url: URL, g: Guild, json: Json, readBody: Body): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith('/eco/')) return false;
  const send = (r: S.Act) => json(res, r.ok ? 200 : 400, r);

  if (req.method === 'GET') {
    if (p === '/eco/overview') { json(res, 200, await S.overview(g)); return true; }
    if (p === '/eco/products') { json(res, 200, { products: await S.productsView(g) }); return true; }
    if (p === '/eco/orders') {
      const status = (url.searchParams.get('status') ?? 'pending') as Parameters<typeof S.ordersView>[1];
      json(res, 200, { orders: await S.ordersView(g, status) }); return true;
    }
    if (p === '/eco/member') {
      const m = await S.memberView(g, url.searchParams.get('q') ?? '');
      json(res, m ? 200 : 404, m ? { member: m } : { ok: false, message: 'Peyda nashod.' }); return true;
    }
    if (p === '/eco/invites') { json(res, 200, { invites: await S.heldInvitesView(g) }); return true; }
    if (p === '/eco/log') { json(res, 200, { entries: await S.logView(g) }); return true; }
  }

  if (req.method === 'POST') {
    // The picture comes as raw bytes, not JSON: ?id=…&actorId=…, with its type in the header.
    if (p === '/eco/product/image') {
      const id = Number(url.searchParams.get('id'));
      const actorId = url.searchParams.get('actorId') ?? '';
      const clear = url.searchParams.get('clear') === '1';
      let bytes: Buffer | null = null;
      if (!clear) {
        try { bytes = await readRaw(req, MAX_IMAGE); } catch { send({ ok: false, message: 'Aks kheili bozorge — hadde-aksar 8MB.' }); return true; }
      }
      send(await S.setProductImage(g, id, bytes, str(req.headers['content-type']), actorId)); return true;
    }

    const b = await readBody(req);
    const actor = actorOf(b);
    if (!actor) { json(res, 400, { ok: false, message: 'actorId lazeme.' }); return true; }

    if (p === '/eco/order/decide') {
      const mode = str(b.mode) as 'send' | 'done' | 'reject';
      if (!['send', 'done', 'reject'].includes(mode)) { json(res, 400, { ok: false, message: 'mode dorost nist.' }); return true; }
      send(await S.decideOrder(g, Number(b.id), mode, str(b.text), actor)); return true;
    }
    if (p === '/eco/adjust') { send(await S.adjustCoins(g, str(b.userId), Number(b.delta), str(b.reason), actor)); return true; }
    if (p === '/eco/freeze') { send(await S.setFreeze(g, str(b.userId), b.frozen === true, actor)); return true; }
    if (p === '/eco/invite/decide') { send(await S.decideInvite(g, str(b.inviteeId), b.approve === true, actor)); return true; }
    if (p === '/eco/launch') { send(await S.setLaunch(g, b.enabled === true, actor)); return true; }
    if (p === '/eco/rules') { send(await S.setRules(g, (b.rules ?? {}) as Partial<S.Rules>, actor)); return true; }
    if (p === '/eco/product/remove') { send(await S.removeProduct(g, Number(b.id), actor)); return true; }
    if (p === '/eco/product') {
      const input: S.ProductInput = {
        ...(b.name !== undefined ? { name: str(b.name) } : {}),
        ...(b.price !== undefined ? { price: Number(b.price) } : {}),
        ...('stockPerMonth' in b ? { stockPerMonth: b.stockPerMonth === null || b.stockPerMonth === '' ? null : int(b.stockPerMonth)! } : {}),
        ...('perUserMonth' in b ? { perUserMonth: b.perUserMonth === null || b.perUserMonth === '' ? null : int(b.perUserMonth)! } : {}),
        ...('description' in b ? { description: b.description === null ? null : str(b.description) } : {}),
        ...('note' in b ? { note: b.note === null ? null : str(b.note) } : {}),
        ...(b.active !== undefined ? { active: b.active === true } : {}),
        ...(b.sortOrder !== undefined ? { sortOrder: Number(b.sortOrder) } : {}),
      };
      send(b.id ? await S.updateProduct(g, Number(b.id), input, actor) : await S.createProduct(g, input, actor)); return true;
    }
  }

  json(res, 404, { ok: false, message: 'not found' });
  return true;
}
