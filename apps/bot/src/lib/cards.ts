import type { GuildMember } from 'discord.js';
// kicker (the one small English label) and wordmark are shared with the panel headers.
import { BRAND, aurora, glass, draw, el, fa, kicker, num, rift, say, wordmark } from './banner.js';
import { Resvg } from '@resvg/resvg-js';
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
 * In Persian, read from the right: the layouts are mirrored, digits are
 * Persian, and bars fill from the right. Each card carries one small English
 * label above its Persian title — the owner's call, so the cards stay
 * bilingual without getting crowded. Persian is never letter-spaced (it is a
 * joined script); only those English labels are.
 *
 * Each renderer returns null rather than throwing. A card is decoration on a
 * reply that must still be sent: the callers post their text either way.
 */

const log = logger('cards');
const abs = { position: 'absolute', display: 'flex' } as const;
const W = 1200;
const RTL_ROW = { display: 'flex', flexDirection: 'row-reverse' } as const;

/** Fills from the right, as a Persian reader expects progress to run. */
const bar = (w: number, fraction: number, h = 12) => el('div', {
  ...RTL_ROW, width: w, height: h, borderRadius: h, background: BRAND.track, border: '1px solid rgba(180,205,235,0.12)',
}, [el('div', {
  display: 'flex', width: Math.max(h, Math.round(w * Math.min(1, Math.max(0, fraction)))), height: h, borderRadius: h,
  backgroundImage: `linear-gradient(270deg, ${BRAND.blue}55, ${BRAND.blue} 70%, #d6eaff)`, boxShadow: `0 0 14px ${BRAND.blue}aa`,
})]);
const pill = (s: string) => el('div', {
  display: 'flex', padding: '10px 24px', borderRadius: 40, background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(214,234,255,0.22)',
}, [say(s, { fontSize: 22, fontWeight: 700, color: BRAND.text })]);

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
      display: 'flex', width: size, height: size, minWidth: size, borderRadius: size, alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700, color: BRAND.text, border: `2px solid ${BRAND.blue}aa`,
      backgroundImage: `linear-gradient(140deg, ${BRAND.blue}66, rgba(60,90,255,0.35))`,
    }, (name.replace(/Λ/g, '').replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase());

const ground = (h: number, children: unknown[]) => el('div', {
  display: 'flex', position: 'relative', width: W, height: h, background: BRAND.ink, fontFamily: 'Vazirmatn',
  color: BRAND.text, overflow: 'hidden',
}, [...aurora(W, h, BRAND.blue), glass(W, h, 40), ...children]);

/** The content box inside the glass. */
const inside = (h: number, style: Record<string, unknown>, children: unknown[]) =>
  el('div', { ...abs, top: 40, left: 40, width: W - 80, height: h - 80, padding: 46, flexDirection: 'column', ...style }, children);

/* ── the wallet: /coins ────────────────────────────────────────── */

export interface WalletData {
  name: string; avatar: string | null;
  balance: number; minutes: number; perCoin: number;
  earned: number; invites: number; rank: number | null;
  frozen: boolean; pending: number;
  /** Wearing the AION server tag: voice earns `tagMultiplier` times faster. */
  tagMultiplier?: number;
}

export async function renderWallet(d: WalletData): Promise<Buffer | null> {
  try {
    const H = 520, inner = W - 172;
    const facts = [
      ...(d.tagMultiplier && d.tagMultiplier > 1 ? [`تگ آیون: ${fa(d.tagMultiplier)} برابر`] : []),
      `کسب‌شده ${fa(d.earned)}`, `دعوت ${fa(d.invites)}`, ...(d.pending ? [`${fa(d.pending)} سفارش باز`] : []),
    ];
    return await draw(ground(H, [inside(H, { justifyContent: 'space-between' }, [
      // avatar, name and title on the right; the rank on the left
      el('div', { ...RTL_ROW, alignItems: 'center', gap: 22 }, [
        avatar(d.avatar, d.name, 88),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }, [
          kicker('WALLET'),
          say('کیف پول آیون', { fontSize: 22, fontWeight: 700, color: BRAND.dim }),
          say(d.name, { fontSize: 36, fontWeight: 700, maxWidth: 640, overflow: 'hidden' }),
        ]),
        el('div', { display: 'flex', marginRight: 'auto' }, [
          pill(d.frozen ? 'مسدود شده' : d.rank ? `رتبه‌ی ${fa(d.rank)} این هفته` : 'سکه‌ی آیون'),
        ]),
      ]),
      // the balance, read from the right; the wordmark on the left
      el('div', { ...RTL_ROW, alignItems: 'flex-end', gap: 18 }, [
        el('div', { display: 'flex', fontSize: 118, fontWeight: 700, lineHeight: 1, textShadow: `0 0 34px ${BRAND.blue}aa` }, [num(fa(d.balance))]),
        say('سکه‌ی آیون', { fontSize: 28, fontWeight: 700, color: 'rgba(214,234,255,0.75)', marginBottom: 14 }),
        el('div', { display: 'flex', marginRight: 'auto', marginBottom: 12 }, [wordmark(34)]),
      ]),
      el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, [
        rift(inner, BRAND.blue, false),
        el('div', { ...RTL_ROW, justifyContent: 'space-between' }, [
          say(`${fa(d.minutes)} از ${fa(d.perCoin)} دقیقه تا سکه‌ی بعدی`, { fontSize: 20, color: BRAND.dim }),
          // Each fact is its own phrase, dotted apart, so no number is ever read against the wrong word.
          el('div', { ...RTL_ROW, alignItems: 'center', gap: 14 }, facts.flatMap((f, i) => [
            ...(i ? [el('div', { display: 'flex', width: 5, height: 5, borderRadius: 5, background: BRAND.faint })] : []),
            say(f, { fontSize: 20, color: BRAND.dim }),
          ])),
        ]),
        bar(inner, d.minutes / d.perCoin),
      ]),
    ])]), W, H);
  } catch (e) { log.error('wallet card failed', e); return null; }
}

