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

/**
 * A rank badge: a crest whose top edge *is* the crown, filled solid, with the
 * rank's initial knocked out of it.
 *
 * Two things drove this. A crown floating above a letter reads as two objects
 * that happen to be near each other, so here the crown is the silhouette — the
 * letter is set high enough that its cap rises between the points, cut into
 * the metal rather than standing under it.
 *
 * And solid mass survives the downscale in a way outlines never do. At 20px a
 * glowing line becomes a smudge, while a filled crest keeps its shape and its
 * colour, and the knocked-out letter stays a hole you can read.
 */
const CREST = 'M10 26 L16 4 L25 19 L32 1 L39 19 L48 4 L54 26 '
            + 'L54 39 C54 50 45 58 32 62 C19 58 10 50 10 39 Z';

function crownedLetter(letter, colour, id) {
  return `<defs>
    <linearGradient id="f${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.92"/>
      <stop offset="0.35" stop-color="${colour}"/>
      <stop offset="1" stop-color="${colour}" stop-opacity="0.72"/>
    </linearGradient>
    <filter id="g${id}" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3.4"/>
    </filter>
  </defs>
  <path d="${CREST}" fill="${colour}" filter="url(#g${id})" opacity="0.85"/>
  <path d="${CREST}" fill="url(#f${id})" stroke="${colour}" stroke-width="2" stroke-linejoin="round"/>
  <text x="32" y="53" text-anchor="middle" font-family="Vazirmatn" font-size="48"
        font-weight="700" fill="#0b0d17" fill-opacity="0.92">${letter}</text>`;
}

function letterSvg(letter, colour, id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + `${crownedLetter(letter, colour, id)}</svg>`;
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
    const draw = (id) => isLetter ? crownedLetter(shape, colour, id) : glyph(shape, colour, id);
    body += `<g transform="translate(${x},${y}) scale(0.72)">${draw(`a${i}`)}</g>`
      + `<g transform="translate(${x + 62},${y + 12}) scale(0.31)">${draw(`b${i}`)}</g>`
      + `<text x="${x + 96}" y="${y + 32}" fill="#c8cede" font-family="Helvetica,Arial" font-size="17">${clean}</text>`;
  });
  const W = COLS * CW, H = rows * RH + 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#0b0d17"/>`
    + `<text x="24" y="30" fill="#8b93a7" font-family="Helvetica,Arial" font-size="15">`
    + `AION role icons — drawn size, then the ~20px Discord actually renders</text>${body}</svg>`;
}

const ICONS = [
  // Dev and Consultant both sit at the top; colour separates them, not rank.
  ['Dev',                  'D',       C.ice,    true,  'Dev'],
  ['Consultant',           'C',       C.gold,   true,  'Consultant'],
  ['PowerAdmin',           'P',       C.ice,    true,  'PowerAdmin'],
  ['𝙼𝙰𝙽𝚂𝙸𝙾𝙽 𝙺𝙴𝚈',  'key',     C.gold,   false, 'Mansion Key'],
  ['V . Global',           'G',       C.ice,    true,  'V Global'],
  ['P . Global',           'G',       C.blue,   true,  'P Global'],
  ['G . Global',           'G',       C.green,  true,  'G Global'],
  ['E . Global',           'G',       C.purple, true,  'E Global'],
  ['P . MODERATOR',        'M',       C.blue,   true,  'P Moderator'],
  ['G . MODERATOR',        'M',       C.green,  true,  'G Moderator'],
  ['E . MODERATOR',        'M',       C.purple, true,  'E Moderator'],
  ['Server Banned',        'struck',  C.red,    false, 'Server Banned'],
  ['Public Banned',        'struck',  C.blue,   false, 'Public Banned'],
  ['Game Banned',          'struck',  C.green,  false, 'Game Banned'],
  ['Event Banned',         'struck',  C.purple, false, 'Event Banned'],
  ['Public Muted',         'barred',  C.amber,  false, 'Public Muted'],
  ['Game Muted',           'barred',  C.amber,  false, 'Game Muted'],
  ['Entertainment Muted',  'barred',  C.amber,  false, 'Entertainment Muted'],
  ['ᴀ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•', 'note', C.purple, false, 'Music Robot'],
  ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•',   'pip',    C.blue,   false, 'boy MEMBER'],
  ['ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•',  'pip',    C.pink,   false, 'girl MEMBER'],
];

const FONT = new URL('../../apps/bot/assets/fonts/Vazirmatn-Bold.ttf', import.meta.url).pathname;
const opts = { fitTo: { mode: 'width', value: 128 },
  font: { fontFiles: [FONT], defaultFontFamily: 'Vazirmatn', loadSystemFonts: false } };

const png = (shape, colour, id, letter) =>
  Buffer.from(new Resvg(letter ? letterSvg(shape, colour, id) : svg(shape, colour, id), opts).render().asPng());

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
