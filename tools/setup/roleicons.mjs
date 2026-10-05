// A role icon pack in the AION palette.
//
// Discord draws role icons at roughly 20px beside a name, so every one of
// these is a single silhouette: one shape, high contrast, no text, no
// gradient. Detail at this size is noise. Each carries a thin dark outline so
// it survives a light theme as well as the dark one.
//
// Colour says which family a role belongs to; shape says which rank.
import 'dotenv/config';
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits } from 'discord.js';
import { Resvg } from '@resvg/resvg-js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');
const OUT = process.env.ICON_OUT ?? null;

/**
 * Apply artwork from a folder instead of the generated set.
 *
 *   node tools/setup/roleicons.mjs --from ./my-pack --apply
 *
 * Drop a PNG, JPEG or GIF per role named after the slug this tool prints —
 * p-moderator.png, server-banned.png and so on — and they are uploaded as they
 * are. Nothing is redrawn, so a pack from emoji.gg or an illustrator arrives
 * exactly as its author made it.
 *
 * Discord caps a role icon at 256 KB and renders it around 20px, so anything
 * with fine detail is worth checking small before committing to it.
 */
const fromArg = process.argv.indexOf('--from');
const FROM = fromArg > -1 ? process.argv[fromArg + 1] : null;

const C = {
  ice:    '#eaf4ff',   // the wordmark white
  blue:   '#4aa6ff',   // Public
  green:  '#57f287',   // Game
  purple: '#9b6cff',   // Entertainment
  gold:   '#ffd76a',   // elevated staff
  red:    '#ed4245',   // bans
  amber:  '#faa61a',   // mutes
  pink:   '#f47fff',
  silver: '#c9d4e4',   // second place
  bronze: '#d9905a',   // third place
};

/*
 * The set is built from the wordmark rather than from stock symbols.
 *
 * Λ is a chevron, which is already how rank is written on a uniform — so the
 * staff ladder is that one mark stacked: one for a moderator, two for a
 * global, three at the top. The house glyph and the hierarchy turn out to be
 * the same drawing, and chevrons stay legible far smaller than a crown does.
 *
 * Sanctions take the same Λ and break it: struck through for a ban, barred for
 * a mute. Losing your access is drawn as losing the mark.
 */

/**
 * A crown that sits on a letter's head. Five points, drawn small and wide so
 * it reads as a crown rather than a smear once it is 20px tall.
 */
const CROWN = 'M13 22 L18 8 L25 16 L32 4 L39 16 L46 8 L51 22 Z';

/** A chevron at a vertical offset, apex up — the Λ. */
const chev = (dy = 0, w = 18) => `M${32 - w} ${44 + dy} L32 ${44 + dy - w * 1.33} L${32 + w} ${44 + dy}`;

/** The lit rift that runs under the wordmark. */
const RIFT = 'M9 56 H55';

const SHAPE = {
  lambda1: chev(4),
  lambda2: `${chev(-4)} ${chev(10)}`,
  lambda3: `${chev(-10)} ${chev(2)} ${chev(14)}`,
  crest:   `${chev(-12)} ${chev(0)} ${chev(12)} ${RIFT}`,   // rank, and the rift
  mark:    `${chev(-2, 22)} ${RIFT}`,                        // the wordmark itself
  // Members are not on the rank ladder, so they are not given a chevron at
  // all — a small blue chevron sat at 20px indistinguishable from the Public
  // moderator's, which is the one confusion worth avoiding.
  pip:     'M32 18 L46 32 L32 46 L18 32 Z',
  struck:  `${chev(2)} M14 16 L50 52`,                       // ban: the mark broken
  // Struck through the middle rather than underlined, so it cannot be mistaken
  // for the rift that sits under the top-rank crest.
  barred:  `${chev(2)} M13 34 H51`,
  key:     'M32 10 a11 11 0 1 1 -0.01 0 Z M32 16 a5 5 0 1 0 0.01 0 Z '
         + 'M29 31 h6 v23 h-6 Z M35 38 h9 v5 h-9 Z M35 47 h7 v5 h-7 Z',
  note:    'M34 16 L52 23 L52 32 L40 27 V46 a10 9 0 1 1 -6 -8 Z',
};

/**
 * Neon: a blurred halo, a saturated tube, and a near-white core, all tracing
 * the same outline. Everything is stroked — a filled shape has no tube to
 * light, and the glow would sit behind a solid block instead of around a line.
 *
 * The halo is why these still read at 20px: the blur survives the downscale as
 * a coloured aura even when the core is nearly gone, so an icon keeps its
 * colour identity long after its shape stops being legible.
 */
