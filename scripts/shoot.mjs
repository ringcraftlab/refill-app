// Drives the real app on a phone-sized viewport and screenshots each step, so
// layout changes are judged by looking at them rather than by reading CSS.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/shoot.mjs [outDir]
//
// CHROMIUM_PATH overrides the browser binary when the bundled one is missing.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.argv[2] ?? 'shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

const centerOf = async (locator) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// Finger drag: press, move in steps, release. The app listens to pointer
// events, so this is the same path a real touch takes.
async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

const stamp = (label) => page.locator('.stamp', { hasText: label });

await page.goto(BASE);
await shot('01-サイズ選択');

await page.locator('.sizerow', { hasText: 'ミニ6' }).click();
await shot('02-ページ構成');

await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await shot('03-空のキャンバス');

const leftPage = page.locator('.page').first();
await drag(await centerOf(stamp('マンスリー')), await centerOf(leftPage));
await shot('04-マンスリーを配置');

// Drop the memo onto the lower part of the same page.
const lp = await leftPage.boundingBox();
await drag(await centerOf(stamp('メモ')), { x: lp.x + lp.width / 2, y: lp.y + lp.height * 0.85 });
await shot('05-メモを追加');

// The app's reason for existing: the memo area is too small, so drag the
// shared border up and it grows while the calendar gives way.
const divider = page.locator('.divider.h').first();
const d = await centerOf(divider);
await drag(d, { x: d.x, y: d.y - 90 });
await shot('06-メモを広げた');

// Dropping onto one side instead divides the spread at the gutter, so the two
// pages carry different parts.
const rightPage = page.locator('.page').last();
const rp = await rightPage.boundingBox();
await drag(await centerOf(stamp('方眼')), { x: rp.x + rp.width * 0.7, y: rp.y + rp.height * 0.8 });
await shot('07-右に方眼を落とす');

await browser.close();
