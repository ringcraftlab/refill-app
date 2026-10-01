// Walks the app's doors and asks one question at every one of them:
//
//   開いた場所へ帰れるか。
//
// The spec (5章「戻る構造」) says a screen remembers where it was opened from
// and goes back there when it closes. Nothing else in scripts/ ever presses
// back: of the forty-odd scenes the other checks walk, one goes backwards.
// That is why the app could grow a dead end -- a form you can choose but not
// un-choose -- and still report 8/8.
//
// It exits 1 on any mismatch. It found three the day it was written -- a form
// you could choose but not un-choose, a contents that came out at the form
// picker however you had reached it, and an editor entered from the contents
// with no way back to it -- and runs with the rest of the checks now that
// those are gone.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/navcheck.mjs
import { BASE, launch } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

let bad = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'NG  ', what); if (!ok) bad++; };

// Which screen is on. Order matters: the contents draws thumbnails, not pages;
// the editor is the only one with a tray.
const where = async () => {
  if (await page.locator('.bookview').count()) return '手帳';
  if (await page.locator('.contents-list').count()) return '一覧';
  if (await page.locator('.stamp').count()) return '編集';
  if (await page.locator('.card').count()) return '構成';
  if (await page.locator('.sizerow').count()) return 'サイズ';
  return '（不明）';
};
const settle = () => page.waitForTimeout(350);
// On a phone the paper's settings are behind the sheet's 「この紙」 tab, and
// the parts behind 「パーツ」. A wide screen shows both and has no tabs.
const dockTab = async (name) => { const t = page.getByRole('tab', { name }); if (await t.count()) await t.click(); };

const start = async () => {
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '95×170mm' }).click(); if (await page.locator('.sizego').count()) await page.locator('.sizego').click();
  await page.locator('.card').first().waitFor();
};

// ---- 1. サイズ → 構成 -----------------------------------------------------
await start();
check(await where() === '構成', 'サイズを選ぶと構成へ進む');
await page.locator('button', { hasText: 'サイズを選び直す' }).first().click();
await settle();
check(await where() === 'サイズ', `構成から戻ると、開いた場所（サイズ）へ帰る（いま ${await where()}）`);

// ---- 2. 構成 → 編集 -------------------------------------------------------
await page.locator('.sizerow', { hasText: '95×170mm' }).click(); if (await page.locator('.sizego').count()) await page.locator('.sizego').click();
await page.locator('.card', { hasText: '見開き' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
check(await where() === '編集', '構成から編集へ進む');

// 編集から構成へ帰る道があるか。仕様では「来た場所へ帰る」なので、
// 構成から来た直後は構成へ帰れなければならない。
const backToForm = await page.locator('.toform').count();
check(backToForm > 0, `編集から構成へ帰る道がある（いま ${backToForm} 個）`);

// ---- 3. 編集 → 一覧 → 帰る ------------------------------------------------
await page.locator('.pageno').click();
await settle();
check(await where() === '一覧', '編集から一覧へ入れる');
await page.locator('button[aria-label="戻る"]').first().click();
await settle();
check(
  await where() === '編集',
  `一覧を閉じると、開いた場所（編集）へ帰る（いま ${await where()}）`,
);

// ---- 4. ページ番号から一覧、押したページの編集へ --------------------------
await start();
await page.locator('.card', { hasText: '見開き' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
const monthly = page.locator('.stamp', { hasText: 'マンスリー' });
await monthly.scrollIntoViewIfNeeded();
const box = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const from = await box(monthly), onto = await box(page.locator('.page').first());
await page.mouse.move(from.x, from.y); await page.mouse.down();
await page.mouse.move(onto.x, onto.y, { steps: 10 }); await page.mouse.up();
await settle();
await page.locator('.pageno').click();
await settle();
check(await where() === '一覧', 'ページ番号から一覧へ入れる');
await page.locator('.leaf.here').first().click();
await page.locator('.page').first().waitFor();
check(await where() === '編集', '一覧でページを押すと、そのページの編集へ');
const backToList = await page.locator('.tolist').count();
check(backToList > 0, `一覧から入った編集に、一覧へ帰る道がある（いま ${backToList} 個）`);

// ---- 5. 紙の上のチップ：開いて閉じたら編集 --------------------------------
for (const [name, sel] of [
  ['リフィル（サイズと形）', '.papernow'], ['期間', '.range'], ['用紙', '.paper'],
  ['背景', 'button:has-text("背景")'], ['体裁', '.look'],
]) {
  // The paper the whole book comes to is the book's, under 「1冊」 on a phone.
  if (sel === '.paper' && await page.locator('.bookmenu').count()) await page.locator('.bookmenu').click();
  else if (sel !== '.papernow') await dockTab('設定');
  await page.locator(sel).first().click();
  await settle();
  const opened = await page.locator('.scrim, .sheet').count() > 0;
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.scrim').click({ position: { x: 6, y: 6 } }).catch(() => {});
  await settle();
  check(opened && await where() === '編集', `${name}のシートは閉じると編集へ帰る`);
}

// ---- 6. 刷り上がりと拡大 --------------------------------------------------
await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
await page.locator('.preview svg').first().waitFor();
await page.locator('.scrim').click({ position: { x: 6, y: 6 } }).catch(() => {});
await settle();
check(await where() === '編集', '刷り上がりを閉じると編集へ帰る');
await page.getByRole('button', { name: '大きく見る' }).click();
await page.waitForTimeout(400);
await page.locator('button[aria-label="閉じる"]').first().click().catch(() => {});
await settle();
check(await where() === '編集', '拡大を閉じると編集へ帰る');

// ---- 7. めくって見る：閉じても、ページを押しても帰れるか ------------------
// 見る道は2つあり、どちらも編集から入って編集へ帰る。📖はそのうえで
// 「ページを押す→そのページの編集→閉じると📖のそのページ」という
// 往復を持つので、往路と復路の両方をここで踏む。
await page.locator('.toflip').click();
await settle();
check(await where() === '手帳', `編集からめくって見るへ入れる（いま ${await where()}）`);
await page.locator('.bookclose').click();
await settle();
check(await where() === '編集', `めくって見るを閉じると編集へ帰る（いま ${await where()}）`);

await page.locator('.toflip').click();
await settle();
const wasOn = await page.locator('.bookno').innerText();
await page.locator('.bookpage').first().click();
await page.locator('.page').first().waitFor();
check(await where() === '編集', 'めくって見るでページを押すと、そのページの編集へ');
const backToBook = await page.locator('.tobook').count();
check(backToBook > 0, `めくって見るから入った編集に、帰る道がある（いま ${backToBook} 個）`);
await page.locator('.tobook').click();
await settle();
check(await where() === '手帳', `その編集を閉じると、めくって見るへ帰る（いま ${await where()}）`);
check(
  (await page.locator('.bookno').innerText()) === wasOn,
  `帰った先は、見ていたページのまま（${wasOn} → ${await page.locator('.bookno').innerText()}）`,
);
await page.locator('.bookclose').click();
await settle();

console.log(`\n${bad === 0 ? '行き止まりなし' : `仕様（5章 戻る構造）と食い違うところ ${bad} か所`}`);
await browser.close();
if (bad) process.exitCode = 1;
