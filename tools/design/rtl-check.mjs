// Objective check of Persian word order in rendered cards: which word is drawn
// at the RIGHT end of the line (where a Persian reader starts)?
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { say } from '../../apps/bot/dist/lib/banner.js';
const fonts = [{ name: 'Vazirmatn', data: await readFile('apps/bot/assets/fonts/Vazirmatn-Bold.ttf'), weight: 700 }];
const W = 900, H = 120;
async function raster(node) {
  const tree = { type: 'div', props: { style: { display: 'flex', width: W, height: H, background: '#fff', color: '#000', fontFamily: 'Vazirmatn', fontSize: 60, alignItems: 'center', paddingLeft: 40 }, children: [node] } };
  const png = new Resvg(await satori(tree, { width: W, height: H, fonts })).render().asPng();
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  // columns that contain ink
  const ink = [];
  for (let x = 0; x < info.width; x++) { let any = false; for (let y = 0; y < info.height; y++) if (data[y * info.width + x] < 128) { any = true; break; } ink.push(any); }
  const cols = ink.map((v, i) => v ? i : -1).filter(i => i >= 0);
  return { data, info, left: cols[0], right: cols[cols.length - 1] };
}
const crop = (r, x0, w) => { const out = []; for (let y = 0; y < r.info.height; y++) for (let x = x0; x < x0 + w; x++) out.push(r.data[y * r.info.width + x] < 128 ? 1 : 0); return out; };
const diff = (a, b) => a.reduce((s, v, i) => s + (v !== b[i] ? 1 : 0), 0) / a.length;
for (const phrase of ['کیف پول آیون', 'تولدتون مبارک', 'علی رضا']) {
  const words = phrase.split(' ');
  const line = await raster(say(phrase, { fontSize: 60, fontWeight: 700 }));
  const alone = await Promise.all(words.map(w => raster({ type: 'div', props: { style: { display: 'flex' }, children: [w] } })));
  // Compare the right-hand end of the line with each word drawn on its own, aligned on their right edges.
  const scores = alone.map((a, i) => {
    const w = a.right - a.left + 1;
    return { word: words[i], score: diff(crop(line, line.right - w + 1, w), crop(a, a.left, w)) };
  }).sort((x, y) => x.score - y.score);
  console.log(`"${phrase}" — rightmost word drawn: ${scores[0].word}  (should be ${words[0]})  ${scores[0].word === words[0] ? 'CORRECT' : 'WRONG'}`);
}
