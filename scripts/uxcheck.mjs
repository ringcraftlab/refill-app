// Checks the removal affordances, which are easy to break by hand and hard to
// notice: every X asks before it takes anything away, and the X over the mini
// calendar goes when the calendar itself is squeezed out.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/uxcheck.mjs [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:4173';
const OUT = process.argv[2] ?? 'shots';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
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
await drag(await centerOf(await stamp('メモ')), { x: lp.x + lp.width / 2, y: lp.y + lp.height * 0.85 });
console.log('clear buttons:', await page.locator('.clearmini').count());
await shot('01-外すボタンが並ぶ');

// Every X asks before it takes anything away.
await page.locator('.clearmini').last().click();
await shot('02-外していいですか');
await page.getByRole('button', { name: 'やめる' }).click();
console.log('after cancel, parts:', await page.locator('.hitbox.part').count());

// Squeeze the calendar until the mini month cannot fit; its X has to go too.
const d = await centerOf(page.locator('.divider.h').first());
await drag(d, { x: d.x, y: d.y - 120 });
console.log('clear buttons after squeeze:', await page.locator('.clearmini').count());
await shot('03-つぶすとミニカレンダーの×も消える');

// A part that cannot fit says which part, and what to do about it.
await drag(await centerOf(await stamp('TODO')), { x: lp.x + lp.width * 0.3, y: lp.y + lp.height * 0.6 });
console.log('toast:', await page.locator('.toast').textContent().catch(() => '(none)'));
await shot('04-入らないときの案内');

// The bottom sheet's own handle must not have caught the border handle's style.
await page.locator('.hitbox.part').first().click();
await shot('05-設定シート');

await browser.close();
