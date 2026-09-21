// 六曜と祝日を、外部の実装と突き合わせて確かめる。
//
//   npm i --no-save lunar-javascript @holiday-jp/holiday_jp
//   node scripts/koyomicheck.mjs
//
// lunar-javascript は中国の旧暦なので、日本時間との1時間差で食い違う月が
// ある。それは正しい食い違いなので、朔や中気が日本時間の0時台に起きたか
// どうかで仕分けて報告する。@holiday-jp/holiday_jp は内閣府の告示由来の
// 日付データで、こちらは完全一致していなければおかしい。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'koyomi-'));
const bundle = join(dir, 'koyomi.mjs');
writeFileSync(join(dir, 'entry.ts'), `
export { rokuyo, kyureki } from '${process.cwd()}/src/lib/kyureki';
export { holidayName } from '${process.cwd()}/src/lib/holidays';
export { newMoonJde, newMoonIndex, deltaTSeconds, fromJulianDay, sunLongitudeTime, julianDay } from '${process.cwd()}/src/lib/astro';
`);
execFileSync('node_modules/.bin/esbuild', [join(dir, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=warning']);

const ours = await import(bundle);
let lunar, holidayJp;
try {
  lunar = (await import('lunar-javascript')).default ?? await import('lunar-javascript');
  holidayJp = (await import('@holiday-jp/holiday_jp')).default;
} catch {
  console.log('比較用のパッケージが無い。npm i --no-save lunar-javascript @holiday-jp/holiday_jp');
  process.exit(1);
}
const { Solar } = lunar;

// --- 祝日: 1日でも違えば失敗
const theirs = new Map();
for (const x of holidayJp.between(new Date(1970, 0, 1), new Date(2050, 11, 31))) {
  const d = x.date;
  theirs.set(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, x.name);
}
let mine = 0, extra = 0, miss = 0;
for (let y = 1970; y <= 2050; y++) for (let m = 1; m <= 12; m++) {
  for (let d = 1, last = new Date(y, m, 0).getDate(); d <= last; d++) {
    const ourName = ours.holidayName(y, m, d);
    const theirName = theirs.get(`${y}-${m}-${d}`) ?? null;
    if (ourName) mine++;
    if (ourName && !theirName) { extra++; console.log(`  余分 ${y}-${m}-${d} ${ourName}`); }
    if (!ourName && theirName) { miss++; console.log(`  漏れ ${y}-${m}-${d} ${theirName}`); }
  }
}
console.log(`祝日 1970-2050: 自前 ${mine}日 / 内閣府由来 ${theirs.size}日  余分 ${extra}  漏れ ${miss}`);

// --- 旧暦: 食い違いは時差で説明がつくものだけのはず
const jstHour = (jdeTT, y, m) => {
  const f = ours.fromJulianDay(jdeTT - ours.deltaTSeconds(y, m) / 86400 + 9 / 24);
  return { ...f, hour: f.fraction * 24 };
};
const runs = [];
let prevDiff = false, prevTime = null, cur = null;
for (let y = 1900; y <= 2100; y++) for (let m = 1; m <= 12; m++) {
  for (let d = 1, last = new Date(y, m, 0).getDate(); d <= last; d++) {
    const k = ours.kyureki(y, m, d);
    const l = Solar.fromYmd(y, m, d).getLunar();
    const same = k.month === Math.abs(l.getMonth()) && k.day === l.getDay() && k.leap === (l.getMonth() < 0);
    const t = Date.UTC(y, m - 1, d);
    if (!same) {
      if (cur && prevDiff && t - prevTime === 86400000) cur.n++;
      else { cur = { y, m, d, n: 1 }; runs.push(cur); }
    }
    prevDiff = !same; prevTime = t;
  }
}
// 六曜の式と並び順そのもの: 旧暦が一致した日は六曜も一致していなければ
// おかしい。相手は簡体字を返すことがあるので字を揃えてから比べる。
const kanji = (s) => ({ '先胜': '先勝', '先负': '先負', '佛灭': '仏滅', '空亡': '仏滅' }[s] ?? s);
let agreed = 0, rokuyoBad = 0;
for (let y = 1900; y <= 2100; y++) for (let m = 1; m <= 12; m++) {
  for (let d = 1, last = new Date(y, m, 0).getDate(); d <= last; d++) {
    const k = ours.kyureki(y, m, d);
    const l = Solar.fromYmd(y, m, d).getLunar();
    if (k.month !== Math.abs(l.getMonth()) || k.day !== l.getDay() || k.leap !== (l.getMonth() < 0)) continue;
    agreed++;
    if (ours.rokuyo(y, m, d) !== kanji(l.getLiuYao())) rokuyoBad++;
  }
}
console.log(`六曜: 旧暦が一致した ${agreed}日のうち食い違い ${rokuyoBad}日`);

// 時差で説明がつくか（朔か中気が日本時間の0時台）
const unexplained = runs.filter(r => {
  const k = ours.newMoonIndex(r.y, r.m);
  for (const kk of [k - 1, k, k + 1]) if (jstHour(ours.newMoonJde(kk), r.y, r.m).hour < 1.5) return false;
  for (let deg = 0; deg < 360; deg += 30) {
    const f = jstHour(ours.sunLongitudeTime(deg, ours.julianDay(r.y, r.m, 1) - 40), r.y, r.m);
    if (f.hour < 1.5 && Math.abs(Date.UTC(f.year, f.month - 1, f.day) - Date.UTC(r.y, r.m - 1, r.d)) < 40 * 86400000) return false;
  }
  return true;
});
console.log(`旧暦 1900-2100: 中国暦との食い違い ${runs.length}まとまり  うち時差で説明がつかないもの ${unexplained.length}`);
unexplained.forEach(r => console.log(`  ${r.y}-${r.m}-${r.d} から ${r.n}日`));
if (extra || miss || unexplained.length || rokuyoBad) process.exitCode = 1;
