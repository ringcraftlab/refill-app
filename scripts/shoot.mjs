// Drives the real app on a phone-sized viewport and screenshots each step, so
// layout changes are judged by looking at them rather than by reading CSS.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/shoot.mjs [outDir]
//
// CHROMIUM_PATH overrides the browser binary when the bundled one is missing.
import { BASE, launch } from './browser.mjs';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? 'shots';
await mkdir(OUT, { recursive: true });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

const centerOf = async (locator) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// Finger drag: press, move in steps, release. The app listens to pointer
// events, so this is the same path a real touch takes.
async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

// The tray scrolls, so a stamp has to be brought into view before it can be
// picked up.
const stamp = async (label) => {
  const el = page.locator('.stamp', { hasText: label });
  await el.scrollIntoViewIfNeeded();
  return el;
};

await page.goto(BASE);
await shot('01-サイズ選択');

// baseline.sh runs this against an older build as well as the current one,
// so a card is picked by its millimetres, not by its name: renaming a size
// would otherwise make every comparison with a past commit fail to start.
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await shot('02-ページ構成');

await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await shot('03-空のキャンバス');

const leftPage = page.locator('.page').first();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(leftPage));
await shot('04-マンスリーを配置');

// Drop the memo onto the lower part of the same page.
const lp = await leftPage.boundingBox();
await drag(await centerOf(await stamp('メモ')), { x: lp.x + lp.width / 2, y: lp.y + lp.height * 0.85 });
await shot('05-メモを追加');

// The app's reason for existing: the memo area is too small, so drag the
// shared border up and it grows while the calendar gives way.
const divider = page.locator('.divider.h').first();
const d = await centerOf(divider);
await drag(d, { x: d.x, y: d.y - 90 });
await shot('06-メモを広げた');

// Dropping onto one side instead divides the spread at the gutter, so the two
// pages carry different parts.
const rightPage = page.locator('.page').last();
const rp = await rightPage.boundingBox();
await drag(await centerOf(await stamp('方眼')), { x: rp.x + rp.width * 0.7, y: rp.y + rp.height * 0.8 });
await shot('07-右に方眼を落とす');

// A fresh spread: the habit tracker needs width for its 31 day columns, so it
// should take a band across the whole spread rather than half a page.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
const left2 = page.locator('.page').first();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(left2));
const lp2 = await left2.boundingBox();
await drag(await centerOf(await stamp('ハビット')), { x: lp2.x + lp2.width * 0.5, y: lp2.y + lp2.height * 0.85 });
await shot('08-ハビットは横長で配置');

// A to-do list stacks items, so it needs height; with only the habit band's
// leftover it should be refused rather than squeezed in.
await drag(await centerOf(await stamp('TODO')), { x: lp2.x + lp2.width * 0.3, y: lp2.y + lp2.height * 0.85 });
await shot('09-TODOを足す');

// Splitting the spread by week turns both pages landscape and stacks them,
// with the fuller page first and the shorter page's leftover free to write in.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
const left3 = page.locator('.page').first();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(left3));
// Turning belongs to the refill, so it is one button on the sheet area.
await page.getByRole('button', { name: 'リフィルを回転' }).click();
await shot('10-横向きの週分割');

// Parts share the calendar's page while they are there; take them away and
// the calendar has to take the whole page back.
// Stacked pages: the writable leftover is on the second one.
const bottom3 = await page.locator('.page').last().boundingBox();
await drag(await centerOf(await stamp('メモ')), { x: bottom3.x + bottom3.width * 0.5, y: bottom3.y + bottom3.height * 0.85 });
await drag(await centerOf(await stamp('TODO')), { x: bottom3.x + bottom3.width * 0.2, y: bottom3.y + bottom3.height * 0.85 });
await shot('11-横向きにメモとTODO');

for (let i = 0; i < 2; i++) {
  await page.locator('.part').first().click();
  await page.getByRole('button', { name: 'このパーツを外す' }).click();
  // Nothing is removed without answering the question first.
  await page.getByRole('button', { name: '外す', exact: true }).click();
}
await shot('12-2つ外してマンスリーだけ');

// The vertical weekly, which none of the scenes above reaches: it is the only
// part with two axes of its own, it splits its days across the spread, and it
// carries the hour scale. A change to it went through the twelve scenes above
// without moving a pixel, which is how this one came to be here.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '95×170mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('バーチカル')), await centerOf(page.locator('.page').first()));
await shot('13-バーチカル');

