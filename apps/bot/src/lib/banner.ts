import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './log.js';
import { plainName } from './text.js';

const log = logger('banner');

// dist/lib -> apps/bot/assets
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const FONTS = join(ASSETS, 'fonts');
const ART = join(ASSETS, 'banners');

let fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] | null = null;

/** Vazirmatn covers Latin and Persian, so one family renders every name. */
export async function loadFonts() {
  if (fonts) return fonts;
  const [regular, bold] = await Promise.all([
    readFile(join(FONTS, 'Vazirmatn-Regular.ttf')),
    readFile(join(FONTS, 'Vazirmatn-Bold.ttf')),
  ]);
  fonts = [
    { name: 'Vazirmatn', data: regular, weight: 400, style: 'normal' },
    { name: 'Vazirmatn', data: bold, weight: 700, style: 'normal' },
  ];
  return fonts;
}

/* Satori takes plain objects, so no JSX build step is needed. */
export const el = (type: string, style: Record<string, unknown>, children?: unknown): unknown =>
  ({ type, props: { style, ...(children === undefined ? {} : { children }) } });

/* ── shared AION identity ──────────────────────────────────────── */

/**
 * One palette and one frame behind every generated image, so a leaderboard,
 * a welcome banner and a staff report read as the same server rather than as
 * three unrelated pictures.
 */
export const BRAND = {
  ink: '#05060c',
  text: '#f2f8ff',
  dim: 'rgba(180,205,235,0.62)',
  faint: 'rgba(180,205,235,0.34)',
  blue: '#4aa6ff',
  track: 'rgba(255,255,255,0.055)',
} as const;

/**
 * The wordmark. The first letter is a Greek capital lambda, not a Latin A —
 * the same mark that fronts every verified nickname, so the server header, the
 * banners and the member list all carry one glyph.
 */
export const WORDMARK = 'ION';

/**
 * Vazirmatn carries no Greek, so U+039B renders as nothing and "ΛION" comes
 * out as "ION".
 *
 * A capital lambda is a capital V turned through 180°, so the mark is drawn by
 * rotating the font's own V rather than by shipping a second font for one
 * glyph or hand-drawing bars that never quite match. The weight, the stroke
 * contrast and the glow are the typeface's, because it is the typeface.
 */
export const lambda = (size: number, spacing = 0) => el('div', {
  display: 'flex', transform: 'rotate(180deg)',
  // A rotated V carries its baseline at the top and its apex where the
  // descender space was, so it lands low against the rest of the word. The
  // margins lift it back onto the same line.
  //
  // Turning it over also turns over its letter-spacing, which then sits on the
  // V's left instead of between it and the I: "ΛI O N". `spacing` puts that
  // gap back on the right, where the other letters carry it.
  marginTop: -size * 0.30, marginBottom: size * 0.06, marginRight: size * 0.06 + spacing,
}, 'V');

/** The ΛION wordmark, lit in the image's accent, every letter evenly spaced. */
export const wordmark = (size: number, accent: string = BRAND.blue, glow = 0.25) => {
  const spacing = Math.round(size * 0.16);
  return el('div', {
    display: 'flex', alignItems: 'center', fontSize: size, fontWeight: 700, letterSpacing: spacing,
    color: BRAND.text, textShadow: `0 0 ${Math.round(size * glow)}px ${accent}f2`,
  }, [lambda(size, spacing), el('div', { display: 'flex' }, WORDMARK)]);
};

/**
 * The one small English label an image carries: letter-spaced capitals above
 * the Persian title. The letters are spaced by hand as well as by
 * letterSpacing, because satori swallows the space between letter-spaced
 * words — "WELCOME TO" was drawn "WELCOMETO".
 */
export const kicker = (s: string, style: Record<string, unknown> = {}) => el('div', {
  display: 'flex', fontSize: 15, fontWeight: 700, letterSpacing: 6, color: BRAND.blue, whiteSpace: 'pre', ...style,
}, s.split('').join(' '));

