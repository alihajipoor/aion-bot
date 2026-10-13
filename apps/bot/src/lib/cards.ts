import type { GuildMember } from 'discord.js';
import { BRAND, aurora, glass, draw, el, lambda, rift, say, WORDMARK } from './banner.js';
import { logger } from './log.js';

/**
 * The cards members see when they talk to the bot: their wallet, the shop,
 * a purchase receipt, a birthday.
 *
 * All in the look the owner chose on 2026-10-13 ("option C"): the server
 * header's ink, its light and its rift, with option 1's frosted glass over a
 * blue aurora. Every piece comes from banner.ts so a card, a leaderboard and the
 * header read as one server.
 *
 * Each renderer returns null rather than throwing. A card is decoration on a
 * reply that must still be sent: the callers post their text either way.
 */

const log = logger('cards');
const abs = { position: 'absolute', display: 'flex' } as const;
const W = 1200;

const label = (s: string, style: Record<string, unknown> = {}) =>
  el('div', { display: 'flex', fontSize: 17, letterSpacing: 6, color: BRAND.dim, whiteSpace: 'pre', ...style }, s);
const wordmark = (size: number) => el('div', {
  display: 'flex', alignItems: 'center', fontSize: size, fontWeight: 700, letterSpacing: size * 0.16,
  color: BRAND.text, textShadow: `0 0 ${Math.round(size * 0.25)}px ${BRAND.blue}f2`,
}, [lambda(size), el('div', { display: 'flex' }, WORDMARK)]);
const bar = (w: number, fraction: number, h = 12) => el('div', {
  display: 'flex', width: w, height: h, borderRadius: h, background: BRAND.track, border: '1px solid rgba(180,205,235,0.12)',
}, [el('div', {
  display: 'flex', width: Math.max(h, Math.round(w * Math.min(1, Math.max(0, fraction)))), height: h, borderRadius: h,
  backgroundImage: `linear-gradient(90deg, ${BRAND.blue}55, ${BRAND.blue} 70%, #d6eaff)`, boxShadow: `0 0 14px ${BRAND.blue}aa`,
})]);
const pill = (s: string) => el('div', {
  display: 'flex', padding: '10px 24px', borderRadius: 40, background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(214,234,255,0.22)', fontSize: 22, fontWeight: 700, color: BRAND.text,
}, s);

/* ── avatars ───────────────────────────────────────────────────── */

const avatarCache = new Map<string, string>();

/** A member's avatar as a data URI, or null. Static PNG: an animated one would be one frame anyway. */
export async function avatarOf(m: GuildMember | null | undefined): Promise<string | null> {
  if (!m) return null;
  const url = m.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true });
  const hit = avatarCache.get(url);
  if (hit) return hit;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const uri = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    if (avatarCache.size > 200) avatarCache.delete(avatarCache.keys().next().value!);
    avatarCache.set(url, uri);
    return uri;
  } catch { return null; }
}

