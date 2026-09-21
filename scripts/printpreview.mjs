// The export sheet has to show what will print before anything is printed.
// This opens it, times the preview, and shoots it for both spread and single.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/printpreview.mjs [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.argv[2] ?? 'shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const centerOf = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
}
const stamp = async (label) => {
  const el = page.locator('.stamp', { hasText: label });
  await el.scrollIntoViewIfNeeded();
  return el;
};

await page.goto(BASE);
await page.locator('.sizerow', { hasText: 'ミニ6' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();

const left = page.locator('.page').first();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(left));
const lp = await left.boundingBox();
await drag(await centerOf(await stamp('方眼')), { x: lp.x + lp.width * 0.4, y: lp.y + lp.height * 0.85 });
await drag(await centerOf(await stamp('家計')), { x: lp.x + lp.width * 1.6, y: lp.y + lp.height * 0.85 });

const t0 = Date.now();
await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview svg').first().waitFor();
console.log('preview drawn in', Date.now() - t0, 'ms');
console.log('pages:', await page.locator('.field-label').filter({ hasText: '刷り上がり' }).textContent());
console.log('captions:', await page.locator('.preview figcaption').allTextContents());
await page.screenshot({ path: `${OUT}/01-刷り上がりプレビュー.png` });

// Turning duplex off has to change what is shown, live.
await page.getByRole('button', { name: '片面' }).click();
await page.waitForTimeout(400);
console.log('single-sided:', await page.locator('.field-label').filter({ hasText: '刷り上がり' }).textContent());
console.log('captions:', await page.locator('.preview figcaption').allTextContents());
await page.screenshot({ path: `${OUT}/02-片面にすると変わる.png` });

// A thumbnail is too small to read, so any of them opens full size.
await page.getByRole('button', { name: '両面' }).click();
await page.locator('.preview figure button').nth(1).click();
await page.locator('.lightbox svg').waitFor();
console.log('enlarged:', await page.locator('.lightbox-bar span').textContent());
await page.screenshot({ path: `${OUT}/03-タップで拡大.png` });
await page.getByRole('button', { name: '次のページ' }).click();
console.log('next:', await page.locator('.lightbox-bar span').textContent());
await page.getByRole('button', { name: '閉じる' }).click();
console.log('closed:', await page.locator('.lightbox').count());

await browser.close();
