// 📖 めくって見る。The one screen whose whole job is that the book behaves like
// a book: it opens where you were, the pages turn one leaf at a time, the
// rings hold both halves of the spread, and pressing a page is how you get to
// work on it. And what it must never do -- say a word about paper, imposition
// or sides. That belongs to 刷る, and mentioning it here is the difference
// between "how will this look in my binder" and "how will this come out of my
// printer" (仕様 5章).
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/flipcheck.mjs [outDir]
import { BASE, launch } from './browser.mjs';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? 'shots/flip';
await mkdir(OUT, { recursive: true });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

let bad = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'NG  ', what); if (!ok) bad++; };
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled' }); };
const settle = () => page.waitForTimeout(400);
const centre = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// The number in the corner, without the total: 「2–3」.
const on = async () => (await page.locator('.bookno').innerText()).split('/')[0].trim();

const drop = async (label, target) => {
  const stamp = page.locator('.stamp', { hasText: label });
  await stamp.scrollIntoViewIfNeeded();
  const from = await centre(stamp);
  const to = await centre(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
};

// A book worth turning: a year of monthlies on spreads.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click(); await page.locator('.sizego').click({ timeout: 1500 }).catch(() => {});
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drop('マンスリー', page.locator('.page').first());
await settle();

// ---- 入口と、開く位置 ------------------------------------------------------
const editorOn = (await page.locator('.pageno').innerText()).split('/')[0].trim();
await page.locator('.toflip').click();
await page.locator('.bookview').waitFor();
await settle();
await shot('01-開く');
check(await on() === editorOn, `編集で見ていたページから開く（編集 ${editorOn} → 手帳 ${await on()}）`);
check(await page.locator('.bookpage').count() === 2, '見開きは2ページとも出る');

// リングは束の片側ではなく、見開きの真ん中に並ぶ。両ページを同じ綴じ具が
// 持っている、という絵がこの画面の要。
const rings = await page.locator('.bookview span[aria-hidden="true"].rounded-full').count();
check(rings >= 3, `リングが見開きの綴じ目に並ぶ（${rings}本）`);

// ---- 印刷の話をしない ------------------------------------------------------
const said = await page.locator('.bookview').innerText();
const forbidden = ['A4', 'A3', 'B4', '面付', '両面', '裏', '切り取り', '刷', '印刷', 'PDF'];
const slipped = forbidden.filter(w => said.includes(w));
check(slipped.length === 0, `紙の話をしない（出ていた言葉：${slipped.join('・') || 'なし'}）`);

// ---- めくる ---------------------------------------------------------------
const first = await on();
await page.locator('.booknext').click();
await settle();
const second = await on();
check(second !== first, `›で次の見開きへ（${first} → ${second}）`);
await shot('02-めくった');
await page.locator('.bookprev').click();
await settle();
check(await on() === first, `‹で戻る（${second} → ${await on()}）`);

// 指で払ってもめくれる。ボタンと同じ結果になることが要件で、
// スワイプだけに頼らないのが5章の決まり。
// Playwrightのmouse.moveは時間をかけずに動くので、ふつうの速さで払う指は
// 途中で待ってやらないと作れない -- 待たなければどんな短い距離でも
// 「速く払った」ことになり、パラパラとの境目を確かめられない。
const mid = await centre(page.locator('.bookview'));
const swipe = async (dx, ms) => {
  await page.mouse.move(mid.x - dx / 2, mid.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(mid.x - dx / 2 + (dx * i) / 6, mid.y);
    await page.waitForTimeout(ms / 6);
  }
  await page.mouse.up();
};
await swipe(-180, 300);
await settle();
check(await on() === second, `左に払うと次の見開きへ（${await on()}）`);

// 速く払えばパラパラ。1回ぶんより多く進む。
const beforeRiffle = await on();
await swipe(-220, 30);
await page.waitForTimeout(900);
const afterRiffle = await on();
const pageNo = (s) => Number(s.split('–')[0]);
check(
  pageNo(afterRiffle) - pageNo(beforeRiffle) > 2,
  `速く払うとパラパラめくれる（${beforeRiffle} → ${afterRiffle}）`,
);
await shot('03-パラパラのあと');

// ---- 最初へ ---------------------------------------------------------------
await page.locator('.bookstart').click();
await settle();
check(await on() === '1', `最初へで1ページ目（いま ${await on()}）`);
check(await page.locator('.bookprev').isDisabled(), '最初の見開きでは‹が押せない');
await shot('04-最初');

// ---- ページを押すと、そのページの編集 --------------------------------------
await page.locator('.booknext').click();
await settle();
const opened = await on();
await page.locator('.bookpage').first().click();
await page.locator('.page').first().waitFor();
const landed = (await page.locator('.pageno').innerText()).split('/')[0].trim();
check(landed === opened, `押したページの編集に入る（${opened} → ${landed}）`);
await shot('05-編集に入った');

// ---- 表紙のある束では「表紙へ」 --------------------------------------------
await page.locator('.pageno').click();
await page.locator('.contents-list').waitFor();
await page.locator('.addsection').click();
await page.locator('button', { hasText: '表紙' }).first().click();
await settle();
await page.locator('.toflip').click();
await page.locator('.bookview').waitFor();
await settle();
const startLabel = await page.locator('.bookstart').innerText();
check(startLabel.includes('表紙'), `表紙のある束では「表紙へ」（いま「${startLabel.trim()}」）`);
// 表紙を足すと編集はその表紙に立つので、📖もそこで開く。
// 立っている端のボタンは押せない（消えるのではなく暗くなる）。
check(await page.locator('.bookstart').isDisabled(), '最初の見開きでは「表紙へ」が押せない');
check(await page.locator('.bookpage').count() === 1, '表紙は相手のいない1ページ');
// 白紙のページと同じ絵にしない（4章）。まだ何も乗っていない表紙は
// ＋のある空ページと見分けがつかないので、紙に「表紙」と出る。
const coverFace = await page.locator('.bookpage').first().innerText();
check(coverFace.includes('表紙'), `中身のない表紙は紙にそう書く（いま「${coverFace.trim()}」）`);
await shot('06-表紙');

// ---- 最後へ ---------------------------------------------------------------
await page.locator('.bookend').click();
await settle();
check(await page.locator('.booknext').isDisabled(), `最後へで束の終わりに着く（いま ${await on()}）`);
check(await page.locator('.bookend').isDisabled(), '最後の見開きでは「最後へ」が押せない');
await shot('07-最後');
await page.locator('.bookstart').click();
await settle();
check(await on() === '1', `「表紙へ」で1ページ目に帰る（いま ${await on()}）`);

// ---- 空のページを押すと「中身を足す」 --------------------------------------
// 束のどこかにある白紙は、この本のページであって隙間ではない。押せば何が
// 入るかを聞く——一覧の空ページと同じ動作・同じシート。紙の話はしない。
// 最後の紙の裏は、まだ何も入っていないページ（索引やメモが入る場所）。
await page.locator('.bookend').click();
await settle();
const blanks = await page.locator('.bookblank').count();
check(blanks > 0, `最後の紙の裏が白紙のページとして出る（${blanks} ページ）`);
// 何が入るかを絵で言う。＋だけでは「何かが入る」までしか言えず、
// 入るのが1ページなのか見開きなのかが分からない。
check(
  await page.locator('.bookblank .blankmark').count() === blanks,
  '空ページには「1ページ入る」印が出る',
);
const wasPages = Number((await page.locator('.bookno').innerText()).match(/全(\d+)/)[1]);
await page.locator('.bookblank').first().click();
await page.locator('.fillers').first().waitFor();
const asked = await page.locator('.modal').first().innerText().catch(() => '');
check(asked.includes('押した1ページ'), '押した1ページに入ると言う（末尾ではなく）');
// 日付のものは何ページにもなるので、1ページぶんの場所では出さない。
check(!asked.includes('マンスリー'), '1ページの場所に日付の束は出さない');
// 表紙は先頭にしか行かないので、最後のページからは出さない。
check(!asked.includes('先頭に入ります'), '最後のページから表紙は足せない');
const paperTalk = ['A4', 'A3', 'B4', '面付', '両面'].filter(w => asked.includes(w));
check(paperTalk.length === 0, `足すシートも紙の話をしない（${paperTalk.join('・') || 'なし'}）`);
await page.locator('.fillers').first().locator('button').first().click();
await settle();
check(await page.locator('.bookview').count() > 0, '足したあとも手帳のまま（見て確かめられる）');
const nowPages = Number((await page.locator('.bookno').innerText()).match(/全(\d+)/)[1]);
check(
  nowPages === wasPages && await page.locator('.bookblank').count() === 0,
  `押した1ページが埋まって、空きは残らない（全${wasPages} → 全${nowPages}ページ）`,
);
check(await page.locator('.booknext').isDisabled(), '足したものが最後のページになる');
await shot('08-白紙に足した');

// 足したものは束の形（見開き）を継ぐ。表紙は1ページなので、表紙を
// 手本にすると片面の束が見開きの本に混ざる。
await page.locator('.bookpage').first().click();
await page.locator('.page').first().waitFor();
check(
  await page.locator('.page').count() === 1,
  `空ページから足したものは1ページの束（紙${await page.locator('.page').count()}ページ）`,
);
await page.locator('.tobook').click();
await settle();

// ---- 下に払うと閉じる ------------------------------------------------------
// ×と同じ結果。横に綴じた束は横にめくるので、下は空いている。
const shut = await centre(page.locator('.bookview'));
await page.mouse.move(shut.x, shut.y - 60);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(shut.x, shut.y - 60 + (160 * i) / 6);
  await page.waitForTimeout(40);
}
await page.mouse.up();
await settle();
check(await page.locator('.stamp').count() > 0, `下に払うと閉じて編集へ帰る（手帳 ${await page.locator('.bookview').count()} 個）`);

console.log(`\n${bad === 0 ? 'めくって見るは仕様どおり' : `仕様（5章 📖）と食い違うところ ${bad} か所`}`);
await browser.close();
if (bad) process.exitCode = 1;