export function glyph(shape, colour, id = 'g') {
  const d = SHAPE[shape];
  const tube = (w, c, opacity = 1, filter = '') =>
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-opacity="${opacity}"`
    + ` stroke-linecap="round" stroke-linejoin="round"${filter}/>`;
  return `<defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">`
    + `<feGaussianBlur stdDeviation="3.2"/></filter></defs>`
    + tube(9, colour, 0.95, ` filter="url(#${id})"`)
    + tube(5.5, colour)
    + tube(1.8, '#ffffff', 0.92);
}

function svg(shape, colour, id = 'i') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${glyph(shape, colour, id)}</svg>`;
}

/* Tint helpers so each badge builds its own light and shadow from one colour. */
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb = ([r, g, b]) => `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lift = (h, amount) => rgb(hex(h).map(v => v + (255 - v) * amount));
const sink = (h, amount) => rgb(hex(h).map(v => v * (1 - amount)));

/**
 * A rank crest: the crown is the badge's own top edge, the rank's initial is
 * struck into the face, and the whole thing is lit from above.
 *
 * Depth is what separated this from a flat vector shape. There are six passes,
 * and each one is doing a job a real badge would do:
 *
 *   a cast shadow, so it sits on the list rather than floating in it
 *   a dark rim, which gives the silhouette an edge instead of a border
 *   a body gradient, bright at the crown and falling into shadow at the point
 *   a bevel — a light inner stroke along the top, a dark one along the bottom
 *   a gloss clipped to the upper half, the sheen on a struck metal face
 *   the letter cut in, with a light lip under it so it reads as engraved
 *
 * The letter is set large enough that its cap rises between the crown points.
 */
const CREST = 'M10 26 L16 4 L25 19 L32 1 L39 19 L48 4 L54 26 '
            + 'L54 39 C54 50 45 58 32 62 C19 58 10 50 10 39 Z';

/** The same badge without the crown: everything that is not a rank. */
const SHIELD = 'M10 16 L32 7 L54 16 L54 39 C54 50 45 58 32 62 C19 58 10 50 10 39 Z';

/** Glyphs carved into a shield, drawn on the same 64 field as the letters. */
const CARVED = {
  ban:  [{ d: 'M32 32 m-13 0 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0', stroke: 5.2 },
         { d: 'M22.8 41.2 L41.2 22.8', stroke: 5.2 }],
  mute: [{ d: 'M20 30 H26 L34 23 V47 L26 40 H20 Z', fill: true },
         { d: 'M40 30 L50 40', stroke: 4.5 },
         { d: 'M50 30 L40 40', stroke: 4.5 }],
  note: [{ d: 'M31 22 L46 28 L46 35 L37 31 V45 a7 6 0 1 1 -5 -5 Z', fill: true }],
  key:  [{ d: 'M32 20 a8 8 0 1 1 -0.01 0 Z M32 24 a4 4 0 1 0 0.01 0 Z '
            + 'M29.5 33 h5 v17 h-5 Z M34.5 38 h7 v4 h-7 Z M34.5 45 h5 v4 h-5 Z', fill: true }],
  gem:  [{ d: 'M32 20 L45 33 L32 46 L19 33 Z', fill: true }],
  // A person, and the plus that says bring another
  crew: [{ d: 'M27 20 a7 7 0 1 1 -0.01 0 Z', fill: true },
         { d: 'M14 47 a13 13 0 0 1 26 0 Z', fill: true },
         { d: 'M46 28 v14', stroke: 4.6 },
         { d: 'M39 35 h14', stroke: 4.6 }],
};

const carve = (name, colour) => CARVED[name].map(part => part.fill
  ? `<path d="${part.d}" fill="${colour}" fill-rule="evenodd"/>`
  : `<path d="${part.d}" fill="none" stroke="${colour}" stroke-width="${part.stroke}"`
    + ` stroke-linecap="round" stroke-linejoin="round"/>`).join('');

