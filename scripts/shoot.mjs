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

// The fold. Panels are not pages: only the first is punched, the rest are
// narrower by what the rings take up, and a part cannot cross a crease. The
// card is looked for rather than assumed, so baseline can still replay this
// script against a build from before folding existed.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '62×105mm' }).click();
const foldCard = page.locator('.card', { hasText: '蛇腹' });
if (await foldCard.count()) {
  await foldCard.click();
  await page.getByRole('button', { name: '3面', exact: true }).click();
  await shot('19-蛇腹を選ぶ');
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  const panels = page.locator('.page');
  for (let i = 0; i < 3; i++) {
    await drag(await centerOf(await stamp('マンスリー')), await centerOf(panels.nth(i)));
  }
  await shot('20-蛇腹3面に3ヶ月');

  // Two panels instead of three: the inner one gets wider, and the strip is
  // short enough that the paper turns and the duplex setting changes with it.
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '62×105mm' }).click();
  await page.locator('.card', { hasText: '蛇腹' }).click();
  await page.getByRole('button', { name: '2面', exact: true }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
  await drag(await centerOf(await stamp('メモ')), await centerOf(page.locator('.page').last()));
  await page.getByRole('button', { name: 'PDF出力プレビュー' }).click();
  await page.locator('.duplex-note').waitFor();
  console.log('duplex says:', await page.locator('.duplex-note').textContent());
  await shot('21-蛇腹2面の書き出し');
}

await browser.close();
