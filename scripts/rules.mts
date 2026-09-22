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
import { DEFAULT_IMPOSE, duplexFlip, planTiles } from '../src/lib/render/impose.ts';
import { FOLD_PANELS, foldPlan, innerCapMm, ringReachMm } from '../src/lib/fold.ts';

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

// The fold. Three things make a 蛇腹 work, and none of them can be seen on
// screen: the inner panels have to clear the rings when the strip is folded,
// the strip has to fit the paper, and the duplex setting the sheet asks for
// has to be the one the imposition actually assumes.
console.log('');
for (const s of Object.values(SIZES)) {
  const name = s.label.padEnd(10);
  for (const panels of FOLD_PANELS) {
    const plan = foldPlan(s, panels);
    if (!plan) { check(true, `${name} ${panels}面 蛇腹にしない`); continue; }

    // Folded, the inner panels lie behind the punched one. Wider than this and
    // they run into the ring wire.
    check(
      plan.innerMm <= innerCapMm(s) + 1e-9,
      `${name} ${panels}面 内側${plan.innerMm}mm ≤ リング逃げ${innerCapMm(s).toFixed(2)}mm`
      + `（逃げ${ringReachMm(s)}mm）`,
    );

    const tile = planTiles({ widthMm: plan.alongMm, heightMm: plan.acrossMm }, DEFAULT_IMPOSE);
    const turned = tile.paper.widthMm > tile.paper.heightMm ? 'A4横' : 'A4縦';
    check(
      tile.sideMm >= 0 && tile.endMm >= 0 && tile.perPage >= 1,
      `${name} ${panels}面 帯${plan.alongMm}×${plan.acrossMm} が${turned}に`
      + `${tile.cols}列×${tile.rows}段 = ${tile.perPage}本`
      + `・両面は${duplexFlip(tile)}`,
    );

    // The panels have to add up to the strip, or the creases land somewhere
    // other than where the paper is cut.
    check(
      plan.headMm + plan.innerMm * (panels - 1) === plan.alongMm,
      `${name} ${panels}面 ${plan.headMm} + ${plan.innerMm}×${panels - 1} = ${plan.alongMm}`,
    );
  }
}

if (bad) {
  console.log(`\n${bad}件 破れている`);
  process.exitCode = 1;
} else {
  console.log(`\n${Object.keys(SIZES).length}サイズ すべて満たす`);
}
