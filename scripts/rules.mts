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
import { FOLD_PANELS, foldGrainsOf, foldPlan, ringReachMm } from '../src/lib/fold.ts';

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

// The fold. None of these can be seen on screen: the inner panels have to
// clear the rings when the strip is folded, the strip has to fit the paper,
// and the duplex setting the sheet asks for has to be the one the imposition
// actually assumes.
console.log('');
for (const s of Object.values(SIZES)) {
  const name = s.label.padEnd(10);
  for (const panels of FOLD_PANELS) for (const want of foldGrainsOf(s)) {
    const plan = foldPlan(s, panels, want);
    if (!plan) { check(true, `${name} ${panels}面 ${want} 蛇腹にしない`); continue; }

    // Folded, the inner panels lie behind the punched one.
    check(
      plan.innerMm <= plan.innerCapMm + 1e-9,
      `${name} ${panels}面 ${plan.grain} 内側${plan.innerMm}mm ≤ 上限${plan.innerCapMm.toFixed(2)}mm`,
    );

    // How each grain gets past the rings. Folding away from them, the panel is
    // short enough to stop before the holes. Folding along them it is the
    // width that has to stop, so the strip is cut back -- and the cut has to
    // clear the outer rim of a hole, not just its centre.
    if (plan.grain === 'along') {
      check(
        plan.insetMm >= ringReachMm(s),
        `${name} ${panels}面 along 削り${plan.insetMm}mm ≥ リング逃げ${ringReachMm(s)}mm`,
      );
    } else {
      check(
        plan.innerMm + ringReachMm(s) <= plan.headMm + 1e-9,
        `${name} ${panels}面 out 内側${plan.innerMm} + 逃げ${ringReachMm(s)} ≤ 1面目${plan.headMm}`,
      );
    }

    const tile = planTiles({ widthMm: plan.sheetWmm, heightMm: plan.sheetHmm }, DEFAULT_IMPOSE);
    const turned = tile.paper.widthMm > tile.paper.heightMm ? 'A4横' : 'A4縦';
    check(
      tile.sideMm >= 0 && tile.endMm >= 0 && tile.perPage >= 1,
      `${name} ${panels}面 外枠${plan.sheetWmm}×${plan.sheetHmm} が${turned}に`
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