/** A small rounded chip: a Persian word or two, for the features a panel offers. */
export const chip = (s: string, accent: string = BRAND.blue) => el('div', {
  display: 'flex', alignItems: 'center', padding: '7px 18px', borderRadius: 30,
  background: 'rgba(255,255,255,0.07)', border: `1px solid ${accent}66`,
}, [say(s, { fontSize: 17, fontWeight: 700, color: '#dbe4f2' })]);

const WIDTH = 1200;
const PAD = 56;
const CONTENT = WIDTH - PAD * 2;

const absolute = { position: 'absolute', display: 'flex' } as const;

/** The signature lit rift, used as a divider wherever a rule is needed. */
export const rift = (width: number, accent: string, strong = true) => el('div', {
  display: 'flex', width, height: strong ? 2 : 1,
  backgroundImage: `linear-gradient(90deg, ${accent}00 0%, ${accent} 22%, #ffffff 50%, ${accent} 78%, ${accent}00 100%)`,
  ...(strong ? { boxShadow: `0 0 18px 2px ${accent}80` } : {}),
});

/**
 * The aurora: the header's light from the upper right in the image's accent,
 * a deep indigo answering it from the lower left, and a faint ice bloom between
 * them. Chosen by the owner on 2026-10-13 ("option C") over the flatter glows.
 */
export const aurora = (w: number, h: number, accent: string) => [
  el('div', { ...absolute, top: -h * 0.5, right: -w * 0.13, width: w * 0.64, height: w * 0.64, borderRadius: w,
    backgroundImage: `radial-gradient(circle, ${accent}88 0%, rgba(5,6,12,0) 68%)` }),
  el('div', { ...absolute, bottom: -h * 0.58, left: -w * 0.12, width: w * 0.57, height: w * 0.57, borderRadius: w,
    backgroundImage: 'radial-gradient(circle, rgba(60,90,255,0.45) 0%, rgba(5,6,12,0) 68%)' }),
  el('div', { ...absolute, top: h * 0.3, left: w * 0.35, width: w * 0.32, height: w * 0.32, borderRadius: w,
    backgroundImage: 'radial-gradient(circle, rgba(120,220,255,0.20) 0%, rgba(5,6,12,0) 70%)' }),
];

/**
 * The frosted panel the content sits on. No drop shadow: resvg panics on a
 * blurred shadow under a translucent fill, which takes the whole bot with it.
 */
export const glass = (w: number, h: number, inset = 24) => el('div', {
  ...absolute, top: inset, left: inset, width: w - inset * 2, height: h - inset * 2, borderRadius: 30,
  background: 'rgba(255,255,255,0.055)', border: '2px solid rgba(214,234,255,0.18)',
});

export const RTL = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/**
 * A line of text the way a member wrote it.
 *
 * Satori has no Λ — Vazirmatn carries no Greek — so every "Λ | Name" came out
 * as "| Name"; the Λ is drawn from the font's own V, as in the wordmark.
 *
 * Satori shapes Persian letters but lays words out left to right, and inside
 * one text node it also drops spaces, so "کیف پول آیون" read back to front and
 * glued. A line with Persian in it is set one word per box, in a row that runs
 * right to left, so the first word written is the rightmost — where a Persian
 * reader starts.
 *
 * This was got wrong twice by eye; the order is now checked by measurement
 * (tools/design/rtl-check.mjs, and test/cards.test.mjs), not by looking.
 *
 * Emoji are dropped: the font has none, and they rendered as empty gaps.
 *
 * Numbers are drawn digit by digit (see num), because satori also reverses a
 * run of Persian digits: ۳۴۲ came out ۲۴۳.
 */
