// A role icon pack in the AION palette.
//
// Discord draws role icons at roughly 20px beside a name, so every one of
// these is a single silhouette: one shape, high contrast, no text, no
// gradient. Detail at this size is noise. Each carries a thin dark outline so
// it survives a light theme as well as the dark one.
//
// Colour says which family a role belongs to; shape says which rank.
import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { Client, GatewayIntentBits } from 'discord.js';
import { Resvg } from '@resvg/resvg-js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');
const OUT = process.env.ICON_OUT ?? null;

const C = {
  ice:    '#eaf4ff',   // the wordmark white
  blue:   '#4aa6ff',   // Public
  green:  '#57f287',   // Game
  purple: '#9b6cff',   // Entertainment
  gold:   '#ffd76a',   // elevated staff
  red:    '#ed4245',   // bans
  amber:  '#faa61a',   // mutes
  pink:   '#f47fff',
};

/* Shapes, all on a 64x64 field with a 6px margin so nothing touches the edge. */
const SHAPE = {
  // The wordmark's own mark.
  lambda: 'M32 8 L52 56 L41 56 L32 30 L23 56 L12 56 Z',
  crown:  'M8 46 L14 20 L24 34 L32 14 L40 34 L50 20 L56 46 Z M8 50 H56 V56 H8 Z',
  shield: 'M32 7 L55 16 V33 C55 46 45 54 32 58 C19 54 9 46 9 33 V16 Z',
  star:   'M32 6 L39 25 L59 25 L43 37 L49 57 L32 45 L15 57 L21 37 L5 25 L25 25 Z',
  // Bow, shaft, two teeth. The hole needs evenodd or it fills solid.
  key:    'M32 6 a13 13 0 1 1 -0.01 0 Z M32 13 a6 6 0 1 0 0.01 0 Z '
        + 'M28 30 h8 v26 h-8 Z M36 38 h10 v6 h-10 Z M36 48 h8 v6 h-8 Z',
  slash:  'M32 6 a26 26 0 1 0 0.01 0 Z M17 47 L47 17',
  mute:   'M12 25 H22 L34 13 V51 L22 39 H12 Z M42 24 L58 40 M58 24 L42 40',
  // Head, stem and flag as one closed outline — cleaner at 20px than a
  // separate ellipse that loses its rotation when scaled down.
  note:   'M34 14 L52 21 L52 31 L40 26 V46 a10 9 0 1 1 -6 -8 Z',
  spark:  'M32 6 L37 27 L58 32 L37 37 L32 58 L27 37 L6 32 L27 27 Z',
  dot:    'M32 14 L50 32 L32 50 L14 32 Z',
};

/** Filled shapes read better than strokes at 20px; slash and mute need both. */
/**
 * Neon: a blurred halo, a saturated tube, and a near-white core, all tracing
 * the same outline. Everything is stroked — a filled shape has no tube to
 * light, and the glow would sit behind a solid block instead of around a line.
 *
 * The halo is the reason these still read at 20px: the blur survives the
 * downscale as a coloured aura even when the 2px core is nearly gone, so the
 * icon keeps its colour identity long after its shape stops being legible.
 */
export function glyph(shape, colour, id = 'g') {
  const d = SHAPE[shape];
  const tube = (w, c, opacity = 1, filter = '') =>
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-opacity="${opacity}"`
    + ` stroke-linecap="round" stroke-linejoin="round"${filter}/>`;
  return `<defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">`
    + `<feGaussianBlur stdDeviation="3.2"/></filter></defs>`
    + tube(9, colour, 0.95, ` filter="url(#${id})"`)   // halo
    + tube(5.5, colour)                                 // tube
    + tube(1.8, '#ffffff', 0.92);                       // core
}