function crownedLetter(letter, colour, id, opts = {}) {
  const outline = opts.outline ?? CREST;
  const carved = opts.carved ?? null;
  const light = lift(colour, 0.55);
  const pale = lift(colour, 0.85);
  const deep = sink(colour, 0.45);
  const edge = sink(colour, 0.7);

  return `<defs>
    <linearGradient id="b${id}" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="${pale}"/>
      <stop offset="0.30" stop-color="${light}"/>
      <stop offset="0.62" stop-color="${colour}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
    <linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="c${id}"><path d="${outline}"/></clipPath>
    <filter id="d${id}" x="-40%" y="-40%" width="180%" height="190%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="2.4" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
    <filter id="h${id}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.6"/>
    </filter>
  </defs>

  <path d="${outline}" fill="${colour}" filter="url(#h${id})" opacity="0.55"/>
  <g filter="url(#d${id})">
    <path d="${outline}" fill="${edge}" stroke="${edge}" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="${outline}" fill="url(#b${id})"/>
    <g clip-path="url(#c${id})">
      <path d="${outline}" fill="none" stroke="${pale}" stroke-width="3" stroke-opacity="0.75"
            stroke-linejoin="round" transform="translate(0,2.2)"/>
      <path d="${outline}" fill="none" stroke="${deep}" stroke-width="3" stroke-opacity="0.6"
            stroke-linejoin="round" transform="translate(0,-2.6)"/>
      <ellipse cx="32" cy="16" rx="26" ry="19" fill="url(#s${id})"/>
    </g>
    ${carved
      ? `<g transform="translate(0,1)" opacity="0.5">${carve(carved, pale)}</g>${carve(carved, edge)}`
      : `<text x="32" y="53.6" text-anchor="middle" font-family="Vazirmatn" font-size="48"
             font-weight="700" fill="${pale}" fill-opacity="0.5">${letter}</text>
         <text x="32" y="53" text-anchor="middle" font-family="Vazirmatn" font-size="48"
             font-weight="700" fill="${edge}">${letter}</text>`}
  </g>`;
}

function letterSvg(letter, colour, id, opts = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + `${crownedLetter(letter, colour, id, opts)}</svg>`;
}

/** A contact sheet at both the drawn size and the size Discord really uses. */
function contactSheet() {
  const COLS = 3, CW = 340, RH = 84;
  const rows = Math.ceil(ICONS.length / COLS);
  let body = '';
  ICONS.forEach(([label, shape, colour, isLetter, plain], i) => {
    const x = (i % COLS) * CW + 24, y = Math.floor(i / COLS) * RH + 30;
    // The sheet's font has no small caps or mathematical monospace, so styled
    // role names need a plain spelling or they render as tofu.
    const clean = plain ?? label;
    body += `<g transform="translate(${x},${y}) scale(0.72)">${draw(shape, colour, `a${i}`, isLetter)}</g>`
      + `<g transform="translate(${x + 62},${y + 12}) scale(0.31)">${draw(shape, colour, `b${i}`, isLetter)}</g>`
      + `<text x="${x + 96}" y="${y + 32}" fill="#c8cede" font-family="Helvetica,Arial" font-size="17">${clean}</text>`;
  });
  const W = COLS * CW, H = rows * RH + 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#0b0d17"/>`
    + `<text x="24" y="30" fill="#8b93a7" font-family="Helvetica,Arial" font-size="15">`
    + `AION role icons — drawn size, then the ~20px Discord actually renders</text>${body}</svg>`;
}