export function say(text: string, style: Record<string, unknown> = {}): unknown {
  const plain = (plainName(text) || text).replace(PICTOGRAPHS, '').replace(/\s+/g, ' ').trim();
  const size = Number(style.fontSize ?? 20);
  const piece = (p: string) => p.split(/([0-9۰-۹]+)/).filter(Boolean)
    .map(part => /^[0-9۰-۹]+$/.test(part) ? num(part) : part);
  const word = (w: string) => el('div', { display: 'flex', alignItems: 'center', whiteSpace: 'pre' },
    w.split('Λ').flatMap((p, i) => [...(i ? [lambda(size)] : []), ...(p ? piece(p) : [])]));
  if (RTL.test(plain)) {
    // Single Latin words inside Persian ("Devها", "DM") come out right. A Latin
    // phrase does not — "رسید خرید · Λ | Negin" put the name back to front even
    // as one box — so cards keep a member's name on a line of its own.
    return el('div', { display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', gap: size * 0.3, ...style },
      plain.split(' ').filter(Boolean).map(word));
  }
  return el('div', { display: 'flex', alignItems: 'center', ...style }, [word(plain)]);
}

/** Render a tree. Shared so every card is drawn with the same fonts the same way. */
export async function draw(tree: unknown, w: number, h: number): Promise<Buffer> {
  const svg = await satori(tree as never, { width: w, height: h, fonts: await loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng());
}

/** Western digits to Persian ones, for numbers set inside Persian text. */
export const fa = (n: number | string): string => String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

/**
 * A number, one box per digit, left to right. Satori reverses a run of
 * Persian digits — ۳۴۲ was drawn ۲۴۳, ۱۸۰ as ۰۸۱ — and digits that are each
 * their own box cannot be reordered. Numbers read left to right in Persian
 * too, so this is right for both scripts.
 */
export function num(n: number | string, style: Record<string, unknown> = {}): unknown {
  return el('div', { display: 'flex', flexDirection: 'row', ...style },
    [...String(n)].map(ch => el('div', { display: 'flex' }, ch)));
}

/**
 * Title block on the left, AION lockup on the right — mirrored for a Persian
 * card, which is read from the right. Persian is never letter-spaced: it is a
 * joined script, and spacing it pulls every word apart into loose letters.
 */
const header = (opts: { kicker: string; title: string; subtitle: string; accent: string; rtl?: boolean }) =>
  el('div', {
    display: 'flex', width: CONTENT, justifyContent: 'space-between', alignItems: 'flex-start',
    flexDirection: opts.rtl ? 'row-reverse' : 'row',
  }, [
    el('div', { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 820, alignItems: opts.rtl ? 'flex-end' : 'flex-start' }, opts.rtl ? [
      // The small label over a Persian title may be English, spaced like every card's label.
      RTL.test(opts.kicker)
        ? say(opts.kicker, { fontSize: 20, fontWeight: 700, color: opts.accent })
        : el('div', { display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 7, color: opts.accent }, opts.kicker),
      say(opts.title, { fontSize: 46, fontWeight: 700, color: BRAND.text }),
      say(opts.subtitle, { fontSize: 20, color: BRAND.dim }),
    ] : [
      el('div', {
        display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 7, color: opts.accent,
      }, opts.kicker),
      el('div', { display: 'flex', fontSize: 46, fontWeight: 700, color: BRAND.text }, opts.title),
      el('div', { display: 'flex', fontSize: 20, color: BRAND.dim }, opts.subtitle),
    ]),
    el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }, [
      wordmark(36, opts.accent, 0.8),
      rift(148, opts.accent),
    ]),
  ]);

/**
 * Wraps content in the shared frame. Height is passed in rather than fixed, so
 * a three-row board does not ship with half a card of empty space.
 */
async function frame(opts: {
  height: number;
  accent: string;
  kicker: string;
  title: string;
  subtitle: string;
  footer: string;
  body: unknown[];
  rtl?: boolean;
}): Promise<Buffer> {
  const tree = el('div', {
    display: 'flex', flexDirection: 'column', position: 'relative',
    width: WIDTH, height: opts.height, padding: PAD,
    background: BRAND.ink, fontFamily: 'Vazirmatn', gap: 26,
  }, [
    ...aurora(WIDTH, opts.height, opts.accent),
    glass(WIDTH, opts.height, 22),
    header(opts),
    rift(CONTENT, opts.accent),
    el('div', { display: 'flex', flexDirection: 'column', gap: 14, width: CONTENT }, opts.body),
    el('div', {
      ...absolute, bottom: 26, left: PAD, width: CONTENT,
      justifyContent: 'space-between', alignItems: 'center',
      flexDirection: opts.rtl ? 'row-reverse' : 'row',
    }, [
      opts.rtl
        ? say(opts.footer, { fontSize: 16, color: BRAND.faint })
        : el('div', { display: 'flex', fontSize: 15, letterSpacing: 4, color: BRAND.faint }, opts.footer),
      el('div', {
        display: 'flex', alignItems: 'center', fontSize: 15, letterSpacing: 5, color: BRAND.faint,
      }, [lambda(15, 5), el('div', { display: 'flex' }, WORDMARK)]),
    ]),
  ]);

  return draw(tree, WIDTH, opts.height);
}

