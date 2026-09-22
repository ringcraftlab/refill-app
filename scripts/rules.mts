// Rules the pure library has to keep, checked against the real source.
//
//   node scripts/rules.mts
//
// Node runs TypeScript directly, so this imports src/ as it is -- no bundling
// step, no copy of the numbers. A copy would agree with itself while the app
// printed something else.
//
// These are the facts that make a printed refill fit its binder. Everything
// else about the app can be looked at on screen; a hole 2mm out cannot.
import { holeCentres, SIZES } from '../src/lib/sizes.ts';
import { DEFAULT_IMPOSE, tilesPerPage } from '../src/lib/render/impose.ts';

let bad = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'NG  '} ${line}`);
};

for (const s of Object.values(SIZES)) {
  const edge = s.ringsOn === 'top' ? s.widthMm : s.heightMm;
  const c = holeCentres(s.holes);
  const name = s.label.padEnd(10);

  // The punch pattern has to add up to the binding edge, end margin included.
  // This is the one number that makes a refill fit or not fit.
  check(
    c[c.length - 1] + s.holes.marginMm === edge && c.length === s.holes.count,
    `${name} ${s.widthMm}×${s.heightMm} 綴じ辺${edge} = ${s.holes.marginMm} + …… + ${s.holes.marginMm}`,
  );

  // Content stops at the ring margin, so a hole has to sit inside it or the
  // punch goes through what is written.
  check(
    s.holes.diameterMm < s.ringMarginMm,
    `${name} 穴径${s.holes.diameterMm} < リング幅${s.ringMarginMm}`,
  );

  // A sheet has to actually fit the paper it is imposed on. `tilesPerPage`
  // floors to at least one tile, so a sheet wider than the usable area would
  // be placed anyway and print off the edge.
  const { paper, marginMm } = DEFAULT_IMPOSE;
  const fits = s.widthMm <= paper.widthMm - marginMm * 2
    && s.heightMm <= paper.heightMm - marginMm * 2;
  const { cols, rows } = tilesPerPage({ ...s, primitives: [] }, DEFAULT_IMPOSE);
  check(fits, `${name} A4に入る（${cols}列×${rows}段 = ${cols * rows}面）`);
}

if (bad) {
  console.log(`\n${bad}件 破れている`);
  process.exitCode = 1;
} else {
  console.log(`\n${Object.keys(SIZES).length}サイズ すべて満たす`);
}
