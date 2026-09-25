// A book: its contents as pages, in the order they are turned.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/bookcheck.mjs [outDir]
//
// A planner is a stack of pages. People who own one think 1ページ, 2ページ,
// and a spread is what two facing pages make -- they never think about which
// side of which sheet of paper a page is printed on. This app grew the other
// way round, out of the printing, and every "わかりにくい" traced back to
// that: 面, 表, 裏, 使わない面 are a printer's words.
//
// So the contents screen is a page panel: page 1 alone on the right, then
// 2-3, 4-5, an empty page drawn where the book has one, and the sections
// above as the things those pages came from. What this checks is that the
// pages, the sections and the paper all say the same thing -- and in
// particular that a cover put on page 1 of a spread book costs no paper,
// because the spread was leaving that page empty anyway.
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
const names = async () => (await page.locator('.sections .secname').allTextContents()).map(t => t.trim());
const paper = () => flat('.fill-note');
const leaves = () => page.locator('.contents-list .leaf');
const shut = async () => {
  await page.locator('.sheet button[aria-label=閉じる]').first().click().catch(() => {});
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(200);
};
const toContents = async () => {
  await page.locator('.tocontents').click();
  await page.locator('.contents-list').waitFor();
  await page.waitForTimeout(400);
};
async function start(sizeText, form, part) {
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: sizeText }).click();
  await page.locator('.card', { hasText: form }).first().click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await drag(
    await centerOf(page.locator('.stamp', { hasText: part })),
    await centerOf(page.locator('.page').first()),
  );
}

// ---- a book of spreads: the pages it comes to ---------------------------
await start('80×128mm', '見開き', 'マンスリー');
await toContents();
check((await names()).join(' / ') === 'マンスリー', `作ったものが中身の1つ目になる（${(await names()).join(' / ')}）`);
const pages = await leaves().count();
check(pages === 26, `12ヶ月の見開きは26ページ（${pages}ページ）`);
check(
  (await flat('h1')).includes(`全${pages}ページ`),
  `ページ数が出ている（${await flat('h1')}）`,
);
// Page 1 is alone on the right: a spread's left page is an even page number.
const firstRow = page.locator('.spread').first();
check(
  await firstRow.locator('.leaf').count() === 1,
  `1ページ目は単独で右に来る（1行目に${await firstRow.locator('.leaf').count()}ページ）`,
);
check(
  await page.locator('.leaf.empty').count() === 2,
  `空きページは前と後ろの2つ（${await page.locator('.leaf.empty').count()}つ）`,
);
check(
  (await paper()).includes('13枚'),
  `紙はページの半分（${await paper()}）`,
);
await page.screenshot({ path: `${OUT}/20-ページパネル.png` });