/* ── leaderboards ──────────────────────────────────────────────── */

export interface BannerRow { name: string; value: string; amount: number }

const MEDAL = [
  { from: '#ffd76a', to: '#f0a500', ink: '#241a00' },
  { from: '#e6ecf5', to: '#a8b4c6', ink: '#161a22' },
  { from: '#e2a06a', to: '#b26a2f', ink: '#241203' },
];

const ROW_H = 62;

export async function renderLeaderboardBanner(opts: {
  title: string;
  subtitle: string;
  accent: string;
  rows: BannerRow[];
  kicker?: string;
  footer?: string;
  /** A Persian board: read from the right, ranks and bars mirrored, digits Persian. */
  rtl?: boolean;
  /** Shown when there are no rows. */
  empty?: string;
}): Promise<Buffer | null> {
  try {
    const rows = opts.rows.slice(0, 8);
    const max = Math.max(1, ...rows.map(r => r.amount));
    const rtl = Boolean(opts.rtl);
    const dir = rtl ? 'row-reverse' : 'row';

    // badge + gap, so the bars line up under the names rather than the ranks.
    const BADGE = 52, GAP = 20;
    const col = CONTENT - BADGE - GAP;

    const body = rows.length
      ? rows.map((r, i) => {
          const medal = MEDAL[i];
          const width = Math.max(28, Math.round((r.amount / max) * col));
          return el('div', {
            display: 'flex', alignItems: 'center', gap: GAP, width: CONTENT, height: ROW_H, flexDirection: dir,
          }, [
            el('div', {
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: BADGE, height: BADGE, minWidth: BADGE, flexShrink: 0, borderRadius: 16,
              fontSize: 23, fontWeight: 700,
              ...(medal
                ? {
                    backgroundImage: `linear-gradient(140deg, ${medal.from}, ${medal.to})`,
                    color: medal.ink,
                    boxShadow: `0 0 22px ${medal.from}59`,
                  }
                : { background: BRAND.track, color: BRAND.faint }),
            }, [num(rtl ? fa(i + 1) : String(i + 1))]),
            el('div', { display: 'flex', flexDirection: 'column', width: col, gap: 8 }, [
              el('div', {
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', width: col, flexDirection: dir,
              }, [
                say(r.name || '—', {
                  fontSize: 25, fontWeight: 700, maxWidth: col - 190,
                  overflow: 'hidden', color: i === 0 ? BRAND.text : '#dbe4f2',
                }),
                rtl
                  ? say(r.value, { fontSize: 21, fontWeight: 700, color: opts.accent })
                  : el('div', {
                      display: 'flex', fontSize: 21, fontWeight: 700, color: opts.accent,
                    }, r.value),
              ]),
              el('div', {
                display: 'flex', height: 9, borderRadius: 5, background: BRAND.track, width: col, flexDirection: dir,
              }, [
                el('div', {
                  display: 'flex', height: 9, borderRadius: 5, width,
                  backgroundImage: `linear-gradient(90deg, ${opts.accent}, ${opts.accent}59)`,
                  ...(i === 0 ? { boxShadow: `0 0 16px ${opts.accent}8c` } : {}),
                }),
              ]),
            ]),
          ]);
        })
      : [el('div', {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: CONTENT, height: 140, borderRadius: 18, background: BRAND.track,
          fontSize: 23, color: BRAND.dim,
        }, [rtl
          ? say(opts.empty ?? 'هنوز کسی ثبت نشده — اولین نفر باش', { fontSize: 23, color: BRAND.dim })
          : (opts.empty ?? 'Hanooz kasi sabt nashode — emshab avvalin nafar bash.')])];

    const rowsH = rows.length ? rows.length * ROW_H + (rows.length - 1) * 14 : 140;
    return await frame({
      height: 232 + rowsH + 104,
      accent: opts.accent,
      kicker: opts.kicker ?? 'LEADERBOARD',
      title: opts.title,
      subtitle: opts.subtitle,
      footer: opts.footer ?? 'TOP ACTIVE',
      body,
      rtl,
    });
  } catch (e) {
    // A failed banner must never block the text post.
    log.error('banner render failed', e);
    return null;
  }
}

