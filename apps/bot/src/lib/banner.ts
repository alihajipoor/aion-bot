import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './log.js';
import { plainName } from './text.js';

const log = logger('banner');

// dist/lib -> apps/bot/assets
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

let fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] | null = null;

/** Vazirmatn covers Latin and Persian, so one family renders every name. */
async function loadFonts() {
  if (fonts) return fonts;
  const [regular, bold] = await Promise.all([
    readFile(join(ASSETS, 'Vazirmatn-Regular.ttf')),
    readFile(join(ASSETS, 'Vazirmatn-Bold.ttf')),
  ]);
  fonts = [
    { name: 'Vazirmatn', data: regular, weight: 400, style: 'normal' },
    { name: 'Vazirmatn', data: bold, weight: 700, style: 'normal' },
  ];
  return fonts;
}

export interface BannerRow { name: string; value: string; amount: number }

const MEDAL = ['#ffd700', '#c0c0c0', '#cd7f32'];

/* Satori takes plain objects, so no JSX build step is needed. */
const el = (type: string, style: Record<string, unknown>, children?: unknown): unknown =>
  ({ type, props: { style, ...(children === undefined ? {} : { children }) } });

export async function renderLeaderboardBanner(opts: {
  title: string;
  subtitle: string;
  accent: string;
  rows: BannerRow[];
}): Promise<Buffer | null> {
  try {
    const rows = opts.rows.slice(0, 8);
    const max = Math.max(1, ...rows.map(r => r.amount));

    const body = rows.length
      ? rows.map((r, i) => el('div', {
          display: 'flex', alignItems: 'center', gap: 18, height: 52, width: 904,
        }, [
          el('div', {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, minWidth: 42, flexShrink: 0,
            borderRadius: 12, fontSize: 20, fontWeight: 700,
            background: i < 3 ? MEDAL[i]! : 'rgba(255,255,255,0.08)',
            color: i < 3 ? '#0b0d17' : '#8b93a7',
          }, String(i + 1)),
          el('div', { display: 'flex', flexDirection: 'column', width: 844, gap: 6 }, [
            el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: 844 }, [
              el('div', {
              fontSize: 24, fontWeight: 700, color: '#e8ecf5',
              overflow: 'hidden', maxWidth: 600,
            }, plainName(r.name) || '—'),
              el('div', { fontSize: 20, fontWeight: 700, color: opts.accent }, r.value),
            ]),
            el('div', {
              display: 'flex', height: 8, borderRadius: 4,
              background: 'rgba(255,255,255,0.06)', width: 844,
            }, [
              el('div', {
                display: 'flex', height: 8, borderRadius: 4,
                width: Math.max(24, Math.round((r.amount / max) * 844)),
                background: `linear-gradient(90deg, ${opts.accent}, ${opts.accent}55)`,
              }),
            ]),
          ]),
        ]))
      : [el('div', { fontSize: 24, color: '#8b93a7' }, 'Hanooz data-i sabt nashode.')];

    const tree = el('div', {
      display: 'flex', flexDirection: 'column', width: 1000, height: 620,
      padding: 48, background: '#0b0d17', fontFamily: 'Vazirmatn', gap: 22,
    }, [
      el('div', { display: 'flex', flexDirection: 'column', gap: 6 }, [
        el('div', { fontSize: 46, fontWeight: 700, color: '#ffffff' }, opts.title),
        el('div', { fontSize: 22, color: '#8b93a7' }, opts.subtitle),
      ]),
      el('div', { display: 'flex', height: 3, background: opts.accent, width: 140, borderRadius: 2 }),
      el('div', { display: 'flex', flexDirection: 'column', gap: 14 }, body),
    ]);

    const svg = await satori(tree as never, {
      width: 1000, height: 620, fonts: await loadFonts(),
    });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1000 } }).render().asPng());
  } catch (e) {
    // A failed banner must never block the text post.
    log.error('banner render failed', e);
    return null;
  }
}
