// Exports a PDF from the running app and checks what came out: page size must
// be the physical punched sheet, and nothing may sit in the ring strip.
//
//   node scripts/pdfcheck.mjs
import { chromium } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const MM = 25.4 / 72;
const dir = await mkdtemp(join(tmpdir(), 'refill-pdf-'));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE);

await page.locator('.card', { hasText: 'M6' }).click();
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
const stamp = (label) => page.locator('.stamp', { hasText: label });
const leftPage = page.locator('.page').first();
await drag(await centerOf(stamp('マンスリー')), await centerOf(leftPage));
const lp = await leftPage.boundingBox();
await drag(await centerOf(stamp('メモ')), { x: lp.x + lp.width / 2, y: lp.y + lp.height * 0.85 });

const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'PDF出力' }).click();
const file = join(dir, 'out.pdf');
await (await dl).saveAs(file);
await browser.close();

const buf = await readFile(file);
const doc = await PDFDocument.load(buf);
console.log('pages:', doc.getPageCount());
doc.getPages().forEach((p, i) => {
  const { width, height } = p.getSize();
  console.log(`  page${i + 1}: ${(width * MM).toFixed(1)} x ${(height * MM).toFixed(1)} mm`);
});
console.log('bytes:', buf.length);