/* ── the shop ──────────────────────────────────────────────────── */

export interface ShopItem { id: number; name: string; price: number; left: number | null; stock: number | null; description?: string | null; image?: string | null }

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
  // Server perks: the font has no star glyph, so the tile carries the product's own initial.
  return { color: '#9b7cff', mark: (name.replace(/[^\p{L}]/gu, '')[0] ?? 'A').toUpperCase() };
}

/**
 * An uploaded product picture, made into the 192px square PNG that is stored.
 *
 * The upload is drawn into an SVG and rendered by resvg — the renderer the bot
 * already ships — which crops it to a centred square and shrinks it in one
 * step. sharp would be the usual tool, but it is a development dependency and
 * is not on the server. Returns null for anything resvg cannot read.
 */
export function productImage(bytes: Buffer, mime: string): string | null {
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(mime)) return null;
  try {
    const href = `data:${mime};base64,${bytes.toString('base64')}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">`
      + `<image href="${href}" width="192" height="192" preserveAspectRatio="xMidYMid slice"/></svg>`;
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 192 } }).render().asPng();
    // An image resvg could not decode renders as nothing: an empty transparent square.
    if (png.length < 1200) return null;
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  } catch { return null; }
}

/** The product's own picture when it has one; otherwise its colour and initial. */
const markTile = (name: string, size: number, image?: string | null) => {
  if (image) return { type: 'img', props: { src: image, style: {
    width: size, height: size, minWidth: size, borderRadius: size * 0.28, border: '1px solid rgba(214,234,255,0.22)',
  } } };
  const t = tone(name);
  return el('div', {
    display: 'flex', width: size, height: size, minWidth: size, borderRadius: size * 0.28, alignItems: 'center', justifyContent: 'center',
    fontSize: size * 0.47, fontWeight: 700, color: '#fff', backgroundImage: `linear-gradient(140deg, ${t.color}, ${t.color}66)`,
    boxShadow: `0 0 22px ${t.color}55`,
  }, t.mark);
};

