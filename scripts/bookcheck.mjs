// A book: several sections, in the order they are bound, on one run of paper.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/bookcheck.mjs [outDir]
//
// What a commercial refill set is: year planner, then monthlies, then
// weeklies, then notes. The app used to make one refill and treat anything
// else as a print-time extra, which is why "足す" could never be made clear --
// the thing being added had nowhere to live. A section does.
//
// So this checks the contents: what is in the book, in what order, how long
// each one runs, and that the paper and the PDF agree with the list.
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
const flat = async (sel) => (await page.locator(sel).textContent()).replace(/\s+/g, ' ').trim();
const rows = () => page.locator('.contents-list .section');
const names = async () => (await page.locator('.secname').allTextContents()).map(t => t.trim());

// One section to start with, which is what every refill ever made here was.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '62×105mm' }).click();
await page.locator('.card', { hasText: '片面' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(
  await centerOf(page.locator('.stamp', { hasText: 'マンスリー' })),
  await centerOf(page.locator('.page').first()),
);

await page.getByRole('button', { name: '戻る' }).click();
await page.locator('.contents-list').waitFor();
await page.waitForTimeout(200);
check(await rows().count() === 1, `作ったものが中身の1つ目になる（${(await names()).join(' → ')}）`);
check(
  (await flat('.contents-list')).includes('2026年9月 → 2027年8月'),
  `セクションは自分の期間を持つ（${(await page.locator('.secspan').first().textContent()).trim()}）`,
);
const paper = () => flat('.fill-note');
check((await paper()).includes('A4'), `束が何枚の紙になるかが出ている（${await paper()}）`);

// A note section: one sheet, nothing to decide about it. This is what the
// leftover places on the paper actually want.
await page.locator('.addsection').click();
await page.locator('.modal').waitFor();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/01-中身を足す.png` });
await page.locator('.fillers button', { hasText: '方眼' }).click();
await page.waitForTimeout(300);
check(
  await rows().count() === 2 && (await names())[1] === '方眼',
  `足したものが末尾に入る（${(await names()).join(' → ')}）`,
);

// How many of it -- the number someone changes when it turns out to be too
// much, said in the list rather than three screens away.
const before = await paper();
await rows().nth(1).locator('.pages button[aria-label=増やす]').click();
await rows().nth(1).locator('.pages button[aria-label=増やす]').click();
await page.waitForTimeout(300);
check(
  (await flat('.contents-list')).includes('3枚') && (await paper()) !== before,
  `枚数をその場で変えられる（${before} → ${await paper()}）`,
);
await page.screenshot({ path: `${OUT}/02-中身.png` });

// Order is binding order, so it has to be changeable.
await rows().nth(1).locator('button[aria-label=上へ]').click();
await page.waitForTimeout(200);
check((await names())[0] === '方眼', `並べ替えられる（${(await names()).join(' → ')}）`);
await rows().nth(0).locator('button[aria-label=下へ]').click();
await page.waitForTimeout(200);

// And removable, with the same confirm as everything else that takes
// something away.
await rows().nth(1).locator('button[aria-label=外す]').click();
await page.locator('.confirm').waitFor();
check(
  (await flat('.confirm')).includes('外しますか'),
  '外すときは確認する',
);
await page.getByRole('button', { name: 'やめる' }).click();
await page.waitForTimeout(200);
check(await rows().count() === 2, 'やめれば残る');

// The printed sheet, with the whole book on it.
await page.locator('.section').first().click();
await page.locator('.page').first().waitFor();
await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview').waitFor();
await page.waitForTimeout(400);
const summary = await flat('.print-summary');
check(summary.includes('リフィル'), `刷り上がりが束ぶん出ている（${summary}）`);
await page.screenshot({ path: `${OUT}/03-刷り上がり.png` });

// Saving keeps the book whole: its sections and their order.
await page.locator('.sheet button[aria-label=閉じる]').first().click().catch(() => {});
await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});
await page.waitForTimeout(200);
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.locator('.savename').waitFor();
const suggested = await page.locator('.savename').inputValue();
check(
  suggested.includes('マンスリー') && suggested.includes('方眼'),
  `名前は中身からできている（「${suggested}」）`,
);
await page.getByRole('button', { name: '保存する' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '読み込み' }).click();
await page.locator('.sheet li').first().waitFor();
check(
  (await flat('.sheet li')).includes('マンスリー → 方眼'),
  '保存した束は中身の並びごと出る',
);
await page.screenshot({ path: `${OUT}/04-保存した束.png` });
await page.locator('.sheet button[aria-label=閉じる]').first().click().catch(() => {});
await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});
await page.waitForTimeout(200);

// What comes out has all of it on it.
await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview').waitFor();
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '書き出す' }).click();
const file = `${OUT}/book.pdf`;
await (await dl).saveAs(file);
const doc = await PDFDocument.load(await readFile(file));
const { width, height } = doc.getPage(0).getSize();
const mm = [width * MM, height * MM].map(Math.round).sort((a, b) => a - b);
check(mm[0] === 210 && mm[1] === 297, `A4で出る（${mm[1]}×${mm[0]}mm）`);
console.log(`  ${doc.getPageCount()}ページ`);

await browser.close();
if (bad) process.exitCode = 1;
