// The editor on a desktop window, which no other check reaches: every scene
// in shoot.mjs is 390px wide, so the whole two-column shape -- paper on the
// left, tools on the right, settings beside the paper instead of over it --
// could break without a single check noticing.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/pccheck.mjs [outDir]
import { BASE, launch } from './browser.mjs';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? 'shots';
await mkdir(OUT, { recursive: true });

let bad = 0;
const check = (ok, line) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'NG  '} ${line}`); };

const browser = await launch();
const window0 = { w: 1440, h: 900 };
const ctx = await browser.newContext({ viewport: { width: window0.w, height: window0.h } });
const page = await ctx.newPage();

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

async function build() {
  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: '80×128mm' }).click();
  await page.locator('.card', { hasText: '見開き' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();
  await drag(await centerOf(await stamp('マンスリー')), await centerOf(page.locator('.page').first()));
  await drag(await centerOf(await stamp('バーチカル')), await centerOf(page.locator('.page').nth(1)));
}

// The pickers widen too, but only as far as four cards across: they are a
// comparison, and a comparison reads across rather than down.
await page.goto(BASE);
const cards = await page.locator('.sizerow').all();
const boxes = await Promise.all(cards.map(c => c.boundingBox()));
const across = boxes.filter(b => Math.abs(b.y - boxes[0].y) < 2).length;
check(across === 4, `よく使われる4サイズが1行に並ぶ（${across}枚）`);
check(boxes[0].width > 200, `カードは狭くならない（${Math.round(boxes[0].width)}px）`);
await page.screenshot({ path: `${OUT}/00-サイズ選択.png` });

await build();
await page.screenshot({ path: `${OUT}/01-2カラム.png` });

// The paper gets the room, and the tools stand beside it rather than under it.
const paper = await page.locator('.page').first().boundingBox();
const tools = await page.locator('aside').boundingBox();
check(
  tools.x > paper.x + paper.width,
  `道具は紙の右（紙が ${Math.round(paper.x + paper.width)}px まで・道具は ${Math.round(tools.x)}px から）`,
);
check(paper.height > 700, `紙が窓の高さを使っている（${Math.round(paper.width)}×${Math.round(paper.height)}px）`);
check(Math.round(tools.height) >= 890, `道具の列は上から下まで（${Math.round(tools.height)}px）`);

// Wrapped into a list: nothing to scroll sideways, so no arrows either.
const tray = page.locator('.stamp').first().locator('xpath=..');
const [content, frame] = await tray.evaluate(el => [el.scrollWidth, el.clientWidth]);
check(content <= frame + 1, `トレイは折り返して収まる（${content}px / ${frame}px）`);
check(await page.locator('.tray-more').count() === 0, '横スクロールの矢印は出ない');
const stampBox = await page.locator('.stamp').first().boundingBox();
check(stampBox.width > 90, `スタンプも広がる（${Math.round(stampBox.width)}px・スマホは60px）`);

// The settings open in the column. Nothing is dimmed and the paper does not
// move -- which is the whole reason they are not a bottom sheet here.
await page.locator('.hitbox.part').nth(1).click();
await page.locator('.sheet').waitFor();
const sheet = await page.locator('.sheet').boundingBox();
const after = await page.locator('.page').first().boundingBox();
check(sheet.x >= tools.x - 1, `設定は右の列に出る（x=${Math.round(sheet.x)}）`);
check(await page.locator('.scrim').count() === 0, '紙は暗くならない');
check(Math.abs(after.width - paper.width) < 1, '設定を開いても紙の大きさは変わらない');
await page.screenshot({ path: `${OUT}/02-設定は横に.png` });

// The settings must not be squeezed into the bottom of the column. Thirteen
// stamps took the whole of it, and the photo settings opened with the button
// that chooses a picture below the fold -- which reads as "I cannot insert a
// photo", because that is what it is.
const trayBox = await page.locator('.stamp').first().evaluate(el => {
  const b = el.parentElement.getBoundingClientRect();
  return { h: b.height };
});
check(trayBox.h <= window0.h * 0.42, `設定を開くとトレイは譲る（${Math.round(trayBox.h)}px / 窓 ${window0.h}px）`);
const firstControl = await page.locator('.sheet button').first().boundingBox();
check(
  firstControl.y + firstControl.height <= window0.h,
  `設定の最初のボタンが画面に入っている（下端 ${Math.round(firstControl.y + firstControl.height)}px）`,
);

// Hover says what a control is before it is pressed. Tailwind puts these
// behind `@media (hover:hover)`, so they never reach a finger.
// Dragged once first: until someone has, the handle wears the accent by
// itself to ask to be dragged, and a highlight that is already on says
// nothing about hover.
const knobColor = () => page.locator('.divider').first().locator('b')
  .evaluate(el => getComputedStyle(el).borderTopColor);
const grip = await centerOf(page.locator('.divider').first());
await drag(grip, { x: grip.x, y: grip.y - 40 });
await page.mouse.move(20, 400);
const before = await knobColor();
await page.locator('.divider').first().hover();
const hovered = await knobColor();
check(before !== hovered, `つまみはカーソルに答える（${before} → ${hovered}）`);
check(
  await page.locator('.hitbox.part').first().evaluate(el => getComputedStyle(el).cursor) === 'grab',
  'パーツの上では掴むカーソル',
);

// One sheet, one scale. The picker draws the size it was given as big as the
// window allows, and the card at the top of that screen was drawing the same
// sheet at the small scale of the screen before -- on a wide window, where the
// cards get the most room, A5スリム up there read as a thinner paper than the
// one being chosen.
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '110×210mm' }).click();
await page.locator('.card').first().waitFor();
await page.waitForTimeout(300);
const shown = await page.locator('.sizenow svg').boundingBox();
const single = await page.locator('.card', { hasText: '片面' }).locator('.ruler svg').boundingBox();
check(
  Math.abs(shown.width - single.width) < 2,
  `選んだサイズは、選ばせる絵と同じ縮尺（${Math.round(shown.width)}px / ${Math.round(single.width)}px）`,
);
await page.screenshot({ path: `${OUT}/04-構成の画面.png` });

// Narrow again: the phone shape is the one everything else is checked in, so
// it has to survive the desktop one.
await page.setViewportSize({ width: 390, height: 844 });
await build();
const narrowTools = await page.locator('aside').boundingBox();
const narrowPaper = await page.locator('.page').first().boundingBox();
check(narrowTools.y > narrowPaper.y + narrowPaper.height, '狭い窓では道具は紙の下');
await page.locator('.hitbox.part').nth(1).click();
await page.locator('.sheet').waitFor();
check(await page.locator('.scrim').count() === 1, '狭い窓の設定は下からせり上がる');
await page.screenshot({ path: `${OUT}/03-狭い窓.png` });

await browser.close();
if (bad) process.exitCode = 1;
