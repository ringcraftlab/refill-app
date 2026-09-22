// Where the browser and the running app are, in one place.
//
// The container's Chromium is not the one Playwright would download, and its
// version number moves, so every check script used to need the path pasted in
// front of it. That is the kind of thing that makes looking at the app feel
// expensive, and a check that feels expensive does not get run.
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

export const BASE = process.env.BASE_URL ?? 'http://localhost:4173';

const POOL = '/opt/pw-browsers';

// CHROMIUM_PATH wins, then whatever the image has under /opt/pw-browsers
// (the version in that folder name changes), then Playwright's own download.
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (!existsSync(POOL)) return undefined;
  for (const dir of readdirSync(POOL).filter(d => d.startsWith('chromium')).sort().reverse()) {
    const bin = `${POOL}/${dir}/chrome-linux/chrome`;
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

export function launch(opts = {}) {
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath, ...opts } : opts);
}

// Fails loudly rather than letting every locator time out in turn, which is
// what an unstarted preview server looks like from inside a check.
export async function requireApp(base = BASE) {
  try {
    const res = await fetch(base);
    if (res.ok) return;
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`${base} につながらない（${e.message}）。npm run check が preview を建てる。`);
    process.exit(2);
  }
}