// The hours are the refill's, not the part's, so moving them redraws every
// column and the row count with it.
//
// baseline.sh replays this against an older build, which has no such setting
// at all -- a control cannot be renamed into existence the way a card can --
// so the scene shoots whatever it finds. The older build then comes out
// showing the hours it was fixed to, and the comparison says this scene moved,
// which is the truth.
await page.locator('.range').click();
const hourStep = (label, glyph) =>
  page.locator('.field-label', { hasText: label }).locator('xpath=..').locator('button', { hasText: glyph });
if (await page.locator('.field-label', { hasText: '始まりの時刻' }).count()) {
  for (let i = 0; i < 2; i++) await hourStep('始まりの時刻', '＋').click();
  for (let i = 0; i < 4; i++) await hourStep('終わりの時刻', '−').click();
}
await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
await page.locator('.scrim').waitFor({ state: 'detached' });
await shot('14-バーチカルを8時から20時に');

// The month drawn as a part rather than as the spread's band, and the day
// list, which no scene above reaches either -- they are a different function
// from `drawSpanningMonthly`, and a change to the label they share went
// through every scene above without moving a pixel.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '95×170mm' }).click();
await page.locator('.card', { hasText: '片面' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
const only = page.locator('.page').first();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(only));
const op = await only.boundingBox();
await drag(await centerOf(await stamp('日付リスト')), { x: op.x + op.width * 0.5, y: op.y + op.height * 0.85 });
await shot('15-片面にマンスリーと日付リスト');

// The vertical folded into two bands, each carrying its own hour scale.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '95×170mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('バーチカル')), await centerOf(page.locator('.page').first()));
await page.locator('.range').click();
// Older builds have one band and no such choice; the scene shoots what it finds.
const tier2 = page.getByRole('button', { name: '2段', exact: true });
if (await tier2.count()) await tier2.click();
await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
await page.locator('.scrim').waitFor({ state: 'detached' });
await shot('16-バーチカルを2段に');

// Dropped against the outer edge of a spread: that page alone, the facing one
// blank. Folded into two bands as well, which is the shape the request came
// in as -- a week on one page you can actually write in.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '95×170mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
const edgeL = await page.locator('.page').first().boundingBox();
await drag(
  await centerOf(await stamp('バーチカル')),
  { x: edgeL.x + edgeL.width * 0.08, y: edgeL.y + edgeL.height * 0.5 },
);
await page.locator('.range').click();
const edgeTier = page.getByRole('button', { name: '2段', exact: true });
if (await edgeTier.count()) await edgeTier.click();
await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
await page.locator('.scrim').waitFor({ state: 'detached' });
await shot('17-左端に落として片ページ2段');

// Started from today rather than from the top of a month. Every scene here
// already moves with the calendar -- a new layout takes the current month --
// and baseline shoots both builds in the same minute, so this is no less
// comparable than the rest.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '95×170mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('バーチカル')), await centerOf(page.locator('.page').first()));
await page.locator('.range').click();
const fromToday = page.getByRole('button', { name: '今日から' });
if (await fromToday.count()) await fromToday.click();
await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
await page.locator('.scrim').waitFor({ state: 'detached' });
await shot('18-バーチカルを今日から');

// The fold. One sheet that bends: the panels are marked by creases, not cut
// apart, only the first is punched, and the rest are narrower by what the
// rings take up. The card is looked for rather than assumed, so baseline can
// still replay this script against a build from before folding existed.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '62×105mm' }).click();
const foldCard = page.locator('.card', { hasText: '蛇腹3面' });
if (await foldCard.count()) {
  await foldCard.click();
  await shot('19-蛇腹を選ぶ');
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();

  // One calendar over the whole strip: a fold-out month, which is the thing a
  // spread does across its two pages. Then a memo dropped low, which is the
  // gesture that puts something under what is already there rather than
  // breaking another panel off.
  const strip = await page.locator('.page').first().boundingBox();
  await drag(await centerOf(await stamp('マンスリー')),
    { x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 });
  await shot('20-蛇腹の全面にマンスリー');
  await drag(await centerOf(await stamp('メモ')),
    { x: strip.x + strip.width / 2, y: strip.y + strip.height * 0.88 });
  console.log('全面の仕切り:', await page.locator('.divider').count());
  await shot('21-全面に重ねる');

  // Then one per panel, which is the other thing a fold is for.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '62×105mm' }).click();
  await page.locator('.card', { hasText: '蛇腹3面' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  const s3 = await page.locator('.page').first().boundingBox();
  for (const at of [0.17, 0.5, 0.84]) {
    await drag(await centerOf(await stamp('マンスリー')),
      { x: s3.x + s3.width * at, y: s3.y + s3.height / 2 });
  }
  await shot('22-蛇腹3面に3ヶ月');

  // Selected in the tray, then placed by tapping the paper -- the path that
  // does not depend on the browser letting go of the gesture.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '62×105mm' }).click();
  await page.locator('.card', { hasText: '蛇腹2面' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await (await stamp('マンスリー')).click();
  const s2 = await page.locator('.page').first().boundingBox();
  await page.mouse.click(s2.x + s2.width * 0.25, s2.y + s2.height / 2);
  await page.waitForTimeout(150);
  await shot('23-タップで置く');
  await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
  await page.locator('.duplex-note').waitFor();
  console.log('duplex says:', await page.locator('.duplex-note').textContent());
  await shot('24-蛇腹2面の書き出し');

  // Turned a quarter turn: the panels hang from the rings instead of running
  // out sideways. Same strip of paper, same punch -- only the content turns.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '62×105mm' }).click();
  await page.locator('.card', { hasText: '蛇腹3面' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await page.locator('.rotate').click();
  const turned = await page.locator('.page').first().boundingBox();
  await drag(await centerOf(await stamp('マンスリー')),
    { x: turned.x + turned.width / 2, y: turned.y + turned.height / 2 });
  await drag(await centerOf(await stamp('方眼')),
    { x: turned.x + turned.width * 0.4, y: turned.y + turned.height * 0.9 });
  await shot('25-蛇腹を横にする');

  // The drawing on its own, bigger than the paper really is. A tap on the
  // paper is already taken by placing and by settings, so this is a button.
  await page.locator('.magnify').click();
  await page.locator('.lightbox').waitFor();
  await shot('26-大きく見る');
  await page.locator('.lightbox svg').first().click();
  await page.waitForTimeout(200);
  console.log('拡大の紙:', JSON.stringify(await page.locator('.lightbox svg').first().boundingBox()));
  await shot('27-さらに拡大');

  // The other grain. A refill wider than it is tall binds on its short edge,
  // so folding away from the rings makes a ribbon; this one folds along them
  // instead and the inner panels are cut back to clear the holes -- an L, not
  // a rectangle, which is the one shape in the app that is not one.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '91×55mm' }).click();
  // This size alone offers both directions, so the card has to be picked by
  // the one it is.
  await page.locator('.card', { hasText: 'L字3面' }).click();
  await shot('28-横長ミニ3穴の蛇腹');
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  const card = await page.locator('.page').first().boundingBox();
  await drag(await centerOf(await stamp('マンスリー')),
    { x: card.x + card.width / 2, y: card.y + card.height * 0.17 });
  await drag(await centerOf(await stamp('メモ')),
    { x: card.x + card.width / 2, y: card.y + card.height * 0.5 });
  console.log('切り落とした紙:', await page.locator('.page.notched').count());
  await shot('29-L字の帯に置く');

  // The same size the other way: folding away from the rings keeps the strip
  // a rectangle, at the cost of a 260mm ribbon. Both are offered because
  // neither is plainly right, which is true of this size alone.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '91×55mm' }).click();
  await page.locator('.card', { hasText: '蛇腹3面' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  const ribbon = await page.locator('.page').first().boundingBox();
  await drag(await centerOf(await stamp('マンスリー')),
    { x: ribbon.x + ribbon.width * 0.17, y: ribbon.y + ribbon.height / 2 });
  await drag(await centerOf(await stamp('メモ')),
    { x: ribbon.x + ribbon.width * 0.5, y: ribbon.y + ribbon.height / 2 });
  console.log('長方形の帯の切り落とし:', await page.locator('.page.notched').count());
  await shot('30-同じサイズを横に伸ばす');
}

// The ground the sheet prints on. Under everything including the ring margin,
// because a background that stopped at the content would read as a panel laid
// on the paper rather than as the paper.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
const bgChip = page.locator('button', { hasText: '背景なし' });
if (await bgChip.count()) {
  await bgChip.click();
  await shot('31-背景の設定');
  await page.locator('.sheet').getByRole('button', { name: '方眼', exact: true }).click();
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await shot('32-方眼の地紋');
}

// A picture placed as a stamp. The file is made in the page rather than kept
// as a fixture: what matters is that a photo lands in the slot it was dropped
// in and stays inside it, not which photo it was.
async function openPhotoSheet() {
  await page.waitForTimeout(250);
  if (!(await page.locator('.sheet').count())) {
    await page.locator('.hitbox.part[title="写真"]').first().click();
  }
  await page.locator('.sheet').waitFor();
}

async function feedPhoto() {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#2f6f8f'; x.fillRect(0, 0, 900, 600);
    x.fillStyle = '#e8b14a'; x.fillRect(0, 0, 450, 300);
    x.fillStyle = '#b5495b'; x.fillRect(450, 300, 450, 300);
    x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif';
    x.fillText('PHOTO', 120, 340);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
    const input = document.querySelector('.sheet input[type=file]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.photo-size').waitFor();
}

await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
const photoStamp = page.locator('.stamp', { hasText: '写真' });
if (await photoStamp.count()) {
  await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
  await drag(await centerOf(await stamp('写真')), await centerOf(page.locator('.page').nth(1)));
  // Placing one opens its settings by itself: the slot does nothing until a
  // picture is in it, so the place to choose one comes to you. baseline
  // replays this against older builds that did not, so the scene opens it by
  // hand when it did not open on its own.
  await openPhotoSheet();
  await shot('33-写真を置くと選ぶところが開く');
  await feedPhoto();
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await shot('34-写真が入る');

  // The same picture across the gutter: one box cut by the fold of the
  // spread, which each sheet has to carry its half of at the same scale.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '80×128mm' }).click();
  await page.locator('.card', { hasText: '見開き' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await drag(await centerOf(await stamp('写真')), await centerOf(page.locator('.page').first()));
  await openPhotoSheet();
  await feedPhoto();
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await shot('35-見開き全面の写真');
}

// The refill's own get-up: the words it prints and the ink it prints them in.
// One decision for the whole refill, so it sits in a chip above the paper
// rather than in every part's settings.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '見開き' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
await drag(await centerOf(await stamp('メモ')), await centerOf(page.locator('.page').nth(1)));
const lookChip = page.locator('.look');
if (await lookChip.count()) {
  await lookChip.click();
  await shot('36-体裁');
  await page.locator('.sheet').getByRole('button', { name: '9月 月', exact: true }).click();
  await page.locator('.tones').getByRole('button', { name: '藍' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'こい', exact: true }).click();
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await shot('37-和文の藍で刷る');
}

// Last month and next month in the cells the month left empty. The space is
// dead otherwise, and a monthly on its own page had nowhere else for them.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '80×128mm' }).click();
await page.locator('.card', { hasText: '片面' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
await shot('38-前後の月の小さなカレンダー');
await page.locator('.hitbox.part').first().click();
await page.locator('.sheet').waitFor();
const miniChoice = page.locator('.sheet').getByText('前後の月の小さなカレンダー');
if (await miniChoice.count()) {
  await page.locator('.sheet').getByRole('button', { name: '入れない', exact: true }).click();
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } });
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await shot('39-小さなカレンダーを外す');
}

// Two calendars on one spread are two months. The band is not a part -- it is
// the spread's own monthly -- so a monthly dropped under it used to count
// itself as the first calendar on the sheet and print September twice.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '148×210mm' }).click();
await page.locator('.card', { hasText: '見開き' }).first().click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();
{
  const paper = await page.locator('.page').first().boundingBox();
  await drag(await centerOf(await stamp('マンスリー')),
    { x: paper.x + paper.width / 2, y: paper.y + paper.height * 0.3 });
  await drag(await centerOf(await stamp('マンスリー')),
    { x: paper.x + paper.width / 2, y: paper.y + paper.height * 0.85 });
  const months = await page.locator('.page svg text').evaluateAll(
    els => els.map(e => e.textContent).filter(t => /^(9|10|11)$/.test(t)),
  );
  console.log('帯と下のマンスリーの月:', JSON.stringify(months));
  await shot('40-帯の下にもう1ヶ月');
}

await browser.close();