/* ── staff report ──────────────────────────────────────────────── */

export interface StatTile { label: string; value: string; hint?: string }

/** Headline numbers for the weekly admin report, in the same frame. */
export async function renderStatsBanner(opts: {
  title: string;
  subtitle: string;
  accent: string;
  kicker?: string;
  footer?: string;
  tiles: StatTile[];
}): Promise<Buffer | null> {
  try {
    const tiles = opts.tiles.slice(0, 4);
    const gap = 18;
    const w = Math.floor((CONTENT - gap * (tiles.length - 1)) / Math.max(1, tiles.length));

    const body = [el('div', { display: 'flex', gap, width: CONTENT }, tiles.map(t =>
      el('div', {
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6,
        width: w, height: 132, padding: 24, borderRadius: 20,
        background: BRAND.track, borderLeft: `3px solid ${opts.accent}`,
      }, [
        el('div', { display: 'flex', fontSize: 15, letterSpacing: 4, color: BRAND.faint }, t.label),
        el('div', { display: 'flex', fontSize: 38, fontWeight: 700, color: BRAND.text }, t.value),
        ...(t.hint ? [el('div', { display: 'flex', fontSize: 16, color: BRAND.dim }, t.hint)] : []),
      ]),
    ))];

    return await frame({
      height: 232 + 132 + 104,
      accent: opts.accent,
      kicker: opts.kicker ?? 'STAFF REPORT',
      title: opts.title,
      subtitle: opts.subtitle,
      footer: opts.footer ?? 'ADMIN ACTIVITY',
      body,
    });
  } catch (e) {
    log.error('stats banner render failed', e);
    return null;
  }
}

/* ── panel headers ─────────────────────────────────────────────── */

/**
 * Header banners already drawn, keyed by what they are drawn from.
 *
 * satori and resvg are synchronous. A render is roughly 200ms of blocked event
 * loop on a fast laptop and a good deal more on the VPS, and during it the bot
 * cannot answer anything at all — not a click, not a heartbeat.
 *
 * The staff panel's banner is built from five constants, so every one of those
 * renders produced a byte-identical image. It ran on announce, start, end,
 * cancel, every event created and every press of Tazegi. That is most of why
 * interactions were losing the race against Discord's three-second window, and
 * why a button sometimes had to be pressed twice.
 *
 * Keyed on the inputs, so anything that actually differs is still drawn. Only
 * successes are kept — caching a null would make one bad render permanent —
 * and the map is bounded, because a cache keyed on caller-supplied text with
 * no ceiling is a memory leak with extra steps.
 */
const headerCache = new Map<string, Buffer>();
const HEADER_CACHE_MAX = 24;

/** What a panel header is drawn from. Exported so the panels' own text and the tests share one shape. */
export interface HeaderSpec {
  /** The one small English label, letter-spaced, above the title. */
  kicker: string;
  title: string;
  subtitle: string;
  accent?: string;
  /** Up to five short features, drawn as chips along the bottom. */
  tags?: string[];
  /** Read from the right. Left out, it follows the title: a Persian title makes a Persian header. */
  rtl?: boolean;
}

/**
 * A hero strip for a panel that is posted once and lived with — the temp
 * voice interface, the admin guide, the events console.
 *
 * In the cards' look (option C): the aurora in the panel's own accent, the
 * frosted glass, the lit rift. A Persian header is mirrored like the cards —
 * title block on the right, the wordmark on the left, chips running from the
 * right — and carries one small English label above its Persian title.
 */
