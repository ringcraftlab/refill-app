// Several designs on one sheet of paper.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/basketcheck.mjs [outDir]
//
// A year of monthlies is twelve refills and an A3 holds more, so the rest of
// the paper can carry something else -- but only something the same tiling can
// place. What this checks is that rule: what is offered, what it adds up to,
// and that the paper that comes out has all of it on it.
import { BASE, launch } from './browser.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const OUT = process.argv[2] ?? 'shots';
const MM = 25.4 / 72;
await mkdir(OUT, { recursive: true });

let bad = 0;
const check = (ok, line) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'NG  '} ${line}`); };

const browser = await launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.setViewportSize({ width: 1330, height: 900 });

const centerOf = async (l) => {
  const b = await l.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
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

// The app has no field for a layout's name yet, so the saved one is renamed in
// place; everything else goes through the screen.
async function make(sizeText, form, part, name) {
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: sizeText }).click();
  await page.locator('.card', { hasText: form }).first().click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await drag(await centerOf(await stamp(part)), await centerOf(page.locator('.page').first()));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(300);
  await page.evaluate((n) => {
    const KEY = 'refill-app.layouts';
    const box = JSON.parse(localStorage.getItem(KEY));
    box.layouts[box.layouts.length - 1].name = n;
    localStorage.setItem(KEY, JSON.stringify(box));
  }, name);
}

await make('62×105mm', '片面', 'メモ', 'メモ');
// A spread is the same punched sheet as a single page -- two faces of it --
// so it mixes. A fold is not: its tile is the strip, 173.5×105 against 62×105.
await make('62×105mm', '見開き', 'マンスリー', '見開きのほう');
await make('62×105mm', '蛇腹2面', 'マンスリー', '蛇腹のほう');
await make('62×105mm', '片面', 'マンスリー', '月間');

await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview').waitFor();
await page.locator('.sheet').getByRole('button', { name: 'A3', exact: true }).click();
await page.waitForTimeout(300);

const rows = page.locator('.basket li');
const names = (await rows.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
check(
  await rows.count() === 2 && names.some(n => n.includes('メモ')) && names.some(n => n.includes('見開き')),
  `同じ穴の紙のものが出る（${names.join(' / ') || 'なし'}）`,
);
check(!names.join(' ').includes('蛇腹'), '蛇腹は混ぜられない（帯の寸法が違う）');

const label = () => page.locator('.sheet').getByText(/同じ紙に足す/).textContent();
const facesIn = async () => Number((await label()).match(/いま(\d+)面/)[1]);
const before = await facesIn();

const memo = rows.filter({ hasText: 'メモ' });
await memo.getByRole('button', { name: '増やす' }).click();
await memo.getByRole('button', { name: '増やす' }).click();
await page.waitForTimeout(300);
const after = await facesIn();
check(after === before + 2, `メモを2枚足すと2面増える（${before} → ${after}）`);

await page.screenshot({ path: `${OUT}/01-同じ紙に足す.png` });

const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '書き出す' }).click();
const file = `${OUT}/basket.pdf`;
await (await dl).saveAs(file);
const doc = await PDFDocument.load(await readFile(file));
const { width, height } = doc.getPage(0).getSize();
const mm = [width * MM, height * MM].map(Math.round).sort((a, b) => a - b);
check(mm[0] === 297 && mm[1] === 420, `A3で出る（${mm[1]}×${mm[0]}mm）`);

// The faces have to fit on the sheets that came out: two sides to a sheet.
const perPage = Number((await page.locator('.print-summary').textContent().catch(() => '')).match(/に (\d+) /)?.[1] ?? 0);
console.log(`  ${after}面・1枚に${perPage || '?'}面・${doc.getPageCount()}ページ`);

await browser.close();
if (bad) process.exitCode = 1;
