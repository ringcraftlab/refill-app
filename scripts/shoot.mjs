// Renders every monthly variant to a PNG so layout changes are checked by
// looking at them, not by reading the CSS. Run against `vite preview`:
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/shoot.mjs [outDir]
//
// CHROMIUM_PATH overrides the browser binary when the bundled one is missing.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.argv[2] ?? 'shots';

const VARIANTS = [
  ['spread-weekday', '1-見開き曜日分割'],
  ['spread-week', '2-見開き週分割-横'],
  ['single-portrait', '3-片側-縦'],
  ['single-landscape', '4-片側-横'],
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(BASE);

await page.getByRole('button', { name: 'マンスリー' }).click();
const variantSelect = page.locator('select:has(option[value="spread-weekday"])');

for (const [value, name] of VARIANTS) {
  await variantSelect.selectOption(value);
  await page.locator('.pages svg').first().waitFor();
  await page.locator('.pages').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
}

await browser.close();
