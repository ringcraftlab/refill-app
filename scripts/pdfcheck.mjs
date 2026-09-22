// Exports a PDF from the running app and checks what came out: the paper size,
// how many refills landed on each sheet, and a rendered image to look at.
//
//   node scripts/pdfcheck.mjs [outDir]
//   SIZE='横長ミニ3穴' node scripts/pdfcheck.mjs out   # any card in the picker
import { BASE, launch } from './browser.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const OUT = process.argv[2] ?? 'shots';
const SIZE = process.env.SIZE ?? 'M6';
const MM = 25.4 / 72;
await mkdir(OUT, { recursive: true });

const browser = await launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE);

await page.locator('.sizerow', { hasText: SIZE }).first().click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();

const centerOf = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}
const stamp = async (label) => {
  const el = page.locator('.stamp', { hasText: label });
  await el.scrollIntoViewIfNeeded();
  return el;
};

const leftPage = page.locator('.page').first();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(leftPage));
const lp = await leftPage.boundingBox();
await drag(await centerOf(await stamp('メモ')), { x: lp.x + lp.width / 2, y: lp.y + lp.height * 0.85 });

await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
// Two copies of the spread, so the tiling has four refills to place.
await page.locator('.stepper button').filter({ hasText: '＋' }).first().click();
console.log('sheet says:', await page.locator('.print-summary').textContent());

const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '書き出す' }).click();
const file = `${OUT}/imposed.pdf`;
await (await dl).saveAs(file);

const buf = await readFile(file);
const doc = await PDFDocument.load(buf);
console.log('pdf pages:', doc.getPageCount());
doc.getPages().forEach((p, i) => {
  const { width, height } = p.getSize();
  console.log(`  page${i + 1}: ${(width * MM).toFixed(1)} x ${(height * MM).toFixed(1)} mm`);
});

// Look at it rather than trusting the numbers.
const viewer = await ctx.newPage();
await viewer.setViewportSize({ width: 900, height: 1200 });
await viewer.goto(`file://${resolve(file)}`);
await viewer.waitForTimeout(3000);
await viewer.screenshot({ path: `${OUT}/imposed.png` });
console.log('rendered', `${OUT}/imposed.png`);

await browser.close();