const ICONS = [
  // Crowned crest: the letter is the rank, the colour is the section.
  // Dev and Consultant both sit at the top; colour separates them, not rank.
  ['Dev',                  'D',    C.ice,    'rank',  'Dev'],
  ['Consultant',           'C',    C.gold,   'rank',  'Consultant'],
  ['PowerAdmin',           'P',    C.ice,    'rank',  'PowerAdmin'],
  ['V . Global',           'G',    C.ice,    'rank',  'V Global'],
  ['P . Global',           'G',    C.blue,   'rank',  'P Global'],
  ['G . Global',           'G',    C.green,  'rank',  'G Global'],
  ['E . Global',           'G',    C.purple, 'rank',  'E Global'],
  ['P . MODERATOR',        'M',    C.blue,   'rank',  'P Moderator'],
  ['G . MODERATOR',        'M',    C.green,  'rank',  'G Moderator'],
  ['E . MODERATOR',        'M',    C.purple, 'rank',  'E Moderator'],

  // Uncrowned shield, glyph carved in: everything that is not a rank.
  ['𝙼𝙰𝙽𝚂𝙸𝙾𝙽 𝙺𝙴𝚈',  'key',  C.gold,   'carve', 'Mansion Key'],
  ['Server Banned',        'ban',  C.red,    'carve', 'Server Banned'],
  ['Public Banned',        'ban',  C.blue,   'carve', 'Public Banned'],
  ['Game Banned',          'ban',  C.green,  'carve', 'Game Banned'],
  ['Event Banned',         'ban',  C.purple, 'carve', 'Event Banned'],
  ['Public Muted',         'mute', C.amber,  'carve', 'Public Muted'],
  ['Game Muted',           'mute', C.amber,  'carve', 'Game Muted'],
  ['Entertainment Muted',  'mute', C.amber,  'carve', 'Entertainment Muted'],
  ['ᴀ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•', 'note', C.purple, 'carve', 'Music Robot'],
  ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•',   'gem',  C.blue,   'carve', 'boy MEMBER'],
  ['ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•',  'gem',  C.pink,   'carve', 'girl MEMBER'],

  // Giveaway podium. The place is the letter and the metal is the colour, so
  // the three read as one set at a glance instead of three unrelated badges.
  ['ʟᴇɢᴇɴᴅ│𝙳𝙰𝚅𝙰𝚃│•',  '1',    C.gold,   'rank',  'Legend davat'],
  ['ᴇʟɪᴛᴇ│𝙳𝙰𝚅𝙰𝚃│•',   '2',    C.silver, 'rank',  'Elite davat'],
  ['ᴘɪsʜᴛᴀᴢ│𝙳𝙰𝚅𝙰𝚃│•', '3',    C.bronze, 'rank',  'Pishtaz davat'],
  ['ʀᴇᴄʀᴜɪᴛᴇʀ│𝙳𝙰𝚅𝙰𝚃│•', 'crew', C.purple, 'carve', 'Recruiter'],
];

const FONT = fileURLToPath(new URL('../../apps/bot/assets/fonts/Vazirmatn-Bold.ttf', import.meta.url));
const opts = { fitTo: { mode: 'width', value: 128 },
  font: { fontFiles: [FONT], defaultFontFamily: 'Vazirmatn', loadSystemFonts: false } };

const draw = (shape, colour, id, mode) => mode === 'carve'
  ? crownedLetter('', colour, id, { outline: SHIELD, carved: shape })
  : crownedLetter(shape, colour, id);

const png = (shape, colour, id, mode) =>
  Buffer.from(new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + `${draw(shape, colour, id, mode)}</svg>`, opts).render().asPng());

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
    // A supplied pack wins over the generated one.
    let supplied = null;
    if (FROM) {
      const files = await readdir(FROM).catch(() => null);
      if (!files) { console.error(`cannot read ${FROM}`); return c.destroy(); }
      supplied = new Map();
      for (const f of files) {
        if (!['.png', '.jpg', '.jpeg', '.gif'].includes(extname(f).toLowerCase())) continue;
        supplied.set(basename(f, extname(f)).toLowerCase(), join(FROM, f));
      }
      console.log(`using ${supplied.size} file(s) from ${FROM}\n`);
    }

    if (OUT && !FROM) {
      await mkdir(OUT, { recursive: true });
      const sheet = new Resvg(contactSheet(),
        { fitTo: { mode: 'original' }, font: opts.font }).render().asPng();
      await writeFile(`${OUT}/contact-sheet.png`, Buffer.from(sheet));
      console.log(`sheet -> ${OUT}/contact-sheet.png\n`);
    }

    for (const [i, [name, shape, colour, isLetter, plain]] of ICONS.entries()) {
      const r = g.roles.cache.find(x => foldRole(x.name) === foldRole(name));
      const key = slug(name);
      let data, source;
      if (supplied) {
        const file = supplied.get(key);
        if (!file) { console.warn(`!     no file for ${key} — left alone`); continue; }
        data = await readFile(file);
        source = basename(file);
        if (data.byteLength > 256 * 1024) {
          console.error(`!     ${source} is ${Math.round(data.byteLength / 1024)}KB — Discord's limit is 256KB`);
          continue;
        }
      } else {
        data = png(shape, colour, `r${i}`, isLetter);
        source = `${shape} ${colour}`;
        if (OUT) await writeFile(`${OUT}/${key}.png`, data);
      }
      if (!r) { console.warn(`!     role not found: ${name}`); continue; }
      console.log(`${APPLY ? 'SET ' : 'plan'}  ${r.name.slice(0, 26).padEnd(28)} ${source}`);
      if (APPLY) await r.setIcon(data, 'AION: role icon pack')
        .catch(e => console.error(`   failed: ${e.message}`));
    }
    if (!APPLY) console.log('\ndry run — pass --apply to write');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
