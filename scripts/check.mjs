// Builds the app, serves it, and runs every check at once.
//
//   npm run check              # rules + 8 screen checks, shots in shots/
//   npm run check -- --keep    # leave the preview server up afterwards
//   npm run check -- --no-build
//   npm run check -- shoot pdf # only these
//
// Why this exists: the checks were a sequence of six commands, each needing
// the browser path in front of it and a preview server someone remembered to
// start. Any check that costs six steps gets skipped, and the rule in
// CLAUDE.md -- look at the app, do not conclude from the code -- only holds if
// looking is one step.
//
// The screen checks are independent, so they run at the same time. Three at
// once: each one is its own Chromium and the container has a memory budget.
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { BASE, chromiumPath } from './browser.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.filter(a => !a.startsWith('-'));

// Slowest first: the run is as long as its longest job, and pdfcheck renders
// a PDF and waits on it.
const CHECKS = [
  { id: 'pdf', script: 'pdfcheck.mjs', out: 'shots/pdf', what: '用紙サイズと面付け' },
  { id: 'shoot', script: 'shoot.mjs', out: 'shots/shoot', what: '主要35場面' },
  { id: 'pc', script: 'pccheck.mjs', out: 'shots/pc', what: 'PCの2カラムとホバー' },
  { id: 'book', script: 'bookcheck.mjs', out: 'shots/book', what: '1冊の中身（順番・枚数・保存）' },
  { id: 'ux', script: 'uxcheck.mjs', out: 'shots/ux', what: '×と確認ダイアログ' },
  { id: 'print', script: 'printpreview.mjs', out: 'shots/print', what: '刷り上がりプレビュー' },
  { id: 'multidrop', script: 'multidrop.mjs', out: null, what: 'まとめてドラッグ' },
  { id: 'touch', script: 'touchcheck.mjs', out: null, what: '指でのトレイ操作' },
];

const run = (cmd, argv, env) => new Promise(resolve => {
  const p = spawn(cmd, argv, { env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ code, out: out.trimEnd() }));
});

const up = async () => {
  try { return (await fetch(BASE)).ok; } catch { return false; }
};

async function main() {
  const t0 = Date.now();
  if (!chromiumPath()) console.log('※ Chromiumが/opt/pw-browsersに見つからない。Playwright同梱を使う');

  if (!flag('--no-build')) {
    const b = await run('npm', ['run', 'build']);
    if (b.code !== 0) { console.log(b.out); console.log('\nビルドが通らないので中止'); process.exit(1); }
    console.log('build ok');
  }

  // Only ours gets stopped at the end. A server someone else left running is
  // theirs, and killing it mid-session is how a check turns into a mystery.
  let server = null;
  if (!(await up())) {
    server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
    const until = Date.now() + 20000;
    while (!(await up())) {
      if (Date.now() > until) { server.kill(); console.log(`${BASE} が建たない`); process.exit(2); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`preview ${BASE}`);
  } else {
    console.log(`preview ${BASE}（すでに建っていた）`);
  }

  const rules = await run('node', ['scripts/rules.mts']);
  console.log(`\n── rules ${rules.code === 0 ? 'ok' : 'NG'}\n${rules.out.split('\n').slice(-1)[0]}`);
  if (rules.code !== 0) console.log(rules.out);

  const queue = CHECKS.filter(c => only.length === 0 || only.includes(c.id));
  await Promise.all(queue.map(c => c.out ? rm(c.out, { recursive: true, force: true }) : null));

  const results = [];
  const workers = Array.from({ length: 3 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const r = await run('node', [`scripts/${c.script}`, ...(c.out ? [c.out] : [])]);
      results.push({ ...c, ...r });
      console.log(`${r.code === 0 ? '  ok ' : '  NG '} ${c.id.padEnd(10)} ${c.what}`);
    }
  });
  await Promise.all(workers);

  for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`\n── ${r.id} ${r.code === 0 ? '' : `(exit ${r.code})`}\n${r.out}`);
  }

  if (server && !flag('--keep')) server.kill();
  const failed = results.filter(r => r.code !== 0);
  console.log(
    `\n${results.length - failed.length}/${results.length} 通った・${((Date.now() - t0) / 1000).toFixed(0)}秒`
    + (server && flag('--keep') ? `・preview は建てたまま（${BASE}）` : ''),
  );
  process.exitCode = failed.length || rules.code ? 1 : 0;
}

await main();