export async function renderShop(items: ShopItem[]): Promise<Buffer | null> {
  try {
    const shown = items.slice(0, 12);
    const cols = 3, gap = 18;
    const rows = Math.max(1, Math.ceil(shown.length / cols));
    const tileW = Math.floor((W - 172 - gap * (cols - 1)) / cols), tileH = 128, textW = tileW - 36 - 80;
    const H = 236 + rows * tileH + (rows - 1) * gap + (items.length > shown.length ? 40 : 0) + 70;
    const tile = (p: ShopItem) => {
      const soldOut = p.left !== null && p.left <= 0;
      return el('div', {
        ...RTL_ROW, width: tileW, height: tileH, borderRadius: 20, padding: 18, gap: 16, alignItems: 'center',
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${soldOut ? 'rgba(180,205,235,0.10)' : 'rgba(214,234,255,0.16)'}`,
        opacity: soldOut ? 0.55 : 1,
      }, [
        markTile(p.name, 64, p.image),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, width: textW }, [
          say(p.name, { fontSize: 20, fontWeight: 700, maxWidth: textW, overflow: 'hidden' }),
          el('div', { ...RTL_ROW, alignItems: 'center', justifyContent: 'space-between', width: textW }, [
            say(`${fa(p.price)} سکه`, { fontSize: 22, fontWeight: 700, color: '#d6eaff', textShadow: `0 0 14px ${BRAND.blue}aa` }),
            say(soldOut ? 'تمام شد' : p.left === null ? 'نامحدود' : `${fa(p.left)} عدد مانده`,
              { fontSize: 15, color: soldOut ? '#ff8c8c' : BRAND.dim }),
          ]),
          ...(p.stock ? [bar(textW, (p.left ?? 0) / p.stock, 6)] : []),
        ]),
      ]);
    };
    // Tiles run right to left too: the first product sits top right.
    const gridRows = Array.from({ length: rows }, (_, r) => shown.slice(r * cols, r * cols + cols));
    return await draw(ground(H, [inside(H, { gap: 22 }, [
      el('div', { ...RTL_ROW, alignItems: 'flex-end', justifyContent: 'space-between' }, [
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }, [
          kicker('AION SHOP'),
          say('فروشگاه آیون', { fontSize: 46, fontWeight: 700 }),
          say('با سکه‌ی آیون خرید کن — موجودی هر ماه دوباره پر می‌شه', { fontSize: 19, color: BRAND.dim }),
        ]),
        wordmark(36),
      ]),
      rift(W - 172, BRAND.blue),
      el('div', { display: 'flex', flexDirection: 'column', gap, width: W - 172 }, gridRows.map(row =>
        el('div', { ...RTL_ROW, gap, width: W - 172 }, row.map(tile)))),
      ...(items.length > shown.length
        ? [say(`و ${fa(items.length - shown.length)} محصول دیگه توی منو`, { fontSize: 17, color: BRAND.dim, alignSelf: 'flex-end' })] : []),
      ...(shown.length === 0 ? [say('فعلاً محصولی توی فروشگاه نیست', { fontSize: 24, color: BRAND.dim, alignSelf: 'flex-end' })] : []),
    ])]), W, H);
  } catch (e) { log.error('shop card failed', e); return null; }
}

/* ── a receipt ─────────────────────────────────────────────────── */

export async function renderReceipt(d: {
  orderId: number; product: string; price: number; balance: number; name: string; avatar: string | null; at: Date; image?: string | null;
}): Promise<Buffer | null> {
  try {
    const H = 450, inner = W - 172;
    return await draw(ground(H, [inside(H, { justifyContent: 'space-between' }, [
      el('div', { ...RTL_ROW, alignItems: 'center', gap: 20 }, [
        avatar(d.avatar, d.name, 64),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }, [
          kicker('RECEIPT'),
          say('رسید خرید', { fontSize: 20, fontWeight: 700, color: BRAND.dim }),
          say(d.name, { fontSize: 26, fontWeight: 700, maxWidth: 640, overflow: 'hidden' }),
        ]),
        el('div', { display: 'flex', marginRight: 'auto' }, [pill(`سفارش شماره‌ی ${fa(d.orderId)}`)]),
      ]),
      el('div', { ...RTL_ROW, alignItems: 'center', gap: 22 }, [
        markTile(d.product, 84, d.image),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }, [
          say(d.product, { fontSize: 34, fontWeight: 700, maxWidth: 680, overflow: 'hidden' }),
          // No Latin words inside Persian sentences: "Devها" and "DM" read badly (owner, 2026-10-13).
          say('در انتظار تحویل — کد رو مدیر برات دایرکت می‌کنه', { fontSize: 19, color: BRAND.dim }),
        ]),
        el('div', { display: 'flex', marginRight: 'auto', flexDirection: 'column', alignItems: 'center' }, [
          el('div', { display: 'flex', fontSize: 54, fontWeight: 700, textShadow: `0 0 26px ${BRAND.blue}aa` }, [num(fa(d.price))]),
          say('سکه کسر شد', { fontSize: 18, color: BRAND.dim }),
        ]),
      ]),
      el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, [
        rift(inner, BRAND.blue, false),
        el('div', { ...RTL_ROW, justifyContent: 'space-between', alignItems: 'center' }, [
          say(`موجودی بعد از خرید: ${fa(d.balance)} سکه`, { fontSize: 20, color: BRAND.dim }),
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
    const many = shown.length > 1;
    const H = 560;
    const size = shown.length <= 2 ? 150 : shown.length <= 4 ? 116 : 92;
    return await draw(ground(H, [
      ...CONFETTI.map(([x, y, r, c]) => el('div', { ...abs, left: x, top: y, width: r * 2, height: r * 2, borderRadius: r * 2, background: c, boxShadow: `0 0 ${r * 3}px ${c}` })),
      inside(H, { padding: 36, alignItems: 'center', justifyContent: 'space-between' }, [
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }, [
          kicker('HAPPY BIRTHDAY', { fontSize: 17 }),
          say(many ? 'تولدتون مبارک' : 'تولدت مبارک', { fontSize: 64, fontWeight: 700, textShadow: `0 0 34px ${BRAND.blue}cc` }),
          say(many ? 'کل آیون بهتون تبریک می‌گه' : 'کل آیون بهت تبریک می‌گه', { fontSize: 22, color: BRAND.dim }),
        ]),
        // People in a row read from the right, like everything else on the card.
        el('div', { ...RTL_ROW, gap: 34, justifyContent: 'center', alignItems: 'flex-start' }, shown.map(p =>
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
