// Several designs on one sheet of paper.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/basketcheck.mjs [outDir]
//
// A year of monthlies is twelve refills and an A3 holds more, so the rest of
// the paper can carry something else -- but only something the same tiling can
// place. What this checks is that rule, and the way it is reached: the paper
// is a picture in the editor, its empty places are buttons, and what comes out
// of the export has all of it on it.
//
// Twice now the answer to "how do I add one" was a list with a number to
// raise, once in the export screen and once in the saved list, and twice it
// was unreadable. So the check is written from the editor: chip, empty square,
// pick -- and it fails if any of those three is not there.
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

// Saving asks for a name, which is the whole reason a list of saved refills
// can be read at all.
async function make(sizeText, form, part, name) {
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: sizeText }).click();
  await page.locator('.card', { hasText: form }).first().click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await drag(await centerOf(await stamp(part)), await centerOf(page.locator('.page').first()));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.savename').waitFor();
  const suggested = await page.locator('.savename').inputValue();
  await page.locator('.savename').fill(name);
  await page.getByRole('button', { name: '保存する' }).click();
  await page.waitForTimeout(300);
  return suggested;
}

// Before anything is saved there is nothing that could go in an empty place,
// so there is no ＋ on one. A ＋ that answers "there is nothing to add" reads
// as a broken button, which is exactly what it is.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '62×105mm' }).click();
await page.locator('.card', { hasText: '片面' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
await page.locator('button.paper').click();
await page.locator('.sheet').waitFor();
await page.locator('.sheet').getByRole('button', { name: 'A3', exact: true }).click();
await page.waitForTimeout(300);
check(
  await page.locator('.fillmap .empty').count() === 0
    && await page.locator('.fillmap .empty-none').count() > 0,
  `保存が1つも無いときは＋を出さない（空き${await page.locator('.fillmap .empty-none').count()}面・＋${await page.locator('.fillmap .empty').count()}個）`,
);
check(
  (await page.locator('.sheet').textContent()).includes('保存した別のリフィル'),
  '代わりに、何をすれば入れられるかが書いてある',
);

const suggested = await make('62×105mm', '片面', 'メモ', 'メモ');
check(
  suggested.includes('マイクロ5') && suggested.includes('メモ'),
  `保存する名前が用意されている（「${suggested}」）`,
);
// A spread is the same punched sheet as a single page -- two faces of it --
// so it mixes. A fold is not: its tile is the strip, 173.5×105 against 62×105.
await make('62×105mm', '見開き', 'マンスリー', '見開きのほう');
await make('62×105mm', '蛇腹2面', 'マンスリー', '蛇腹のほう');
await make('62×105mm', '片面', 'マンスリー', '月間');

// The paper is said in the editor, before anything is exported: which paper,
// how many sheets, and how much of the last one is empty.
const chip = page.locator('button.paper');
const chipText = (await chip.textContent()).replace(/\s+/g, '');
// Micro5 twelve months duplex is six sheets and an upright A4 takes six, so
// this one comes out even -- which is worth saying too.
check(/A4\d+枚/.test(chipText), `用紙が編集画面に出ている（「${chipText}」）`);

await chip.click();
await page.locator('.sheet').waitFor();
await page.locator('.sheet').getByRole('button', { name: 'A3', exact: true }).click();
await page.waitForTimeout(300);
const onA3 = (await chip.textContent()).replace(/\s+/g, '');
check(onA3.includes('あと'), `あきが編集画面から見える（「${onA3}」）`);

const note = () => page.locator('.fill-note').textContent();
check((await note()).includes('A3'), `用紙を変えると数も変わる（${(await note()).trim()}）`);

// The empty places are buttons. This is the whole answer to "where does it
// go": press the place you want filled.
const empty = page.locator('.fillmap .empty');
const mine = page.locator('.fillmap .mine');
const emptied = await empty.count();
check(emptied > 0, `空いているところが押せる（${emptied}面）`);
check(await mine.count() > 0, `このリフィルのぶんは埋まって見える（${await mine.count()}面）`);
await page.screenshot({ path: `${OUT}/00-用紙の空きを押す.png` });

await empty.first().click();
// Pressed here, answered here. The first version put the list at the foot of
// a scrolling sheet, so on a 900px window pressing ＋ looked like nothing
// happening at all.
await page.waitForTimeout(500);
const seen = await page.locator('.picker').evaluate(el => {
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), win: innerHeight };
});
check(
  seen.top >= 0 && seen.bottom <= seen.win,
  `＋を押すと、そのすぐ下に丸ごと出る（${seen.top}〜${seen.bottom}px・窓${seen.win}px）`,
);
const picks = page.locator('.basket li');
const names = (await picks.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
check(
  names.some(n => n.includes('メモ')) && names.some(n => n.includes('見開き')),
  `同じ穴の紙のものが出る（${names.join(' / ') || 'なし'}）`,
);
check(!names.join(' ').includes('蛇腹'), '蛇腹は混ぜられない（帯の寸法が違う）');
check(await page.locator('.basket .thumb svg').count() >= 2, '候補は絵で見える');

await picks.filter({ hasText: 'メモ' }).click();
await page.waitForTimeout(200);
check(await page.locator('.fillmap .added').count() === 1, '押した紙に入る（1面）');
await picks.filter({ hasText: 'メモ' }).click();
await page.waitForTimeout(200);
check(await page.locator('.fillmap .added').count() === 2, 'もう一度押せば2面');
check(await page.locator('.fillmap .added .thumb svg').count() === 2, '入れたものが紙の上で絵になる');
await page.screenshot({ path: `${OUT}/01-入れたあと.png` });

// And back out again, in the same place: the square that has it is the button
// that takes it off.
await page.locator('.fillmap .added').first().click();
await page.waitForTimeout(200);
check(await page.locator('.fillmap .added').count() === 1, '入れた面を押すと外れる');
await page.locator('.fillmap .empty').first().click();
await page.locator('.basket li').filter({ hasText: 'メモ' }).click();
await page.waitForTimeout(200);

// Closing the paper does not lose it: the editor says what is going on the
// sheet beside the design.
await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});
await page.locator('.sheet button[aria-label=閉じる]').first().click().catch(() => {});
await page.waitForTimeout(200);
const also = (await page.locator('.alsonote').textContent().catch(() => '')).replace(/\s+/g, '');
check(also.includes('メモ') && also.includes('2つ'), `編集画面にも残る（「${also}」）`);

// The export screen shows the same picture, because it is the same control.
await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview').waitFor();
await page.waitForTimeout(300);
check(
  await page.locator('.fillmap .added').count() === 2,
  '書き出し画面にも同じ紙の絵が出ている',
);
const spare = (await note()).match(/(\d+)面あいて/);
check(!!spare, `あきが出る（${(await note()).trim()}）`);
await page.screenshot({ path: `${OUT}/02-書き出し.png` });

const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '書き出す' }).click();
const file = `${OUT}/basket.pdf`;
await (await dl).saveAs(file);
const doc = await PDFDocument.load(await readFile(file));
const { width, height } = doc.getPage(0).getSize();
const mm = [width * MM, height * MM].map(Math.round).sort((a, b) => a - b);
check(mm[0] === 297 && mm[1] === 420, `A3で出る（${mm[1]}×${mm[0]}mm）`);
console.log(`  ${doc.getPageCount()}ページ`);

await browser.close();
if (bad) process.exitCode = 1;
