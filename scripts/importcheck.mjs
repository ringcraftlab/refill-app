// Taking a refill in from a file: an image, or a PDF whose pages are images.
//
//   npm run check -- import
//
// The files are made here rather than kept in the repository: a picture of a
// table drawn on a canvas, the same picture as an A5 PDF of two pages, and a
// PDF of lines and text (which this stage does not take in yet). What is
// checked is what someone would notice -- that the sheet says what will
// happen (the size, how much it shrinks, how fine it prints), that the pages
// land in the book, that a taken-in page has no tray, and that starting from
// the size screen gives the book the file's size.
import { BASE, launch, requireApp } from './browser.mjs';
import { mkdir } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const OUT = process.argv[2] ?? 'shots/import';
await mkdir(OUT, { recursive: true });
await requireApp();

let bad = 0;
const check = (ok, line) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'NG  '} ${line}`); };

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(BASE);

// A ruled table on white, 1748×2480 -- A5 at 300dpi.
const jpeg = Buffer.from(await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 1748; c.height = 2480;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#b09060'; g.lineWidth = 4;
  for (let y = 200; y < 2400; y += 80) { g.beginPath(); g.moveTo(120, y); g.lineTo(1628, y); g.stroke(); }
  g.fillStyle = '#b09060'; g.font = '90px sans-serif'; g.fillText('Annual events', 140, 150);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}), 'base64');

const MM = 72 / 25.4;
const a5 = await PDFDocument.create();
const img = await a5.embedJpg(jpeg);
for (let i = 0; i < 2; i++) {
  const p = a5.addPage([148 * MM, 210 * MM]);
  p.drawImage(img, { x: 0, y: 0, width: 148 * MM, height: 210 * MM });
}
const a5pdf = Buffer.from(await a5.save());

const vec = await PDFDocument.create();
const vp = vec.addPage([148 * MM, 210 * MM]);
const font = await vec.embedFont(StandardFonts.Helvetica);
vp.drawText('MONDAY', { x: 40, y: 500, size: 12, font });
vp.drawLine({ start: { x: 30, y: 480 }, end: { x: 380, y: 480 }, thickness: 1 });
const vecpdf = Buffer.from(await vec.save());

const choose = async (button, file) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(file);
  await page.locator('.importsheet').waitFor();
  await page.waitForTimeout(300);
};
const flat = async sel => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();

// ── From the size screen: an A5 PDF starts an A5 book.
check(await page.locator('.sizescreen .fromfile').count() === 1, 'サイズ選択の画面に「持っているリフィルを取り込む」がある');
await choose(page.locator('.sizescreen .fromfile'), { name: 'events_A5.pdf', mimeType: 'application/pdf', buffer: a5pdf });
const fromSize = await flat('.importsheet');
await page.screenshot({ path: `${OUT}/01-サイズ選択から.png` });
check(fromSize.includes('PDF 2ページ'), `PDFのページ数を言う（${fromSize.slice(0, 40)}…）`);
check(fromSize.includes('148×210mm') && fromSize.includes('A5'), '元の大きさとA5を言う');
check(fromSize.includes('ファイルと同じ大きさ'), 'サイズ選択から入るとファイルのサイズで作る');
await page.locator('.importgo').click();
await page.locator('.page').first().waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-A5で取り込んだ.png` });
check((await flat('header')).includes('A5'), `本がA5になる（${await flat('header')}）`);
check(await page.locator('.importednote').count() === 1, '取り込んだページではトレイの代わりに説明が出る');
check(await page.locator('.stamp:visible').count() === 0, '取り込んだページにはパーツを出さない');
check((await flat('.rail')).includes('取り込んだリフィル'), '帯に「取り込んだリフィル」が並ぶ');
check(await page.locator('.page image').count() >= 1, '紙に取り込んだ絵が描かれる');

// ── Into a book that is already being made: Mini6 spreads with a monthly.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.sizego').click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.stamp', { hasText: 'マンスリー' }).click();
await page.mouse.click(100, 450);
await page.waitForTimeout(400);
const pagesBefore = Number((await flat('.pageno')).match(/\/(\d+)/)[1]);
await page.locator('.pageno').click();
await page.getByRole('button', { name: /足す/ }).first().click();
await page.locator('.modal .fromfile').waitFor();
await choose(page.locator('.modal .fromfile'), { name: 'events_A5.pdf', mimeType: 'application/pdf', buffer: a5pdf });
const into = await flat('.importsheet');
await page.screenshot({ path: `${OUT}/03-ミニ6に入れる.png` });
check(into.includes('約54%'), `A5をミニ6に入れると縮む割合を言う（${(into.match(/約\d+%/) ?? ['なし'])[0]}）`);
check(/約\d+dpi/.test(into), '刷ったときの細かさを言う');
await page.getByRole('button', { name: 'いっぱいに広げる' }).click();
await page.locator('.importgo').click();
await page.locator('.importednote').waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-取り込んだページ.png` });
const pagesAfter = Number((await flat('.pageno')).match(/\/(\d+)/)[1]);
check(pagesAfter >= pagesBefore + 1, `ページが増える（${pagesBefore} → ${pagesAfter}）`);
check((await flat('.papersettings')).includes('いっぱいに広げる'), '選んだ入れ方が「この紙の設定」に出る');
await page.locator('.importfit').click();
await page.getByRole('button', { name: '全体を入れる' }).click();
await page.waitForTimeout(300);
check((await flat('.papersettings')).includes('全体を入れる'), '入れ方を後から変えられる');

// ── A PDF of lines and text is not taken in yet, and says so.
await page.keyboard.press('Escape');
await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});
await page.locator('.pageno').click();
await page.getByRole('button', { name: /足す/ }).first().click();
await choose(page.locator('.modal .fromfile'), { name: 'vector.pdf', mimeType: 'application/pdf', buffer: vecpdf });
check(await page.locator('.importskip').count() === 1, '線と文字のPDFは、まだ取り込めないと言う');
check(await page.locator('.importgo').count() === 0, '取り込めないときは「取り込む」を出さない');
await page.screenshot({ path: `${OUT}/05-線と文字のPDF.png` });

await browser.close();
console.log(bad ? `\n${bad}件NG` : '\n取り込みは仕様どおり');
process.exit(bad ? 1 : 0);