export async function renderHeaderBanner(opts: HeaderSpec): Promise<Buffer | null> {
  const rtl = opts.rtl ?? RTL.test(opts.title);
  const key = JSON.stringify([opts.kicker, opts.title, opts.subtitle, opts.accent, opts.tags, rtl]);
  const hit = headerCache.get(key);
  if (hit) return hit;
  try {
    const accent = opts.accent ?? BRAND.blue;
    const tags = (opts.tags ?? []).slice(0, 5);
    const H = tags.length ? 340 : 280;
    const dir = rtl ? 'row-reverse' : 'row';
    // Latin text is set as it is; anything Persian goes through say(), one box per word.
    const text = (s: string, style: Record<string, unknown>) =>
      rtl || RTL.test(s) ? say(s, style) : el('div', { display: 'flex', ...style }, s);

    const tree = el('div', {
      display: 'flex', position: 'relative', width: WIDTH, height: H,
      background: BRAND.ink, fontFamily: 'Vazirmatn', color: BRAND.text, overflow: 'hidden',
    }, [
      ...aurora(WIDTH, H, accent),
      glass(WIDTH, H, 22),
      el('div', {
        ...absolute, top: 54, left: PAD, width: CONTENT, flexDirection: dir,
        justifyContent: 'space-between', alignItems: 'flex-start',
      }, [
        el('div', {
          display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 860,
          alignItems: rtl ? 'flex-end' : 'flex-start',
        }, [
          RTL.test(opts.kicker)
            ? say(opts.kicker, { fontSize: 19, fontWeight: 700, color: accent })
            : kicker(opts.kicker, { fontSize: 16, color: accent }),
          text(opts.title, { fontSize: 56, fontWeight: 700, color: BRAND.text, textShadow: `0 0 36px ${accent}99` }),
          text(opts.subtitle, { fontSize: 21, color: BRAND.dim, maxWidth: 860 }),
        ]),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 8 }, [
          wordmark(36, accent, 0.8),
          rift(148, accent),
        ]),
      ]),
      ...(tags.length ? [
        el('div', { ...absolute, top: H - 112, left: PAD }, [rift(CONTENT, accent, false)]),
        el('div', {
          ...absolute, top: H - 90, left: PAD, width: CONTENT, flexDirection: dir, gap: 12, alignItems: 'center',
        }, tags.map(t => rtl || RTL.test(t)
          ? chip(t, accent)
          : el('div', {
              display: 'flex', alignItems: 'center', padding: '7px 18px', borderRadius: 30,
              background: 'rgba(255,255,255,0.07)', border: `1px solid ${accent}66`,
              fontSize: 14, fontWeight: 700, letterSpacing: 4, color: '#dbe4f2',
            }, t))),
      ] : []),
    ]);

    const png = await draw(tree, WIDTH, H);
    // Oldest out first. Insertion order is Map's own, so the first key is it.
    if (headerCache.size >= HEADER_CACHE_MAX) {
      const oldest = headerCache.keys().next().value;
      if (oldest !== undefined) headerCache.delete(oldest);
    }
    headerCache.set(key, png);
    return png;
  } catch (e) {
    log.error('header banner render failed', e);
    return null;
  }
}

/* ── server identity art ───────────────────────────────────────── */

/**
 * The banner above the channel list and the splash behind an invite.
 *
 * Discord lays the server name over the lower-left of the banner, so that
 * corner is deliberately left empty — anything placed there is read through
 * white text at a size nobody chose.
 *
 * `phase` is one turn of the loop, 0 → 1. Left out, this renders the still
 * banner exactly as it always did; passed, it moves the light. It is the same
 * composition either way on purpose — an animated banner that is a *different*
 * picture from the still one makes the server look like two servers to
 * everyone whose client shows them the first frame and stops.
 *
 * Everything phase drives is periodic and lands back on its starting value at
 * 1, so the last frame hands over to the first with no jump. That is the whole
 * difficulty of a looping banner: a seam is not subtle, it is the only thing
 * anybody sees.
 */