function svg(shape, colour, id = 'i') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${glyph(shape, colour, id)}</svg>`;
}

/** A contact sheet at both the drawn size and the size Discord really uses. */
function contactSheet() {
  const COLS = 3, CW = 340, RH = 84;
  const rows = Math.ceil(ICONS.length / COLS);
  let body = '';
  ICONS.forEach(([label, shape, colour, , plain], i) => {
    const x = (i % COLS) * CW + 24, y = Math.floor(i / COLS) * RH + 30;
    // The sheet's font has no small caps or mathematical monospace, so styled
    // role names need a plain spelling or they render as tofu.
    const clean = plain ?? label;
    body += `<g transform="translate(${x},${y}) scale(0.72)">${glyph(shape, colour, `a${i}`)}</g>`
      + `<g transform="translate(${x + 62},${y + 12}) scale(0.31)">${glyph(shape, colour, `b${i}`)}</g>`
      + `<text x="${x + 96}" y="${y + 32}" fill="#c8cede" font-family="Helvetica,Arial" font-size="17">${clean}</text>`;
  });
  const W = COLS * CW, H = rows * RH + 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#0b0d17"/>`
    + `<text x="24" y="30" fill="#8b93a7" font-family="Helvetica,Arial" font-size="15">`
    + `AION role icons — drawn size, then the ~20px Discord actually renders</text>${body}</svg>`;
}

const ICONS = [
  ['Dev',                  'lambda', C.ice,    false, 'Dev'],
  ['Consultant',           'crown',  C.gold,   false, 'Consultant'],
  ['PowerAdmin',           'crown',  C.ice,    false, 'PowerAdmin'],
  ['𝙼𝙰𝙽𝚂𝙸𝙾𝙽 𝙺𝙴𝚈',  'key',    C.gold,   false, 'Mansion Key'],
  ['V . Global',           'star',   C.ice,    false, 'V Global'],
  ['P . Global',           'star',   C.blue,   false, 'P Global'],
  ['G . Global',           'star',   C.green,  false, 'G Global'],
  ['E . Global',           'star',   C.purple, false, 'E Global'],
  ['P . MODERATOR',        'shield', C.blue,   false, 'P Moderator'],
  ['G . MODERATOR',        'shield', C.green,  false, 'G Moderator'],
  ['E . MODERATOR',        'shield', C.purple, false, 'E Moderator'],
  ['Server Banned',        'slash',  C.red,    true, 'Server Banned'],
  ['Public Banned',        'slash',  C.blue,   true, 'Public Banned'],
  ['Game Banned',          'slash',  C.green,  true, 'Game Banned'],
  ['Event Banned',         'slash',  C.purple, true, 'Event Banned'],
  ['Public Muted',         'mute',   C.amber,  true, 'Public Muted'],
  ['Game Muted',           'mute',   C.amber,  true, 'Game Muted'],
  ['Entertainment Muted',  'mute',   C.amber,  true, 'Entertainment Muted'],
  ['ᴀ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•', 'note', C.purple, false, 'Music Robot'],
  ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•',   'dot',    C.blue,   false, 'boy | MEMBER'],
  ['ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•',  'dot',    C.pink,   false, 'girl | MEMBER'],
];

const png = (shape, colour, id) =>
  Buffer.from(new Resvg(svg(shape, colour, id), { fitTo: { mode: 'width', value: 128 } }).render().asPng());

/** File-safe name, so the pack on disk is readable without the styled glyphs. */
const slug = n => (ICONS.find(i => i[0] === n)?.[4] ?? n)
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    if (!g.features.includes('ROLE_ICONS')) {
      console.log('! this server cannot use role icons — boost level 2 required');
      return c.destroy();
    }
    if (OUT) {
      await mkdir(OUT, { recursive: true });
      const sheet = new Resvg(contactSheet(), { fitTo: { mode: 'original' } }).render().asPng();
      await writeFile(`${OUT}/contact-sheet.png`, Buffer.from(sheet));
      console.log(`sheet -> ${OUT}/contact-sheet.png\n`);
    }

    for (const [i, [name, shape, colour, , plain]] of ICONS.entries()) {
      const r = g.roles.cache.find(x => foldRole(x.name) === foldRole(name));
      const data = png(shape, colour, `r${i}`);
      if (OUT) await writeFile(`${OUT}/${slug(name)}.png`, data);
      if (!r) { console.warn(`!     role not found: ${name}`); continue; }
      console.log(`${APPLY ? 'SET ' : 'plan'}  ${r.name.slice(0, 26).padEnd(28)} ${shape} ${colour}`);
      if (APPLY) await r.setIcon(data, 'AION: role icon pack')
        .catch(e => console.error(`   failed: ${e.message}`));
    }
    if (!APPLY) console.log('\ndry run — pass --apply to write');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