/** The avatar in a lit ring, or the first letter of the name if there is no picture. */
const avatar = (src: string | null, name: string, size: number) => src
  ? { type: 'img', props: { src, style: { width: size, height: size, borderRadius: size, border: `2px solid ${BRAND.blue}aa`, boxShadow: `0 0 28px ${BRAND.blue}66` } } }
  : el('div', {
      display: 'flex', width: size, height: size, borderRadius: size, alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700, color: BRAND.text, border: `2px solid ${BRAND.blue}aa`,
      backgroundImage: `linear-gradient(140deg, ${BRAND.blue}66, rgba(60,90,255,0.35))`,
    }, (name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase());

const ground = (h: number, children: unknown[]) => el('div', {
  display: 'flex', position: 'relative', width: W, height: h, background: BRAND.ink, fontFamily: 'Vazirmatn',
  color: BRAND.text, overflow: 'hidden',
}, [...aurora(W, h, BRAND.blue), glass(W, h, 40), ...children]);

/* ── the wallet: /coins ────────────────────────────────────────── */

export interface WalletData {
  name: string; avatar: string | null;
  balance: number; minutes: number; perCoin: number;
  earned: number; invites: number; rank: number | null;
  frozen: boolean; pending: number;
}

export async function renderWallet(d: WalletData): Promise<Buffer | null> {
  try {
    const H = 520;
    const inner = W - 172;
    return await draw(ground(H, [el('div', {
      ...abs, top: 40, left: 40, width: W - 80, height: H - 80, padding: 46, flexDirection: 'column', justifyContent: 'space-between',
    }, [
      el('div', { display: 'flex', alignItems: 'center', gap: 22 }, [
        avatar(d.avatar, d.name, 88),
        el('div', { display: 'flex', flexDirection: 'column', gap: 6 }, [
          say(d.name, { fontSize: 38, fontWeight: 700, maxWidth: 640, overflow: 'hidden' }),
          el('div', { display: 'flex', gap: 14, alignItems: 'center' }, [
            label('W A L L E T', { fontSize: 16 }), el('div', { display: 'flex', color: BRAND.faint }, '·'),
            say('کیف پول آیون', { fontSize: 19, color: BRAND.dim }),
          ]),
        ]),
        el('div', { display: 'flex', marginLeft: 'auto' }, [
          pill(d.frozen ? 'FROZEN' : d.rank ? `#${d.rank} this week` : 'AION COIN'),
        ]),
      ]),
      el('div', { display: 'flex', alignItems: 'flex-end', gap: 18 }, [
        el('div', { display: 'flex', fontSize: 118, fontWeight: 700, lineHeight: 1, textShadow: `0 0 34px ${BRAND.blue}aa` }, String(d.balance)),
        label('A I O N   C O I N', { marginBottom: 18, fontSize: 20, color: 'rgba(214,234,255,0.75)' }),
        el('div', { display: 'flex', marginLeft: 'auto', marginBottom: 12 }, [wordmark(34)]),
      ]),
      el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, [
        rift(inner, BRAND.blue, false),
        el('div', { display: 'flex', justifyContent: 'space-between', fontSize: 19, color: BRAND.dim }, [
          el('div', { display: 'flex' }, `${d.minutes}/${d.perCoin} min to next coin`),
          el('div', { display: 'flex', whiteSpace: 'pre' },
            `earned ${d.earned}  ·  invites ${d.invites}${d.pending ? `  ·  ${d.pending} order${d.pending > 1 ? 's' : ''} open` : ''}`),
        ]),
        bar(inner, d.minutes / d.perCoin),
      ]),
    ])]), W, H);
  } catch (e) { log.error('wallet card failed', e); return null; }
}

/* ── the shop ──────────────────────────────────────────────────── */

export interface ShopItem { id: number; name: string; price: number; left: number | null; stock: number | null; description?: string | null }

/**
 * A colour and a letter per kind of prize. No brand logos — they are not ours
 * to print — but a Nitro tile reads as Nitro at a glance by its colour.
 */
function tone(name: string): { color: string; mark: string } {
  const n = name.toLowerCase();
  const pick: [RegExp, string, string][] = [
    [/nitro|discord/, '#5865f2', 'N'], [/steam/, '#2a8fd6', 'S'], [/spotify/, '#1ed760', 'S'],
    [/telegram/, '#2aa3e0', 'T'], [/pubg|\buc\b/, '#f2a900', 'P'], [/call of duty|cod/, '#7fbf3f', 'C'],
    [/valorant/, '#ff4655', 'V'], [/google/, '#34a853', 'G'], [/app store|apple/, '#9aa6b2', 'A'],
    [/playstation|psn/, '#2f6fde', 'P'], [/xbox/, '#2ea043', 'X'], [/vpn|neoxify/, '#22c3b6', 'N'],
  ];
  for (const [re, color, mark] of pick) if (re.test(n)) return { color, mark };
  return { color: '#9b7cff', mark: '★' };   // server perks
}