export async function renderServerArt(
  w: number, h: number, tagline: string, phase?: number,
): Promise<Buffer | null> {
  try {
    const k = w / 960;                       // one composition, two sizes
    const px = (n: number) => Math.round(n * k);
    const hex = (n: number) =>
      Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

    const p = phase === undefined ? null : ((phase % 1) + 1) % 1;

    /*
     * Two curves drive the whole animation.
     *
     * breath is a cosine, not a triangle, so the light has no corner at the top
     * of its swing and none at the seam. At rest it sits at one half — which is
     * why the still banner is untouched: every value below collapses to its old
     * constant when breath is a half.
     *
     * sweep is a sine, which is zero at *both* ends of the turn. That is what
     * lets the travelling highlight loop: it fades out where it fades in,
     * instead of teleporting back to the left.
     */
    const breath = p === null ? 0.5 : 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    // The exponent is well under 1 on purpose. A plain sine spends most of the
    // turn near zero, which turned the sweep into a flare that swelled in the
    // middle and never reached either end; raised to 0.45 it is already bright
    // a tenth of the way in and only lets go at the seam itself.
    const sweep = p === null ? 0 : Math.sin(Math.PI * p) ** 0.45;
    const drift = p === null ? 0 : Math.sin(2 * Math.PI * p);

    const riftW = w - px(120);
    const bandW = px(300);
    const bloomW = px(330);
    const white = (a: number) => `rgba(255,255,255,${a.toFixed(3)})`;

    const tree = el('div', {
      display: 'flex', position: 'relative', width: w, height: h,
      background: BRAND.ink, fontFamily: 'Vazirmatn',
    }, [
      // Lit from the upper right, so the lower left stays quiet for the name.
      el('div', {
        ...absolute, top: -h * 0.55 + px(12) * drift, right: -w * 0.22,
        width: w * 0.95, height: w * 0.95, borderRadius: w,
        backgroundImage: 'radial-gradient(circle, '
          + `${BRAND.blue}${hex(0x52 + (breath - 0.5) * 0x24)} 0%, `
          + `${BRAND.blue}${hex(0x1a + (breath - 0.5) * 0x10)} 40%, rgba(5,6,12,0) 68%)`,
      }),
      el('div', {
        ...absolute, bottom: -h * 0.5, left: -w * 0.12, width: w * 0.6, height: w * 0.6,
        borderRadius: w, backgroundImage: `radial-gradient(circle, ${BRAND.blue}1c 0%, rgba(5,6,12,0) 66%)`,
      }),

      el('div', {
        ...absolute, top: h * 0.28, left: 0, width: w, justifyContent: 'center',
        alignItems: 'center', fontSize: px(150), fontWeight: 700, letterSpacing: px(24),
        color: BRAND.text,
        textShadow: `0 0 ${px(36) + px(16) * breath}px `
          + `${BRAND.blue}${hex(0xf2 + (breath - 0.5) * 0x2a)}`,
      }, [lambda(px(150)), el('div', { display: 'flex' }, WORDMARK)]),

      el('div', { ...absolute, top: h * 0.52, left: px(60) }, [rift(riftW, BRAND.blue)]),

      el('div', {
        ...absolute, top: h * 0.60, left: 0, width: w, justifyContent: 'center',
        fontSize: px(26), letterSpacing: px(9),
        color: `rgba(180,205,235,${(0.62 + (breath - 0.5) * 0.22).toFixed(3)})`,
      }, tagline),

      /*
       * The light that runs along the rift.
       *
       * Two pieces, because one is not enough. The rift's own centre is already
       * white, so a brighter *line* laid over it barely reads — it is +20 on a
       * pixel that is at 255. The bloom is what the eye actually follows: a
       * soft round glow standing off the line, travelling with it.
       *
       * The bloom's box is square and its gradient is spent well inside it. A
       * wide flat box was the obvious shape and the wrong one: a circular
       * gradient in a 360x78 box is still bright where it meets the top and
       * bottom edges, so the glow showed up as a lit rectangle sliding across
       * the wordmark, hard corners and all.
       *
       * The line runs end to end of the rift; the bloom's centre does too, and
       * is allowed to hang past both ends, because the envelope has taken it to
       * nothing long before it gets there.
       */
      ...(p === null ? [] : [
        el('div', {
          ...absolute, top: h * 0.52 - bloomW / 2,
          left: Math.round(px(60) - bloomW / 2 + p * riftW), width: bloomW, height: bloomW,
          borderRadius: bloomW,
          backgroundImage: `radial-gradient(circle, rgba(214,234,255,${(sweep * 0.30).toFixed(3)}) 0%, `
            + `rgba(74,166,255,${(sweep * 0.15).toFixed(3)}) 26%, rgba(5,6,12,0) 54%)`,
        }),
        el('div', {
          ...absolute, top: h * 0.52 - px(1),
          left: px(60) + Math.round(p * (riftW - bandW)), width: bandW, height: px(4),
          backgroundImage: `linear-gradient(90deg, ${white(0)} 0%, `
            + `${white(sweep * 0.95)} 50%, ${white(0)} 100%)`,
          boxShadow: `0 0 ${px(26)}px ${px(3)}px ${BRAND.blue}${hex(sweep * 0xc8)}`,
        }),
      ]),
    ]);

    const svg = await satori(tree as never, { width: w, height: h, fonts: await loadFonts() });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng());
  } catch (e) {
    log.error('server art render failed', e);
    return null;
  }
}

