// Shared by the tests that measure Persian word order on a drawn image.
// Not a test file itself (no .test.), so node --test does not run it alone.
//
// Judged by eye the order was got wrong twice, in both directions, so it is
// checked the way a reader would: the word at the RIGHT end of the drawn line
// must be the first word written. Each word is drawn alone and compared with
// the right end of the full line; the closest match is what a Persian reader
// sees first.

export async function measurer() {
  const { default: satori } = await import('satori');
  const { Resvg } = await import('@resvg/resvg-js');
  const { default: sharp } = await import('sharp');
  const { readFile } = await import('node:fs/promises');
  const fonts = [{ name: 'Vazirmatn', data: await readFile(new URL('../assets/fonts/Vazirmatn-Bold.ttf', import.meta.url)), weight: 700 }];
  const H = 120;
  /** `W` is wide enough by default for a short phrase; pass more for a long line, or its right end is cut off. */
  const raster = async (node, W = 900) => {
    const tree = { type: 'div', props: { style: { display: 'flex', width: W, height: H, background: '#fff', color: '#000', fontFamily: 'Vazirmatn', fontSize: 60, alignItems: 'center', paddingLeft: 40 }, children: [node] } };
    const png = new Resvg(await satori(tree, { width: W, height: H, fonts })).render().asPng();
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    const cols = [];
    for (let x = 0; x < info.width; x++) for (let y = 0; y < info.height; y++) if (data[y * info.width + x] < 128) { cols.push(x); break; }
    return { data, info, left: cols[0], right: cols[cols.length - 1] };
  };
  const crop = (r, x0, w) => { const o = []; for (let y = 0; y < r.info.height; y++) for (let x = x0; x < x0 + w; x++) o.push(r.data[y * r.info.width + x] < 128); return o; };
  const diff = (a, b) => a.filter((v, i) => v !== b[i]).length / a.length;
  /** Which candidate is drawn at the given end of `line`. */
  const atEnd = (line, candidates, end) => candidates.map(c => {
    const w = c.img.right - c.img.left + 1;
    const x0 = end === 'right' ? line.right - w + 1 : line.left;
    return { label: c.label, d: diff(crop(line, x0, w), crop(c.img, c.img.left, w)) };
  }).sort((x, y) => x.d - y.d)[0].label;
  return { raster, atEnd };
}

export const box = (s) => ({ type: 'div', props: { style: { display: 'flex' }, children: [s] } });