export async function renderShop(items: ShopItem[]): Promise<Buffer | null> {
  try {
    const shown = items.slice(0, 12);
    const cols = 3, gap = 18;
    const rows = Math.max(1, Math.ceil(shown.length / cols));
    const tileW = Math.floor((W - 172 - gap * (cols - 1)) / cols), tileH = 128;
    const H = 230 + rows * tileH + (rows - 1) * gap + (items.length > shown.length ? 40 : 0) + 70;
    const tile = (p: ShopItem) => {
      const t = tone(p.name);
      const soldOut = p.left !== null && p.left <= 0;
      return el('div', {
        display: 'flex', width: tileW, height: tileH, borderRadius: 20, padding: 18, gap: 16, alignItems: 'center',
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${soldOut ? 'rgba(180,205,235,0.10)' : 'rgba(214,234,255,0.16)'}`,
        opacity: soldOut ? 0.55 : 1,
      }, [
        el('div', {
          display: 'flex', width: 64, height: 64, minWidth: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
          fontSize: 30, fontWeight: 700, color: '#fff', backgroundImage: `linear-gradient(140deg, ${t.color}, ${t.color}66)`,
          boxShadow: `0 0 22px ${t.color}55`,
        }, t.mark),
        el('div', { display: 'flex', flexDirection: 'column', gap: 6, width: tileW - 36 - 80 }, [
          say(p.name, { fontSize: 20, fontWeight: 700, maxWidth: tileW - 116, overflow: 'hidden' }),
          el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
            el('div', { display: 'flex', fontSize: 22, fontWeight: 700, color: '#d6eaff', textShadow: `0 0 14px ${BRAND.blue}aa` }, `${p.price} coin`),
            el('div', { display: 'flex', fontSize: 15, color: soldOut ? '#ff8c8c' : BRAND.dim },
              soldOut ? 'sold out' : p.left === null ? '∞' : `${p.left} left`),
          ]),
          ...(p.stock ? [bar(tileW - 116, (p.left ?? 0) / p.stock, 6)] : []),
        ]),
      ]);
    };
    return await draw(ground(H, [el('div', {
      ...abs, top: 40, left: 40, width: W - 80, height: H - 80, padding: 46, flexDirection: 'column', gap: 22,
    }, [
      el('div', { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }, [
        el('div', { display: 'flex', flexDirection: 'column', gap: 6 }, [
          label('A I O N   S H O P', { color: BRAND.blue, fontWeight: 700 }),
          el('div', { display: 'flex', alignItems: 'center', gap: 18 }, [
            el('div', { display: 'flex', fontSize: 46, fontWeight: 700 }, 'Shop'),
            say('فروشگاه آیون', { fontSize: 30, fontWeight: 700, color: BRAND.dim }),
          ]),
        ]),
        wordmark(36),
      ]),
      rift(W - 172, BRAND.blue),
      el('div', { display: 'flex', flexWrap: 'wrap', gap, width: W - 172 }, shown.map(tile)),
      ...(items.length > shown.length ? [label(`+ ${items.length - shown.length} more in the menu`, { fontSize: 15, letterSpacing: 3 })] : []),
      ...(shown.length === 0 ? [say('فعلاً محصولی تو شاپ نیست', { fontSize: 24, color: BRAND.dim })] : []),
    ])]), W, H);
  } catch (e) { log.error('shop card failed', e); return null; }
}

/* ── a receipt ─────────────────────────────────────────────────── */

export async function renderReceipt(d: {
  orderId: number; product: string; price: number; balance: number; name: string; avatar: string | null; at: Date;
}): Promise<Buffer | null> {
  try {
    const H = 440, inner = W - 172;
    const tone0 = tone(d.product);
    return await draw(ground(H, [el('div', {
      ...abs, top: 40, left: 40, width: W - 80, height: H - 80, padding: 46, flexDirection: 'column', justifyContent: 'space-between',
    }, [
      el('div', { display: 'flex', alignItems: 'center', gap: 20 }, [
        avatar(d.avatar, d.name, 64),
        el('div', { display: 'flex', flexDirection: 'column', gap: 4 }, [
          label('R E C E I P T', { color: BRAND.blue, fontWeight: 700, fontSize: 16 }),
          say(d.name, { fontSize: 28, fontWeight: 700, maxWidth: 560, overflow: 'hidden' }),
        ]),
        el('div', { display: 'flex', marginLeft: 'auto' }, [pill(`#${d.orderId}`)]),
      ]),
      el('div', { display: 'flex', alignItems: 'center', gap: 22 }, [
        el('div', {
          display: 'flex', width: 84, height: 84, borderRadius: 22, alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 700,
          backgroundImage: `linear-gradient(140deg, ${tone0.color}, ${tone0.color}66)`, boxShadow: `0 0 26px ${tone0.color}55`,
        }, tone0.mark),
        el('div', { display: 'flex', flexDirection: 'column', gap: 4 }, [
          say(d.product, { fontSize: 36, fontWeight: 700, maxWidth: 700, overflow: 'hidden' }),
          el('div', { display: 'flex', fontSize: 19, color: BRAND.dim }, 'Pending — a Dev will DM you the code'),
        ]),
        el('div', { display: 'flex', marginLeft: 'auto', flexDirection: 'column', alignItems: 'flex-end' }, [
          el('div', { display: 'flex', fontSize: 54, fontWeight: 700, textShadow: `0 0 26px ${BRAND.blue}aa` }, `−${d.price}`),
          label('C O I N', { fontSize: 15 }),
        ]),
      ]),
      el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, [
        rift(inner, BRAND.blue, false),
        el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 19, color: BRAND.dim }, [
          el('div', { display: 'flex' }, `Balance after: ${d.balance} coin`),
          wordmark(24),
        ]),
      ]),
    ])]), W, H);
  } catch (e) { log.error('receipt card failed', e); return null; }
}