/* ── verify panel banner ───────────────────────────────────────── */

export interface Art { data: Buffer; name: string }

/**
 * Artwork for the verify panel. A file dropped into assets/banners wins, so the
 * art can be swapped without touching code; otherwise one is rendered.
 * Deliberately uncached — the panel is posted rarely, and a restart should not
 * be the price of changing the picture.
 */
export async function welcomeBanner(): Promise<Art | null> {
  for (const name of ['welcome.gif', 'welcome.png', 'welcome.jpg', 'welcome.jpeg']) {
    const data = await readFile(join(ART, name)).catch(() => null);
    if (data) return { data, name };
  }
  const data = await renderWelcomeBanner();
  return data ? { data, name: 'welcome.png' } : null;
}

const HERO_H = 420;

/** The welcome line under the wordmark. Exported so the right-to-left test reads the same words. */
export const WELCOME_LINE = 'یک بار تأیید شو — بعدش همه‌ی سرور برات بازه';

/*
 * Drawn from constants, so drawn once. The file lookup above still runs on
 * every call — dropping in new art needs no restart — only the fallback render
 * is kept.
 */
let welcomeDrawn: Buffer | null = null;

/** Fallback art, in the cards' look: the wordmark on glass over the aurora, one English label, one Persian line. */
async function renderWelcomeBanner(): Promise<Buffer | null> {
  if (welcomeDrawn) return welcomeDrawn;
  try {
    const tree = el('div', {
      display: 'flex', position: 'relative', width: WIDTH, height: HERO_H,
      background: BRAND.ink, fontFamily: 'Vazirmatn', color: BRAND.text, overflow: 'hidden',
    }, [
      ...aurora(WIDTH, HERO_H, BRAND.blue),
      glass(WIDTH, HERO_H, 22),
      el('div', {
        ...absolute, top: 0, left: 0, width: WIDTH, height: HERO_H, flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
      }, [
        kicker('WELCOME TO', { fontSize: 19, letterSpacing: 8, color: '#a9d4ff' }),
        // The line box of a 150px word is far taller than its capitals; the margins take the slack back.
        el('div', { display: 'flex', marginTop: -22, marginBottom: -34 }, [wordmark(150, BRAND.blue, 0.3)]),
        rift(720, BRAND.blue),
        say(WELCOME_LINE, { fontSize: 27, fontWeight: 700, color: 'rgba(214,234,255,0.80)', marginTop: 6 }),
      ]),
    ]);
    welcomeDrawn = await draw(tree, WIDTH, HERO_H);
    return welcomeDrawn;
  } catch (e) {
    log.error('welcome banner render failed', e);
    return null;
  }
}
