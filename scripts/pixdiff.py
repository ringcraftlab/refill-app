# Compares two screenshot trees and reports how much each image moved.
#
#   python3 scripts/pixdiff.py before/ after/
#
# Used when a change is meant to be invisible -- a refactor, a move to a
# different styling approach -- so "it still looks right" can be measured
# instead of squinted at.
import sys, pathlib
from PIL import Image, ImageChops

a_root, b_root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
worst = []
for a in sorted(a_root.rglob('*.png')):
    b = b_root / a.relative_to(a_root)
    if not b.exists():
        print(f'MISSING  {a.relative_to(a_root)}')
        continue
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if ia.size != ib.size:
        print(f'SIZE     {a.relative_to(a_root)}  {ia.size} -> {ib.size}')
        worst.append((100.0, a.relative_to(a_root)))
        continue
    diff = ImageChops.difference(ia, ib)
    # A pixel counts as moved only if it is visibly different, so antialiasing
    # on the same glyph does not read as a change.
    moved = sum(1 for px in diff.getdata() if max(px) > 12)
    pct = moved / (ia.width * ia.height) * 100
    worst.append((moved, pct, a.relative_to(a_root)))

worst.sort(reverse=True)
for moved, pct, name in worst:
    # Same means not one pixel moved, which two builds of the same source do
    # reach -- the renders are deterministic. A floor of a tenth of a percent
    # was hiding real changes instead: a date on a button and a week of column
    # headings came to 950 pixels of 1.3 million, which read as "same" while
    # plainly not being it. The count is printed because the percentage of a
    # phone screenshot makes anything short of a layout change look like zero.
    mark = 'same ' if moved == 0 else 'DIFF ' if pct > 1 else 'minor'
    print(f'{mark} {pct:6.2f}%  {moved:7d}px  {name}')
print(f'\n{sum(1 for m, _, _ in worst if m == 0)}/{len(worst)} 枚が同一')
