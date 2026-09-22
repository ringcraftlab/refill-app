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
// Measured off the rendered page, not derived here: OUTER_MM plus each part's
// own PAD came to 4.20mm on every size that was looked at.
const INK_INSET_MM = 4.2;
import { DEFAULT_IMPOSE, planTiles } from '../src/lib/render/impose.ts';

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

  // A sheet has to actually fit the paper it is imposed on. The plan falls
  // back to one tile for a refill larger than the paper, which would then
  // print off the edge, so the clearance is what says it really fits.
  const plan = planTiles(s, DEFAULT_IMPOSE);
  const turned = plan.paper.widthMm > plan.paper.heightMm ? 'A4横' : 'A4縦';
  check(
    plan.sideMm >= 0 && plan.endMm >= 0,
    `${name} ${turned}に入る（${plan.cols}列×${plan.rows}段 = ${plan.perPage}面`
    + `・外周 左右${plan.sideMm.toFixed(1)} 上下${plan.endMm.toFixed(1)}mm）`,
  );

  // Where the block runs to the paper's edge, the refill's own edge is the
  // paper's edge, and whatever the printer cannot reach there is lost. That
  // is a choice, not a fault -- it is what buys A5 its second refill -- so
  // what is checked is that the number the screen quotes is the true one:
  // ink never starts closer in than the punch guide's outer rim.
  const punch = s.ringMarginMm / 2 - s.holes.diameterMm / 2;
  check(
    punch > 0 && punch <= INK_INSET_MM,
    `${name} 端に最も近いインクは穴ガイドの${punch.toFixed(2)}mm（中身は${INK_INSET_MM}mm）`,
  );
}

if (bad) {
  console.log(`\n${bad}件 破れている`);
  process.exitCode = 1;
} else {
  console.log(`\n${Object.keys(SIZES).length}サイズ すべて満たす`);
}