// ---- the cover goes on page 1, and costs no paper -----------------------
await page.locator('.leaf.empty').first().click();
await page.locator('.modal').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/21-空きページを押す.png` });
await page.locator('.addcover').click();
await page.waitForTimeout(500);
check(
  await page.locator('.hitbox.part').count() === 0,
  '表紙は白紙のページ（写真と決めつけない）',
);
await shut();
await toContents();
check((await names())[0] === '表紙', `押したページに入る（${(await names()).join(' / ')}）`);
check(
  await leaves().count() === pages && await page.locator('.leaf.empty').count() === 1,
  `ページ数は変わらず、空きが1つ減る（${await leaves().count()}ページ・空き${await page.locator('.leaf.empty').count()}）`,
);
check(
  (await paper()).includes('13枚'),
  `表紙を入れても紙は増えない（${await paper()}）`,
);
await page.screenshot({ path: `${OUT}/22-表紙が1ページ目.png` });

// ---- a section's own settings, from its chip ----------------------------
await page.locator('.sections .section').nth(1).click();
await page.locator('.modal').waitFor();
await page.waitForTimeout(200);
check((await flat('.modal .secspan')).includes('12ヶ月'), `チップから期間が読める（${await flat('.modal .secspan')}）`);
check(await page.locator('.modal .torange').count() === 1, '日付のあるものは期間を変えられる');
await page.locator('.modal button[aria-label=閉じる]').click();
await page.waitForTimeout(200);

// ---- a note section: how many sheets of it ------------------------------
await page.locator('.sections .addsection').click();
await page.locator('.modal').waitFor();
await page.locator('.fillers button', { hasText: '方眼' }).click();
await page.waitForTimeout(400);
check((await names()).includes('方眼'), `足したものが中身に入る（${(await names()).join(' / ')}）`);
const wasPages = await leaves().count();
await page.locator('.sections .section', { hasText: '方眼' }).click();
await page.locator('.modal').waitFor();
await page.locator('.modal .pages button[aria-label=増やす]').click();
await page.locator('.modal .pages button[aria-label=増やす]').click();
await page.waitForTimeout(300);
check(
  (await flat('.modal .pages')).includes('3ページ'),
  `枚数をその場で変えられる（${await flat('.modal .pages')}）`,
);
await page.locator('.modal button[aria-label=閉じる]').click();
await page.waitForTimeout(300);
check(
  await leaves().count() > wasPages,
  `枚数を増やすとページが増える（${wasPages} → ${await leaves().count()}ページ）`,
);
await page.screenshot({ path: `${OUT}/23-方眼を3枚.png` });

// ---- order and removal --------------------------------------------------
await page.locator('.sections .section', { hasText: '方眼' }).click();
await page.locator('.modal').waitFor();
await page.locator('.modal button', { hasText: '前へ' }).click();
await page.waitForTimeout(300);
check((await names())[1] === '方眼', `並べ替えられる（${(await names()).join(' / ')}）`);
await page.locator('.modal .dropsec').click();
await page.locator('.confirm').waitFor();
check((await flat('.confirm')).includes('外しますか'), '外すときは確認する');
await page.locator('.confirm').getByRole('button', { name: '外す' }).click();
await page.waitForTimeout(300);
check(!(await names()).includes('方眼'), `外れる（${(await names()).join(' / ')}）`);

// ---- what comes out -----------------------------------------------------
await page.locator('.leaf').nth(2).click();
await page.locator('.page').first().waitFor();
await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview').waitFor();
await page.waitForTimeout(400);
const summary = await flat('.print-summary');
check(summary.includes('リフィル'), `刷り上がりが束ぶん出ている（${summary}）`);
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '書き出す' }).click();
const file = `${OUT}/book.pdf`;
await (await dl).saveAs(file);
const doc = await PDFDocument.load(await readFile(file));
const { width, height } = doc.getPage(0).getSize();
const mm = [width * MM, height * MM].map(Math.round).sort((a, b) => a - b);
check(mm[0] === 210 && mm[1] === 297, `A4で出る（${mm[1]}×${mm[0]}mm）`);
console.log(`  ${doc.getPageCount()}ページ`);
await shut();

// ---- saving keeps the book whole ---------------------------------------
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.locator('.savename').waitFor();
const suggested = await page.locator('.savename').inputValue();
check(
  suggested.includes('表紙') && suggested.includes('マンスリー'),
  `名前は中身からできている（「${suggested}」）`,
);
await page.getByRole('button', { name: '保存する' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '読み込み' }).click();
await page.locator('.sheet li').first().waitFor();
check(
  (await flat('.sheet li')).includes('表紙 → マンスリー'),
  '保存した束は中身の並びごと出る',
);
await page.screenshot({ path: `${OUT}/24-保存した束.png` });

// ---- single pages: no empty page anywhere ------------------------------
await start('80×128mm', '片面', 'マンスリー');
await toContents();
check(
  await page.locator('.leaf.empty').count() === 0,
  `片面の束には空きページが出ない（${await page.locator('.leaf.empty').count()}）`,
);
check(
  await leaves().count() === 12,
  `12ヶ月は12ページ（${await leaves().count()}ページ）`,
);
await page.screenshot({ path: `${OUT}/25-片面のページ.png` });

// ---- the book, turned, in the editor ------------------------------------
// A planner is something you flip through, so the page being edited has the
// next one to its right and a ＋ where a page can go before it. That ＋ is
// how a cover is reached without knowing the contents screen exists: five
// presses from opening the app, all of them on the paper.
await start('80×128mm', '見開き', 'マンスリー');
const pageno = () => flat('.pageno');
check((await pageno()).startsWith('2–3'), `いま何ページ目かが紙の下に出る（${await pageno()}）`);
check(
  await page.locator('.turn-left .addbefore').count() === 1
    && await page.locator('.turn-right .nextpage').count() === 1,
  '紙の左端に＋、右端にページ送りがある',
);
check(
  (await flat('.turn-left')).includes('足す') && (await flat('.turn-right')).includes('次へ')
    && await page.locator('.addafter').count() === 0,
  `＋は左に1つだけ、右はページ送り（左「${await flat('.turn-left')}」右「${await flat('.turn-right')}」）`,
);
await page.locator('.nextpage').click();
await page.waitForTimeout(400);
check((await pageno()).startsWith('4–5'), `めくると次のページになる（${await pageno()}）`);
const month = (await page.locator('.page').first().textContent()).replace(/\s+/g, '');
check(month.includes('10'), `中身も次の月になっている（${month.slice(0, 10)}…）`);
await page.locator('.prevpage').click();
await page.waitForTimeout(400);
check((await pageno()).startsWith('2–3'), `戻れる（${await pageno()}）`);
await page.screenshot({ path: `${OUT}/30-めくる編集画面.png` });

// Pressing ＋ makes the page. No menu in between: picking a part from a
// menu and dropping the same part from the tray on this screen make the same
// section, so the menu was a screen in front of an answer that never varies.
await page.locator('.addbefore').click();
await page.waitForTimeout(500);
check(
  await page.locator('.modal').count() === 0,
  '＋は別画面を出さない（押したところにページができる）',
);
check(
  (await pageno()).startsWith('1/'),
  `左端の＋で入れたページが1ページ目になる（${await pageno()}）`,
);
check(
  await page.locator('.hitbox.part').count() === 0 && await page.locator('.page').count() === 1,
  '先頭の1ページは白紙で開く（表紙になる）',
);

// Undone from where it was said, because a page put in by one press should
// come out by one press.
check(
  (await flat('.toast')).includes('取り消す'),
  `入れた直後に取り消せる（${await flat('.toast')}）`,
);
await page.locator('.undoadd').click();
await page.waitForTimeout(400);
check(
  (await pageno()).startsWith('2\u20133'),
  `取り消すと元のページに戻る（${await pageno()}）`,
);
await toContents();
check(
  (await names()).join(' / ') === 'マンスリー',
  `取り消すと中身も元どおり（${(await names()).join(' / ')}）`,
);

// Put the cover back, to look at what one is.
await page.locator('.leaf').nth(1).click();
await page.locator('.page').first().waitFor();
await page.waitForTimeout(300);
await page.locator('.addbefore').click();
await page.waitForTimeout(500);
// A cover is a single page in a book of spreads. The paper says so, the title
// says so, and nothing that runs on dates may be laid on it -- a calendar
// there would print twelve single-sided sheets in a book that is not.
check(
  (await flat('.coverhint')).includes('表紙（1ページ）'),
  `紙を見れば表紙だと分かる（${await flat('.coverhint')}）`,
);
check(
  (await flat('header')).includes('表紙（1ページ）') && !(await flat('header')).includes('片面'),
  `見出しも表紙と言う（片面と言わない）（${(await flat('header')).slice(0, 40)}）`,
);
check(
  await page.locator('.turn-left .addbefore').count() === 0,
  '表紙の前には足せない（＋を出さない）',
);
await page.screenshot({ path: `${OUT}/33-表紙になった.png` });

// What the tray holds is what this page can take. A calendar on a one-page
// cover would print twelve single-sided sheets in a book of spreads, so it is
// not offered there -- offering it and refusing the drag afterwards is worse
// than not offering it, because turning pages should not stop.
const trayHas = async name =>
  await page.locator('.stamp', { hasText: name }).count() > 0;
check(
  !(await trayHas('マンスリー')) && !(await trayHas('バーチカル')) && !(await trayHas('ウィークリー')),
  '表紙に日付のパーツは出ていない',
);
check(
  await trayHas('写真') && await trayHas('方眼') && await trayHas('メモ'),
  '置けるものは出ている（写真・方眼・メモ）',
);
await page.screenshot({ path: `${OUT}/34-表紙のトレイ.png` });
await page.locator('.nextpage').click();
await page.waitForTimeout(400);
check(
  await trayHas('マンスリー') && await trayHas('バーチカル'),
  '中身のページには全部出ている',
);

// ---- ＋ puts in, it does not replace -------------------------------------
// Pressing ＋ on a book that is still blank used to delete the spread on
// screen: the empty section was the one `withSection` cleans away, and the
// book became a one-page cover with no 次へ and no way back to a spread.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '見開き' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
check(await page.locator('.page').count() === 2, '作った直後は見開き（2ページ）');
await page.locator('.addbefore').click();
await page.waitForTimeout(500);
check(
  await page.locator('.nextpage').count() === 1,
  '表紙を入れても行き先が残る（次へがある）',
);
await page.locator('.nextpage').click();
await page.waitForTimeout(400);
check(
  await page.locator('.page').count() === 2,
  `＋の前に見ていた見開きが残っている（${await page.locator('.page').count()}ページ）`,
);
await page.screenshot({ path: `${OUT}/36-見開きは消えない.png` });

// ---- one picture for the run, or one per sheet --------------------------
// A photo on a twelve-month run is two different wishes: a mark that belongs
// on every month, and this month's photograph. Both are real, so the slot says
// which -- and the sheet on screen is the sheet whose picture is being set.
await start('80×128mm', '片面', 'マンスリー');
await drag(
  await centerOf(page.locator('.stamp', { hasText: '写真' })),
  await centerOf(page.locator('.page').first()),
);
await page.locator('.sheet').waitFor();
await page.waitForTimeout(300);
check(
  (await flat('.photo-where')).includes('12枚ぜんぶに同じ'),
  `既定は全ページ同じ（${await flat('.photo-where')}）`,
);
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 300; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#2f6f8f'; x.fillRect(0, 0, 300, 200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
  const input = document.querySelector('.sheet input[type=file]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.locator('.photo-size').waitFor();
await page.locator('.sheet').getByRole('button', { name: 'ページごと' }).click();
await page.waitForTimeout(400);
check(
  (await flat('.photo-where')).includes('1枚目') && (await flat('.photo-where')).includes('12枚中1枚'),
  `ページごとにすると、いま見ているページの写真になる（${await flat('.photo-where')}）`,
);
await shut();
check(await page.locator('.page image').count() === 1, '1枚目には写真がある');
await page.locator('.nextpage').click();
await page.waitForTimeout(400);
check(
  await page.locator('.page image').count() === 0,
  `2枚目は空（${await flat('.pageno')}）`,
);
await page.screenshot({ path: `${OUT}/37-ページごとの写真.png` });
await page.locator('.hitbox.part').last().click();
await page.locator('.sheet').waitFor();
await page.waitForTimeout(300);
await page.locator('.sheet').getByRole('button', { name: '全ページ同じ' }).click();
await page.waitForTimeout(400);
check(
  (await flat('.photo-where')).includes('12枚ぜんぶに同じ'),
  '全ページ同じに戻せる',
);

// ---- one card per ink, numbered down the run ----------------------------
// The way people actually keep ink swatches is a name-card-sized sheet per
// bottle, numbered, with the colour painted into a drawn bottle and everything
// else in their own hand. 横長ミニ3穴 is 91×55mm, which is that card.
await start('91×55mm', '片面', 'インク見本');
check(await page.locator('.hitbox.part').count() === 1, 'インク見本が置ける');
const firstNo = (await page.locator('.page text').allTextContents()).join(',');
check(firstNo === '1', `1枚目は1番（${firstNo}）`);
await toContents();
await page.locator('.sections .section').first().click();
await page.locator('.modal').waitFor();
await page.locator('.modal .pages button[aria-label=増やす]').click();
await page.locator('.modal .pages button[aria-label=増やす]').click();
await page.waitForTimeout(300);
await page.locator('.modal button[aria-label=閉じる]').click();
await page.waitForTimeout(300);
// Three cards and, because three is odd, the back of the last sheet.
const cards = await page.locator('.contents-list .leaf:not(.empty)').count();
check(cards === 3, `枚数のぶんだけカードになる（${cards}枚）`);
// The panel says which page it is showing, so pressing the third one opens the
// third one -- it used to open the first sheet of the section whichever page
// was pressed.
await page.locator('.leaf').nth(2).click();
await page.locator('.page').first().waitFor();
await page.waitForTimeout(400);
check((await pageno()).startsWith('3/'), `押したページが開く（${await pageno()}）`);
const thirdNo = (await page.locator('.page text').allTextContents()).join(',');
check(thirdNo === '3', `3枚目は3番（${thirdNo}）`);
await page.screenshot({ path: `${OUT}/38-インク見本.png` });

// Several to a sheet, and the numbering carries on across sheets rather than
// starting over: the third sheet of a two-up run is cards five and six.
await page.locator('.hitbox.part').first().click();
await page.locator('.sheet').waitFor();
await page.waitForTimeout(300);
await page.locator('.sheet').getByRole('button', { name: '増やす' }).nth(1).click();
await page.waitForTimeout(400);
const twoUp = (await page.locator('.page text').allTextContents()).join(',');
check(twoUp === '5,6', `1ページに2枚。3枚目は5番と6番（${twoUp}）`);
await page.screenshot({ path: `${OUT}/39-1ページに2枚.png` });

await browser.close();
if (bad) process.exitCode = 1;
