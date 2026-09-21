// Measures the same elements in two builds and reports where they differ.
//
//   node scripts/uidiff.mjs http://localhost:4174 http://localhost:4173
//
// A change meant to be invisible -- a refactor, a move to a different styling
// approach -- is checked here, where the answer is a number rather than an
// impression of two screenshots.
import { chromium } from 'playwright';

const [OLD, NEW] = process.argv.slice(2);
const SELECTORS = [
  '.sizerow', 'h1',
  '.page', '.stamp', '.stepper',
  '.preview figure', '.preview figcaption',
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

async function measure(base) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const centerOf = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const stamp = async (l) => { const e = page.locator('.stamp', { hasText: l }); await e.scrollIntoViewIfNeeded(); return e; };
  await page.goto(base);
  const out = {};
  const grab = async (tag, sel) => {
    const el = page.locator(sel).first();
    if (await el.count() === 0) return;
    const b = await el.boundingBox();
    if (b) out[tag] = [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
  };
  await grab('h1', 'h1');
  await grab('sizerow', '.sizerow');

  await page.locator('.sizerow', { hasText: 'M6' }).click();
  await grab('card', '.card');
  await page.locator('.card', { hasText: '見開き' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await grab('page', '.page');
  await grab('stamp', '.stamp');
  await grab('tray', '.stamp >> nth=0');
  await grab('hint', 'p');

  const from = await centerOf(await stamp('マンスリー'));
  const to = await centerOf(page.locator('.page').first());
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
  await grab('range', '.range');

  await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
  await page.locator('.preview svg').first().waitFor();
  await grab('sheet', '.sheet');
  await grab('figure', '.preview figure');
  await grab('thumb', '.preview svg');
  await grab('caption', '.preview figcaption');
  await grab('stepper', '.stepper');
  await page.close();
  return out;
}

const a = await measure(OLD);
const b = await measure(NEW);
const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
let bad = 0;
for (const k of keys) {
  const x = a[k], y = b[k];
  if (!x || !y) { console.log(`${k.padEnd(10)} 片方にしかない`); bad++; continue; }
  const d = x.map((v, i) => Math.round((y[i] - v) * 10) / 10);
  const same = d.every(v => Math.abs(v) < 0.6);
  if (!same) bad++;
  console.log(`${same ? 'same ' : 'DIFF '} ${k.padEnd(10)} old ${JSON.stringify(x).padEnd(30)} new ${JSON.stringify(y).padEnd(30)} Δ ${JSON.stringify(d)}`);
}
console.log(bad === 0 ? '\nすべて一致' : `\n${bad} 件ずれている`);
await browser.close();
