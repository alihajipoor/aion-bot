import { readFile, writeFile } from 'node:fs/promises';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
const fonts = [{ name: 'V', data: await readFile('apps/bot/assets/fonts/Vazirmatn-Bold.ttf'), weight: 700 }];
const el = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
const row = (label, node) => el({ alignItems: 'center', gap: 30, height: 70 }, [el({ width: 330, color: '#888', fontSize: 22 }, label), node]);
const words = 'کیف پول آیون'.split(' ');
const tree = el({ flexDirection: 'column', width: 1000, height: 440, background: '#fff', color: '#000', fontFamily: 'V', fontSize: 40, padding: 20 }, [
  row('A one text node', el({}, 'کیف پول آیون')),
  row('B row-reverse + gap', el({ flexDirection: 'row-reverse', gap: 16 }, words.map(w => el({}, w)))),
  row('C row-reverse + margin', el({ flexDirection: 'row-reverse' }, words.map(w => el({ marginLeft: 16 }, w)))),
  row('D row (words reversed)', el({ gap: 16 }, [...words].reverse().map(w => el({}, w)))),
  row('E row, original order', el({ gap: 16 }, words.map(w => el({}, w)))),
  row('F mixed: Λ + Persian', el({ gap: 16 }, ['Nima', ...'علی رضا'.split(' ')].map(w => el({}, w)))),
]);
const svg = await satori(tree, { width: 1000, height: 440, fonts });
await writeFile('out/design/rtl-test.png', new Resvg(svg).render().asPng());
console.log('ok');
