// Renders the server banner as a looping GIF, and optionally hangs it.
//
//   node tools/setup/animatedbanner.mjs              # render to out/, touch nothing
//   node tools/setup/animatedbanner.mjs --apply      # set it as the server banner
//
// The frames come out of renderServerArt — the same function that draws the
// still banner and the invite splash — with a phase passed in. There is no
// second composition to keep in sync, which is the only way the animated banner
// and the still one stay the same picture.
//
// An animated banner needs boost tier 3 (feature ANIMATED_BANNER). Without it
// Discord rejects the GIF, so --apply checks first and says so.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
// gifenc ships CommonJS, so its exports arrive on the default.
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { renderServerArt } from '../../apps/bot/dist/lib/banner.js';

const W = 960, H = 540;                       // Discord's banner size, exactly
const FRAMES = Number(process.env.BANNER_FRAMES ?? 36);
const DELAY = Number(process.env.BANNER_DELAY ?? 90);   // ms per frame
const TAGLINE = process.env.BANNER_TAGLINE ?? 'PERSIAN COMMUNITY';
const APPLY = process.argv.includes('--apply');
const OUT = join(process.cwd(), 'out');

/** One frame, as raw RGBA. */
async function frame(i) {
  const png = await renderServerArt(W, H, TAGLINE, i / FRAMES);
  if (!png) throw new Error(`frame ${i} failed to render`);
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { png, rgba: new Uint8ClampedArray(data) };
}

/*
 * An 8x8 Bayer matrix, the classic one, as thresholds in [0,1).
 */
const BAYER = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map(v => v / 64);

/**
 * Breaks the gradient up before the palette ever sees it.
 *
 * GIF quantisation works on a 5-6-5 bit grid, and this banner is almost
 * entirely a very dark blue ramp — from #05060c up to about #0e1a2e. Across
 * that range the red channel has roughly three distinct values on that grid, so
 * the halo came out as concentric rings, like a contour map. It was the single
 * ugliest thing about the first encode and no amount of extra palette entries
 * fixed it, because the entries do not exist to allocate.
 *
 * So each pixel is nudged by less than one grid step before quantising, by an
 * amount that depends only on where it sits in an 8x8 tile. The rings dissolve
 * into a fine, even grain that reads as texture at any sane viewing size.
 *
 * Ordered, not random, and that matters twice over: the pattern is identical
 * from frame to frame, so a pixel that did not move still quantises to the same
 * index and the delta-frame trick below keeps working. Random noise would have
 * made every pixel differ every frame and blown the file up.
 */
function dither(rgba, w) {
  // One full 5-6-5 step per channel.
  const step = [255 / 31, 255 / 63, 255 / 31];
  for (let i = 0, px = 0; i < rgba.length; i += 4, px++) {
    const t = BAYER[((px / w | 0) % 8) * 8 + (px % w) % 8] - 0.5;
    for (let c = 0; c < 3; c++) {
      rgba[i + c] = Math.min(255, Math.max(0, Math.round(rgba[i + c] + t * step[c])));
    }
  }
}

/**
 * Encodes the frames as one looping GIF.
 *
 * Two things keep the file small enough for Discord to take.
 *
 * One palette for the whole loop, built from frames spread across the turn
 * rather than from the first one. A per-frame palette on a picture that is
 * almost entirely one dark blue gradient makes the background crawl, because
 * each frame quantises the same pixels slightly differently.
 *
 * And because the palette is shared, a pixel that did not move keeps the exact
 * same index — so every frame after the first only has to carry what changed,
 * with the rest left transparent over the frame beneath. On this banner most of
 * the picture is still, and the file is a fraction of what whole frames cost.
 */
function encode(frames) {
  for (const f of frames) dither(f.rgba, W);

  // 255 colours, not 256: the last index is spent on "nothing changed here".
  const sample = [0, 0.25, 0.5, 0.75].map(f => frames[Math.round(f * frames.length) % frames.length].rgba);
  const merged = new Uint8ClampedArray(sample.reduce((n, s) => n + s.length, 0));
  sample.reduce((at, s) => (merged.set(s, at), at + s.length), 0);

  const palette = quantize(merged, 255, { format: 'rgb565' });
  while (palette.length < 256) palette.push([0, 0, 0]);
  const CLEAR = 255;

  const gif = GIFEncoder();
  let prev = null;
  let carried = 0;

  for (const f of frames) {
    const index = applyPalette(f.rgba, palette, 'rgb565');
    if (prev) {
      for (let i = 0; i < index.length; i++) {
        if (index[i] === prev[i]) { index[i] = CLEAR; carried++; }
      }
    }
    const next = prev ? prev.slice() : index.slice();
    if (prev) for (let i = 0; i < index.length; i++) if (index[i] !== CLEAR) next[i] = index[i];

    gif.writeFrame(index, W, H, {
      palette, delay: DELAY,
      // dispose 1 = leave the frame up, so the next one paints over it. Without
      // it the transparent pixels clear to the background and the banner blinks.
      ...(prev ? { transparent: true, transparentIndex: CLEAR, dispose: 1 } : { dispose: 1 }),
    });
    prev = next;
  }
  gif.finish();
  const carriedPct = Math.round((carried / (frames.length * W * H)) * 100);
  return { bytes: Buffer.from(gif.bytes()), carriedPct };
}

const t0 = Date.now();
const frames = [];
for (let i = 0; i < FRAMES; i++) {
  frames.push(await frame(i));
  process.stdout.write(`\rrendering ${i + 1}/${FRAMES}`);
}
const { bytes, carriedPct } = encode(frames);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'banner-animated.gif'), bytes);
await writeFile(join(OUT, 'banner-still.png'), frames[0].png);

const mb = (bytes.length / 1e6).toFixed(2);
console.log(`\n${FRAMES} frames · ${DELAY}ms · ${(FRAMES * DELAY / 1000).toFixed(2)}s loop`);
console.log(`${mb} MB · ${carriedPct}% of pixels carried over · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`out/banner-animated.gif\nout/banner-still.png`);
// Discord's ceiling for guild assets. Worth failing loudly here rather than on
// upload, where the error names a byte count and not a cause.
if (bytes.length > 10e6) console.error('! over 10 MB — Discord will refuse it. Drop BANNER_FRAMES.');

if (!APPLY) { console.log('\nrender only — pass --apply to hang it'); process.exit(0); }

const { Client, GatewayIntentBits } = await import('discord.js');
await import('dotenv/config');
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    if (!g.features.includes('ANIMATED_BANNER')) {
      console.error(`! tier ${g.premiumTier} — an animated banner needs ANIMATED_BANNER (tier 3)`);
      process.exitCode = 1; return;
    }
    await g.setBanner(bytes, 'AION: house identity, animated');
    console.log('banner set');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
