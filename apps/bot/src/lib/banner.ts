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
async function loadFonts() {
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
const el = (type: string, style: Record<string, unknown>, children?: unknown): unknown =>
  ({ type, props: { style, ...(children === undefined ? {} : { children }) } });

/* ── shared AION identity ──────────────────────────────────────── */

/**
 * One palette and one frame behind every generated image, so a leaderboard,
 * a welcome banner and a staff report read as the same server rather than as
 * three unrelated pictures.
 */
const BRAND = {
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
const WORDMARK = 'ION';

/**
 * Vazirmatn carries no Greek, so U+039B renders as nothing and "ΛION" comes
 * out as "ION".
 *
 * A capital lambda is a capital V turned through 180°, so the mark is drawn by
 * rotating the font's own V rather than by shipping a second font for one
 * glyph or hand-drawing bars that never quite match. The weight, the stroke
 * contrast and the glow are the typeface's, because it is the typeface.
 */
const lambda = (size: number) => el('div', {
  display: 'flex', transform: 'rotate(180deg)',
  // A rotated V carries its baseline at the top and its apex where the
  // descender space was, so it lands low against the rest of the word. The
  // margins lift it back onto the same line.
  marginTop: -size * 0.30, marginBottom: size * 0.06, marginRight: size * 0.06,
}, 'V');

const WIDTH = 1200;
const PAD = 56;
const CONTENT = WIDTH - PAD * 2;

const absolute = { position: 'absolute', display: 'flex' } as const;

/** The light source that every AION image is lit by. */
const glows = (accent: string) => [
  el('div', {
    ...absolute, top: -300, right: -260, width: 820, height: 820, borderRadius: 410,
    backgroundImage: `radial-gradient(circle, ${accent}3d 0%, ${accent}12 42%, rgba(5,6,12,0) 68%)`,
  }),
  el('div', {
    ...absolute, bottom: -320, left: -220, width: 700, height: 700, borderRadius: 350,
    backgroundImage: `radial-gradient(circle, ${accent}1f 0%, rgba(5,6,12,0) 66%)`,
  }),
];

/** The signature lit rift, used as a divider wherever a rule is needed. */
const rift = (width: number, accent: string, strong = true) => el('div', {
  display: 'flex', width, height: strong ? 2 : 1,
  backgroundImage: `linear-gradient(90deg, ${accent}00 0%, ${accent} 22%, #ffffff 50%, ${accent} 78%, ${accent}00 100%)`,
  ...(strong ? { boxShadow: `0 0 18px 2px ${accent}80` } : {}),
});

/** Title block on the left, AION lockup on the right. */
const header = (opts: { kicker: string; title: string; subtitle: string; accent: string }) =>
  el('div', {
    display: 'flex', width: CONTENT, justifyContent: 'space-between', alignItems: 'flex-start',
  }, [
    el('div', { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 820 }, [
      el('div', {
        display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 7, color: opts.accent,
      }, opts.kicker),
      el('div', { display: 'flex', fontSize: 46, fontWeight: 700, color: BRAND.text }, opts.title),
      el('div', { display: 'flex', fontSize: 20, color: BRAND.dim }, opts.subtitle),
    ]),
    el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }, [
      el('div', {
        display: 'flex', alignItems: 'center', fontSize: 38, fontWeight: 700,
        letterSpacing: 11, color: BRAND.text, textShadow: `0 0 30px ${opts.accent}e6`,
      }, [lambda(38), el('div', { display: 'flex' }, WORDMARK)]),
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
}): Promise<Buffer> {
  const tree = el('div', {
    display: 'flex', flexDirection: 'column', position: 'relative',
    width: WIDTH, height: opts.height, padding: PAD,
    background: BRAND.ink, fontFamily: 'Vazirmatn', gap: 26,
  }, [
    ...glows(opts.accent),
    header(opts),
    rift(CONTENT, opts.accent),
    el('div', { display: 'flex', flexDirection: 'column', gap: 14, width: CONTENT }, opts.body),
    el('div', {
      ...absolute, bottom: 26, left: PAD, width: CONTENT,
      justifyContent: 'space-between', alignItems: 'center',
    }, [
      el('div', { display: 'flex', fontSize: 15, letterSpacing: 4, color: BRAND.faint }, opts.footer),
      el('div', {
        display: 'flex', alignItems: 'center', fontSize: 15, letterSpacing: 5, color: BRAND.faint,
      }, [lambda(15), el('div', { display: 'flex' }, WORDMARK)]),
    ]),
  ]);

  const svg = await satori(tree as never, { width: WIDTH, height: opts.height, fonts: await loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
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
}): Promise<Buffer | null> {
  try {
    const rows = opts.rows.slice(0, 8);
    const max = Math.max(1, ...rows.map(r => r.amount));

    // badge + gap, so the bars line up under the names rather than the ranks.
    const BADGE = 52, GAP = 20;
    const col = CONTENT - BADGE - GAP;

    const body = rows.length
      ? rows.map((r, i) => {
          const medal = MEDAL[i];
          const width = Math.max(28, Math.round((r.amount / max) * col));
          return el('div', {
            display: 'flex', alignItems: 'center', gap: GAP, width: CONTENT, height: ROW_H,
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
            }, String(i + 1)),
            el('div', { display: 'flex', flexDirection: 'column', width: col, gap: 8 }, [
              el('div', {
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', width: col,
              }, [
                el('div', {
                  display: 'flex', fontSize: 25, fontWeight: 700, maxWidth: col - 190,
                  overflow: 'hidden', color: i === 0 ? BRAND.text : '#dbe4f2',
                }, plainName(r.name) || '—'),
                el('div', {
                  display: 'flex', fontSize: 21, fontWeight: 700, color: opts.accent,
                }, r.value),
              ]),
              el('div', {
                display: 'flex', height: 9, borderRadius: 5, background: BRAND.track, width: col,
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
        }, 'Hanooz kasi sabt nashode — emshab avvalin nafar bash.')];

    const rowsH = rows.length ? rows.length * ROW_H + (rows.length - 1) * 14 : 140;
    return await frame({
      height: 232 + rowsH + 104,
      accent: opts.accent,
      kicker: opts.kicker ?? 'LEADERBOARD',
      title: opts.title,
      subtitle: opts.subtitle,
      footer: opts.footer ?? 'TOP ACTIVE',
      body,
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

const HEAD_H = 330;

/**
 * A hero strip for any panel that is posted once and lived with — the temp
 * voice interface, the admin guide. Same ground as the leaderboards, so a
 * member meets one server rather than a set of unrelated cards.
 */
export async function renderHeaderBanner(opts: {
  kicker: string;
  title: string;
  subtitle: string;
  accent?: string;
  tags?: string[];
}): Promise<Buffer | null> {
  try {
    const accent = opts.accent ?? BRAND.blue;
    const tree = el('div', {
      display: 'flex', position: 'relative', width: WIDTH, height: HEAD_H,
      background: BRAND.ink, fontFamily: 'Vazirmatn',
    }, [
      ...glows(accent),
      el('div', {
        ...absolute, top: 56, left: PAD, width: CONTENT,
        justifyContent: 'space-between', alignItems: 'flex-start',
      }, [
        el('div', { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }, [
          el('div', {
            display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 7, color: accent,
          }, opts.kicker),
          el('div', {
            display: 'flex', fontSize: 62, fontWeight: 700, color: BRAND.text,
            textShadow: `0 0 38px ${accent}59`,
          }, opts.title),
          el('div', { display: 'flex', fontSize: 21, color: BRAND.dim }, opts.subtitle),
        ]),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }, [
          el('div', {
            display: 'flex', alignItems: 'center', fontSize: 38, fontWeight: 700,
            letterSpacing: 11, color: BRAND.text, textShadow: `0 0 30px ${accent}e6`,
          }, [lambda(38), el('div', { display: 'flex' }, WORDMARK)]),
          rift(148, accent),
        ]),
      ]),
      el('div', { ...absolute, bottom: 62, left: PAD }, [rift(CONTENT, accent)]),
      el('div', {
        ...absolute, bottom: 26, left: PAD, width: CONTENT,
        justifyContent: 'space-between', alignItems: 'center',
      }, [
        el('div', { display: 'flex', gap: 26 }, (opts.tags ?? []).slice(0, 5).map(t =>
          el('div', { display: 'flex', fontSize: 15, letterSpacing: 4, color: BRAND.faint }, t))),
        el('div', {
          display: 'flex', alignItems: 'center', fontSize: 15, letterSpacing: 5, color: BRAND.faint,
        }, [lambda(15), el('div', { display: 'flex' }, WORDMARK)]),
      ]),
    ]);

    const svg = await satori(tree as never, { width: WIDTH, height: HEAD_H, fonts: await loadFonts() });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
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

const HERO_H = 400;

/** Fallback art: the AION wordmark split by a lit rift. */
async function renderWelcomeBanner(): Promise<Buffer | null> {
  try {
    const tree = el('div', {
      display: 'flex', position: 'relative', width: WIDTH, height: HERO_H,
      background: BRAND.ink, fontFamily: 'Vazirmatn',
    }, [
      ...glows(BRAND.blue),
      el('div', {
        ...absolute, top: 96, left: 0, width: WIDTH, justifyContent: 'center',
        alignItems: 'center', fontSize: 168, fontWeight: 700, letterSpacing: 26,
        color: BRAND.text, textShadow: `0 0 46px ${BRAND.blue}f2`,
      }, [lambda(168), el('div', { display: 'flex' }, WORDMARK)]),
      el('div', { ...absolute, top: 198, left: 40 }, [rift(WIDTH - 80, BRAND.blue)]),
      el('div', { ...absolute, top: 176, left: 0, width: WIDTH, justifyContent: 'center' }, [
        el('div', {
          display: 'flex', alignItems: 'center', height: 46, paddingLeft: 26, paddingRight: 26,
          background: BRAND.ink, fontSize: 24, fontWeight: 700, letterSpacing: 14, color: '#e7f3ff',
        }, 'WELCOME TO'),
      ]),
      el('div', {
        ...absolute, bottom: 40, left: 0, width: WIDTH, justifyContent: 'center',
        fontSize: 22, letterSpacing: 8, color: BRAND.dim,
      }, 'VERIFY  ·  JOIN  ·  BELONG'),
    ]);

    const svg = await satori(tree as never, { width: WIDTH, height: HERO_H, fonts: await loadFonts() });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
  } catch (e) {
    log.error('welcome banner render failed', e);
    return null;
  }
}
