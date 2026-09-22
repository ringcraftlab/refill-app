// Selecting several stamps and dragging them in one go must place them
// whenever dropping the same parts one at a time would. This walks a set of
// combinations and reports which are refused.
//
//   npm run check -- multidrop      （または node scripts/multidrop.mjs [outDir]）
import { BASE, launch } from './browser.mjs';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2];
if (OUT) await mkdir(OUT, { recursive: true });

const COMBOS = [
  ['マンスリー', 'メモ', 'TODO'],
  ['メモ', '方眼', 'TODO'],
  ['ハビット', 'メモ', 'TODO'],
  ['マンスリー', '方眼', '目標'],
  ['メモ', '罫線', '方眼', '目標'],
];

const browser = await launch();

// The five combinations are independent walks through the app, so they run at
// the same time in one browser. Serially this was the longest check in the
// suite; the work was never the dragging.
async function tryCombo(combo) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const centerOf = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const stamp = async (label) => {
    const el = page.locator('.stamp', { hasText: label });
    await el.scrollIntoViewIfNeeded();
    return el;
  };

  await page.goto(BASE);
  await page.locator('.sizerow', { hasText: 'Mini6' }).click();
  await page.locator('.card', { hasText: '見開き' }).click();
  await page.getByRole('button', { name: 'この構成で作る' }).click();
  await page.locator('.page').first().waitFor();

  // Tap to select, then one drag carries the whole selection.
  for (const label of combo) await (await stamp(label)).click();
  const from = await centerOf(await stamp(combo[0]));
  const to = await centerOf(page.locator('.page').first());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  // A refusal toast is drawn on the drop and hidden again after 1.8s, so it
  // has to be looked for now and briefly. Waiting the default 30s for an
  // element that was never going to appear is what made this check slow --
  // and it would have missed a toast that did appear and then left.
  const toast = await page.locator('.toast').textContent({ timeout: 900 }).catch(() => null);
  // A part crossing the gutter has a hit area on each page, so the clear
  // buttons are the honest count: one per removable block.
  const placed = await page.locator('.clearmini').count();
  // Not refusing is only half of it; the arrangement has to be worth having.
  if (OUT) await page.screenshot({ path: `${OUT}/${combo.join('+')}.png` });
  await page.close();
  return { combo, toast, placed };
}

const results = await Promise.all(COMBOS.map(tryCombo));
let bad = 0;
for (const { combo, toast, placed } of results) {
  if (toast) bad++;
  console.log(`${toast ? 'FAIL' : 'ok  '} ${combo.join(' + ')} -> ${placed} blocks${toast ? ` "${toast}"` : ''}`);
}
console.log(bad === 0 ? 'all placed' : `${bad} refused`);
if (bad) process.exitCode = 1;
await browser.close();
