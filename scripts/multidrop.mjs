// Selecting several stamps and dragging them in one go must place them
// whenever dropping the same parts one at a time would. This walks a set of
// combinations and reports which are refused.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/multidrop.mjs [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2];
if (OUT) await mkdir(OUT, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const COMBOS = [
  ['マンスリー', 'メモ', 'TODO'],
  ['メモ', '方眼', 'TODO'],
  ['ハビット', 'メモ', 'TODO'],
  ['マンスリー', '方眼', '目標'],
  ['メモ', '罫線', '方眼', '目標'],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const centerOf = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const stamp = async (label) => {
  const el = page.locator('.stamp', { hasText: label });
  await el.scrollIntoViewIfNeeded();
  return el;
};

let bad = 0;
for (const combo of COMBOS) {
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: 'ミニ6' }).click();
  await page.locator('.card', { hasText: '見開き' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();

  // Tap to select, then one drag carries the whole selection.
  for (const label of combo) await (await stamp(label)).click();
  const from = await centerOf(await stamp(combo[0]));
  const to = await centerOf(page.locator('.page').first());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  // A part crossing the gutter has a hit area on each page, so the clear
  // buttons are the honest count: one per removable block.
  const toast = await page.locator('.toast').textContent().catch(() => null);
  const placed = await page.locator('.clearmini').count();
  const ok = !toast;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${combo.join(' + ')} -> ${placed} blocks${toast ? ` "${toast}"` : ''}`);
  // Not refusing is only half of it; the arrangement has to be worth having.
  if (OUT) await page.screenshot({ path: `${OUT}/${combo.join('+')}.png` });
}
console.log(bad === 0 ? 'all placed' : `${bad} refused`);
await browser.close();
