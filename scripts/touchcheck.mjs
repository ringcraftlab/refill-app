// The tray under a finger, which no other check reaches: every scene in
// shoot.mjs drives a mouse, and a mouse and a finger do not take the same
// path through this. A mouse has to be captured on pointer-down or its moves
// go to whatever is under the cursor; a finger must NOT be, or the browser
// never gets to scroll the tray. Both were broken here in turn, and neither
// break showed up in eighteen scenes.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/touchcheck.mjs
import { BASE, launch } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
});
await page.goto(BASE);
await page.locator('.sizerow', { hasText: '95×170mm' }).click();
await page.locator('.card', { hasText: '片面' }).click();
await page.getByRole('button', { name: 'この構成で作る' }).click();
await page.locator('.page').first().waitFor();

const scroller = page.locator('.stamp').first().locator('xpath=..');
const scrolledTo = () => scroller.evaluate(el => Math.round(el.scrollLeft));

// Playwright's touchscreen only taps, so the swipe goes through CDP.
const cdp = await page.context().newCDPSession(page);
async function swipe(from, to, steps = 14) {
  const at = (x, y) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
}
const middleOf = async (l) => {
  const b = await l.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

let bad = 0;
const check = (ok, line) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'NG  '} ${line}`); };

// The row is wider than the screen, so there is something to scroll to.
const [content, frame] = await scroller.evaluate(el => [el.scrollWidth, el.clientWidth]);
check(content > frame + 40, `トレイは画面より広い（${content}px / ${frame}px）`);
check(
  await page.locator('.stamp').first().evaluate(el => getComputedStyle(el).touchAction) === 'pan-x',
  'スタンプの touch-action が pan-x',
);

const from = await middleOf(page.locator('.stamp').nth(2));
await swipe(from, { x: from.x - 170, y: from.y });
const moved = await scrolledTo();
check(moved > 60, `横に払うとトレイが動く（scrollLeft ${moved}）`);

// The arrow says there is more, and goes when there is not.
check(await page.locator('.tray-more').count() > 0, 'まだ続く側に矢印が出ている');

await scroller.evaluate(el => { el.scrollLeft = 0; });
await page.waitForTimeout(250);
await swipe(await middleOf(page.locator('.stamp', { hasText: 'マンスリー' })),
  await middleOf(page.locator('.page').first()), 18);
check(await page.locator('.part').count() === 1, '紙に向かって引けばパーツは取れる');

await browser.close();
if (bad) process.exitCode = 1;