/* ── a birthday ────────────────────────────────────────────────── */

/** Small lights scattered like confetti: fixed positions, so the card is the same picture every time. */
const CONFETTI = [[90, 70, 10, '#d6eaff'], [210, 140, 6, '#4aa6ff'], [1080, 90, 9, '#ffd76a'], [980, 170, 6, '#d6eaff'],
  [150, 420, 7, '#ffd76a'], [1110, 390, 8, '#4aa6ff'], [600, 60, 5, '#ffd76a'], [760, 460, 6, '#d6eaff'], [320, 470, 5, '#4aa6ff']] as const;

export async function renderBirthday(people: { name: string; avatar: string | null }[]): Promise<Buffer | null> {
  try {
    const shown = people.slice(0, 6);
    const H = 540;
    const size = shown.length <= 2 ? 150 : shown.length <= 4 ? 120 : 96;
    return await draw(ground(H, [
      ...CONFETTI.map(([x, y, r, c]) => el('div', { ...abs, left: x, top: y, width: r * 2, height: r * 2, borderRadius: r * 2, background: c, boxShadow: `0 0 ${r * 3}px ${c}` })),
      el('div', { ...abs, top: 40, left: 40, width: W - 80, height: H - 80, padding: 40, flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }, [
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }, [
          label('H A P P Y   B I R T H D A Y', { color: BRAND.blue, fontWeight: 700, fontSize: 18, letterSpacing: 8 }),
          say(shown.length > 1 ? 'تولدتون مبارک' : 'تولدت مبارک', { fontSize: 64, fontWeight: 700, textShadow: `0 0 34px ${BRAND.blue}cc` }),
        ]),
        el('div', { display: 'flex', gap: 34, justifyContent: 'center', alignItems: 'flex-start' }, shown.map(p =>
          el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: size + 60 }, [
            avatar(p.avatar, p.name, size),
            say(p.name, { fontSize: shown.length > 4 ? 18 : 22, fontWeight: 700, maxWidth: size + 60, overflow: 'hidden', justifyContent: 'center' }),
          ]))),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }, [
          rift(W - 260, BRAND.blue),
          wordmark(26),
        ]),
      ]),
    ]), W, H);
  } catch (e) { log.error('birthday card failed', e); return null; }
}
