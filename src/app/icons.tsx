import type { CSSProperties } from 'react';
import type { Background, PartKind, SizeSpec } from '../types';
import { holeCentres } from '../lib/sizes';
import { foldPanels } from '../lib/fold';
import type { FoldPlan } from '../lib/fold';
import { SHEET_SCALE, ringOut, PAPER, OUTLINE_PX, HOLE_RING_PX, HOLE_MIN_PX } from './look';

// What a stamp shows. A character said what the part was called -- 時 for the
// vertical, 週 for the horizontal -- which is no help at all when the question
// is what the two of them are. The real page shrunk to this size is no help
// either: measured at the stamp's own height, a monthly, a gantt and a habit
// tracker come out as the same smudge, and it takes about six times the room
// before they separate. So the stamp draws the part's shape instead: columns,
// bands, staggered bars, a tick grid. Nothing is to scale and nothing is
// dated -- it is the arrangement, which is the one thing that tells these
// apart at twenty-six pixels across.
//
// Drawn on a 26x18 grid, in the same stroke weight, so twelve of them read as
// one set rather than twelve drawings.
export const ICON_W = 26;

export const ICON_H = 18;

export function StampIcon({ kind }: { kind: PartKind }) {
  const line = (x1: number, y1: number, x2: number, y2: number, i: number) =>
    <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
  const cells: React.ReactNode[] = [];

  // A frame every one of them sits in, so the set has one silhouette.
  const frame = <rect key="f" x={0.75} y={0.75} width={ICON_W - 1.5} height={ICON_H - 1.5} rx={1.5} />;
  const cols = (n: number, from = 0) =>
    Array.from({ length: n - 1 }, (_, i) =>
      line(from + ((ICON_W - from) / n) * (i + 1), 0.75, from + ((ICON_W - from) / n) * (i + 1), ICON_H - 0.75, i));
  const rows = (n: number, from = 0) =>
    Array.from({ length: n - 1 }, (_, i) =>
      line(0.75, from + ((ICON_H - from) / n) * (i + 1), ICON_W - 0.75, from + ((ICON_H - from) / n) * (i + 1), 100 + i));

  if (kind === 'monthly') { cells.push(...cols(7), ...rows(4, 4), line(0.75, 4, ICON_W - 0.75, 4, 9)); }
  // A date gutter down the side, and a line to write on for each day.
  if (kind === 'daylist') { cells.push(line(6, 0.75, 6, ICON_H - 0.75, 0), ...rows(5)); }
  // Hours down the left, a day to each column, a header band on top.
  if (kind === 'weekvert') { cells.push(line(5, 0.75, 5, ICON_H - 0.75, 0), line(0.75, 4.5, ICON_W - 0.75, 4.5, 1), ...cols(5, 5)); }
  // A band to a day, each with its date at the start.
  if (kind === 'weekhoriz') { cells.push(...rows(4), line(5, 0.75, 5, ICON_H - 0.75, 0)); }
  // Bars at different starts and lengths -- the one thing a gantt looks like.
  if (kind === 'gantt') {
    cells.push(line(0.75, 4.5, ICON_W - 0.75, 4.5, 0));
    cells.push(<rect key="b1" x={4} y={6.5} width={9} height={2.4} rx={1.2} />);
    cells.push(<rect key="b2" x={9} y={10.5} width={11} height={2.4} rx={1.2} />);
    cells.push(<rect key="b3" x={6} y={14.5} width={7} height={2.4} rx={1.2} />);
  }
  // Named lanes on the left and marks across them. Drawn as marks rather than
  // as an empty grid, or it is the calendar again: what a habit tracker looks
  // like in use is the ticks, not the ruling.
  if (kind === 'habit') {
    cells.push(line(9, 0.75, 9, ICON_H - 0.75, 0), ...rows(4));
    const at = [[0, 0], [2, 0], [3, 0], [1, 1], [2, 1], [0, 2], [3, 2]];
    cells.push(<g key="ticks" strokeWidth={0}>
      {at.map(([c, r], i) => (
        <circle key={i} cx={11.8 + c * 3.6} cy={5.1 + r * 4.4} r={1.15} fill="currentColor" />
      ))}
    </g>);
  }
  if (kind === 'todo') {
    cells.push(...[4.5, 9.5, 14.5].flatMap((y, i) => [
      <rect key={`b${i}`} x={3.5} y={y - 1.6} width={3.2} height={3.2} rx={0.8} />,
      line(9, y, ICON_W - 3.5, y, i),
    ]));
  }
  // A heading, then the box you write the goal in. Short rule over a panel,
  // so it does not read as another ruled sheet.
  if (kind === 'goal') {
    cells.push(line(3.5, 5, 11, 5, 0));
    cells.push(<rect key="panel" x={3.5} y={8} width={ICON_W - 7} height={6.5} rx={1} />);
  }
  // What it was and what it cost: two columns, the money one narrow.
  if (kind === 'budget') { cells.push(line(17, 0.75, 17, ICON_H - 0.75, 0), ...rows(4)); }
  // Finer and lighter than the calendar's cells, or the two read as the same
  // grid: this one is paper to draw on, not a month to fill in.
  if (kind === 'grid') {
    cells.push(<g key="fine" strokeWidth={0.45}>{[...cols(8), ...rows(6)]}</g>);
  }
  if (kind === 'lines') { cells.push(...rows(5)); }
  // Fewer lines than the ruled sheet, and not to the edges: somewhere to put
  // a few words rather than a page to fill.
  if (kind === 'memo') { cells.push(line(3.5, 6.5, ICON_W - 3.5, 6.5, 0), line(3.5, 11.5, ICON_W - 3.5, 11.5, 1)); }
  // The shape a picture makes in a frame: a horizon and a sun. Drawn rather
  // than ruled, because this is the one stamp that holds something that is
  // not lines.
  // A card for one ink: the number and its name on a rule, the bottle to paint
  // in, and the lines to write on. The bottle is what tells it apart from the
  // memo at this size.
  if (kind === 'swatch') {
    cells.push(line(7.5, 4.6, ICON_W - 2, 4.6, 0));
    cells.push(<rect key="cap" x={4.1} y={7.4} width={2.4} height={1.6} rx={0.5} />);
    cells.push(<rect key="bot" x={2.4} y={9} width={5.8} height={5.4} rx={0.8} />);
    cells.push(line(10.5, 9.4, ICON_W - 2, 9.4, 1));
    cells.push(line(10.5, 12, ICON_W - 2, 12, 2));
    cells.push(line(10.5, 14.6, ICON_W - 2, 14.6, 3));
  }

  if (kind === 'photo') {
    cells.push(<circle key="sun" cx={8} cy={6} r={1.8} />);
    cells.push(<path key="hill" d={`M 2 ${ICON_H - 3.5} L 9 8 L 14 13 L 17 10 L ${ICON_W - 2} ${ICON_H - 3.5} Z`} />);
  }

  return (
    // Sized in CSS rather than in attributes, so the same drawing can be bigger
    // where there is room for it. The strokes are in viewBox units and grow
    // with it, which is what keeps the set looking like one set.
    <svg
      viewBox={`0 0 ${ICON_W} ${ICON_H}`}
      className="h-[18px] w-[26px] lg:h-[26px] lg:w-[38px]"
      fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinecap="round"
      aria-hidden="true"
    >
      {frame}
      <g strokeWidth={0.7}>{cells}</g>
    </svg>
  );
}

// The logo's mark. Three rings where it is shown at a size that can hold
// them; the browser tab (public/favicon.svg) is drawn with two, because at
// 16px three bars run together into one.
export function LogoMark({ className = '' }: { className?: string }) {
  const navy = '#1A3A6B';
  const ys = [29.76, 62, 94.24];
  return (
    <svg viewBox="-4 -4 220 132" className={className} role="img" aria-label="RingCraftLab">
      <rect x={0} y={0} width={100} height={124} rx={6} fill="#1D73BE" />
      <rect x={112} y={0} width={100} height={124} rx={6} fill="#FBD212" />
      {ys.map(y => (
        <g key={y}>
          <circle cx={86} cy={y} r={7.02} fill={navy} opacity={0.35} />
          <circle cx={126} cy={y} r={7.02} fill={navy} opacity={0.35} />
          <line x1={86} y1={y} x2={126} y2={y} stroke={navy} strokeWidth={9} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

// The binder, drawn where it grips the paper: one bar per hole, from a little
// outside the edge through the hole and a little past it, with the punched
// hole left white on top. A refill is a thing that gets bound, and a picture
// of one that shows only the holes leaves the reader to supply the binder --
// which is what made a spread hard to read, because the two pages of a spread
// are two sheets held by the same rings in the middle.
export function Rings({ size, color, flip, pen, holeR }: {
  size: SizeSpec; color: string; flip: boolean;
  pen: (onScreen: number) => number; holeR: number;
}) {
  const onTop = size.ringsOn === 'top';
  const far = onTop ? size.heightMm : size.widthMm;
  const over = ringOut(size);
  const reach = size.ringMarginMm * 0.92;
  const thick = Math.max(holeR * 2.4, pen(3));
  const from = flip ? far - reach : -over;
  return (
    <g fill={color}>
      {holeCentres(size.holes).map((at, i) => (
        <rect
          key={i}
          x={onTop ? at - thick / 2 : from}
          y={onTop ? from : at - thick / 2}
          width={onTop ? thick : reach + over}
          height={onTop ? reach + over : thick}
          rx={thick / 2}
        />
      ))}
    </g>
  );
}

export function SizeIcon({ size, color, flip = false, scale = SHEET_SCALE, rings = false }: {
  size: SizeSpec; color: string; flip?: boolean;
  scale?: number; rings?: boolean;
}) {
  const k = scale;
  const pen = (onScreen: number) => onScreen / k;
  const onTop = size.ringsOn === 'top';
  // `flip` is the left page of a spread: the binding is the seam between the
  // pages, so that one's holes sit on its far edge.
  const margin = size.ringMarginMm / 2;
  const band = flip ? (onTop ? size.heightMm : size.widthMm) - margin : margin;
  const hole = Math.min(
    Math.max(size.holes.diameterMm / 2, pen(HOLE_MIN_PX)),
    margin * 0.75,
  );
  const inset = pen(OUTLINE_PX) / 2;
  // The paper keeps its scale; the box around it gains the room the rings
  // stand out into, on the bound side only.
  const over = rings ? ringOut(size) : 0;
  // And half a pixel of air all round. Without it the outline's outer edge
  // lands exactly on the box's edge, and the box is a fractional number of
  // pixels tall (横長ミニ3穴 came to 18.7), so the bottom and right of the
  // sheet fell across a device pixel and came out visibly paler than the top
  // -- measured at 105 against 117. The air costs nothing and makes the four
  // sides the same weight.
  const air = pen(0.75);
  const vbX = (!onTop && !flip ? -over : 0) - air;
  const vbY = (onTop && !flip ? -over : 0) - air;
  const vbW = size.widthMm + (onTop ? 0 : over) + air * 2;
  const vbH = size.heightMm + (onTop ? over : 0) + air * 2;
  return (
    <svg
      width={vbW * k} height={vbH * k}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      <rect
        x={inset} y={inset}
        width={size.widthMm - inset * 2} height={size.heightMm - inset * 2}
        rx={pen(2)} fill={PAPER} stroke={color} strokeWidth={pen(OUTLINE_PX)}
      />
      {rings && <Rings size={size} color={color} flip={flip} pen={pen} holeR={hole} />}
      {holeCentres(size.holes).map((at, i) => (
        <circle
          key={i}
          cx={onTop ? at : band} cy={onTop ? band : at}
          r={hole}
          fill="#fff" stroke={color} strokeWidth={pen(HOLE_RING_PX)}
        />
      ))}
    </svg>
  );
}

// The strip a fold unfolds into, drawn at the picker's scale so it can be
// compared with the pages above it. Only the first panel is punched, and the
// creases are where the paper actually bends.
export function FoldIcon({ size, color, plan, scale = SHEET_SCALE, rings = false }: {
  size: SizeSpec; color: string; plan: FoldPlan;
  scale?: number; rings?: boolean;
}) {
  const k = scale;
  const pen = (onScreen: number) => onScreen / k;
  const margin = size.ringMarginMm / 2;
  const hole = Math.min(
    Math.max(size.holes.diameterMm / 2, pen(HOLE_MIN_PX)),
    margin * 0.75,
  );
  const line = pen(OUTLINE_PX) / 2;
  const W = plan.sheetWmm, H = plan.sheetHmm;
  const down = plan.grain === 'along';
  const panels = foldPanels(plan);
  // Folding along the binding cuts a corner off, so the outline is an L and
  // the picture has to be that L -- it is the whole difference between this
  // shape and the other one.
  const cut = plan.insetMm;
  const outline = `M ${line} ${line} L ${W - line} ${line} L ${W - line} ${H - line}`
    + ` L ${cut + line} ${H - line} L ${cut + line} ${plan.headMm} L ${line} ${plan.headMm} Z`;
  const out = rings ? ringOut(size) : 0;
  return (
    <svg
      width={(W + out) * k} height={H * k}
      viewBox={`${-out} 0 ${W + out} ${H}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      {down ? (
        <path d={outline} fill={PAPER} stroke={color} strokeWidth={pen(OUTLINE_PX)} strokeLinejoin="round" />
      ) : (
        <rect
          x={line} y={line}
          width={W - line * 2} height={H - line * 2}
          rx={pen(2)} fill={PAPER} stroke={color} strokeWidth={pen(OUTLINE_PX)}
        />
      )}
      {/* Which panel is which. A strip with two dashed lines on it says there
          are three of something; the numbers say the three are the pages you
          will be laying parts on. */}
      {panels.length > 1 && panels.map((p, i) => (
        <text
          key={`n${p.atMm}`}
          x={down ? W / 2 : p.atMm + p.widthMm / 2}
          y={down ? p.atMm + p.widthMm / 2 : H - pen(4)}
          fill={color} opacity={0.75}
          fontSize={pen(8)} fontWeight={700} textAnchor="middle"
        >
          {i + 1}
        </text>
      ))}
      {panels.slice(1).map(p => (
        <line
          key={p.atMm}
          x1={down ? cut : p.atMm} y1={down ? p.atMm : 0}
          x2={down ? W : p.atMm} y2={down ? p.atMm : H}
          stroke={color} strokeWidth={pen(OUTLINE_PX * 0.8)} strokeDasharray={`${pen(3)} ${pen(2.4)}`}
        />
      ))}
      {rings && (
        <g fill={color}>
          {holeCentres(size.holes).map((at, i) => {
            const thick = Math.max(hole * 2.4, pen(3));
            return (
              <rect
                key={i}
                x={-ringOut(size)} y={at - thick / 2}
                width={ringOut(size) + size.ringMarginMm * 0.92} height={thick}
                rx={thick / 2}
              />
            );
          })}
        </g>
      )}
      {holeCentres(size.holes).map((at, i) => (
        <circle
          key={i}
          cx={margin} cy={at} r={hole}
          fill="#fff" stroke={color} strokeWidth={pen(HOLE_RING_PX)}
        />
      ))}
    </svg>
  );
}

// One chevron of the divider's grip, haloed in white so it reads over the
// paper's own lines.
export function Chevron({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) {
  const d = { up: 'M1 5 L4.5 1.2 L8 5', down: 'M1 1 L4.5 4.8 L8 1', left: 'M5 1 L1.2 4.5 L5 8', right: 'M1 1 L4.8 4.5 L1 8' }[dir];
  const across = dir === 'up' || dir === 'down';
  return (
    <svg width={across ? 9 : 6} height={across ? 6 : 9} viewBox={across ? '0 0 9 6' : '0 0 6 9'} aria-hidden="true"
      className="block overflow-visible [filter:drop-shadow(0_0_1.5px_#fff)_drop-shadow(0_0_1.5px_#fff)]">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The list of pages, drawn rather than named. Two columns of little sheets is
// what the panel it opens actually looks like, so the button and the place it
// goes are the same picture.
export function ListGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" className="block">
      <g fill="none" stroke="currentColor" strokeWidth={1}>
        {[0.5, 7.5].map(x => [0.5, 5, 9.5].map(y => (
          <rect key={`${x}-${y}`} x={x} y={y} width={5} height={3} rx={0.5} />
        )))}
      </g>
    </svg>
  );
}

// The form a refill is folded into, drawn small enough to stand in a chip:
// one sheet, two facing pages, or a strip with creases in it. Solid, because
// unlike the ＋'s mark this is a thing that exists -- dashes are this app's
// word for 「not there yet」.
export function FormGlyph({ kind, panels = 3 }: { kind: 'spread' | 'single' | 'fold'; panels?: number }) {
  const w = kind === 'spread' ? 22 : 15;
  const dots = (x: number) => [3.6, 7.5, 11.4].map(y => (
    <circle key={y} cx={x} cy={y} r={0.9} fill="currentColor" opacity={0.85} />
  ));
  return (
    <svg width={w} height={15} viewBox={`0 0 ${w} 15`} aria-hidden="true" className="block shrink-0">
      {kind === 'spread' ? (
        <>
          <rect x={0.6} y={0.9} width={9.4} height={13.2} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          <rect x={12} y={0.9} width={9.4} height={13.2} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          {dots(11)}
        </>
      ) : (
        <>
          <rect x={0.6} y={0.9} width={13.8} height={13.2} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          {kind === 'single'
            ? dots(3.4)
            : Array.from({ length: Math.max(1, panels - 1) }, (_, i) => (
                <line
                  key={i}
                  x1={0.6 + (13.8 * (i + 1)) / panels} y1={1.6}
                  x2={0.6 + (13.8 * (i + 1)) / panels} y2={13.4}
                  stroke="currentColor" strokeWidth={1} strokeDasharray="1.6 1.4"
                />
              ))}
        </>
      )}
    </svg>
  );
}

// An open book, drawn rather than named -- two leaves lifting away from the
// rings in the middle. Same trick as the list: the button and the screen it
// opens are the same picture, so nothing has to be written to say where it
// goes, and the way back out wears it too.
export function CalendarGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

// The ground as a swatch: what is printed under everything, in miniature.
export function BackgroundSample({ bg }: { bg?: Background }) {
  const kind = bg?.kind ?? 'none';
  const line = bg?.color ?? '#B9B2A2';
  const style: CSSProperties =
    kind === 'tint' ? { background: bg?.color }
    : kind === 'grid' ? { backgroundImage: `linear-gradient(${line} 1px,transparent 1px),linear-gradient(90deg,${line} 1px,transparent 1px)`, backgroundSize: '5px 5px' }
    : kind === 'dot' ? { backgroundImage: `radial-gradient(circle,${line} 0.8px,transparent 1.1px)`, backgroundSize: '5px 5px' }
    : kind === 'lines' ? { backgroundImage: `repeating-linear-gradient(to bottom,transparent 0 4px,${line} 4px 5px)` }
    : kind === 'image' && bg?.src ? { backgroundImage: `url(${bg.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};
  return <span className="block size-[14px] rounded-[2px] border border-line-strong bg-white" style={style} />;
}

export function BookGlyph() {
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" aria-hidden="true" className="block">
      <g fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" strokeLinecap="round">
        <path d="M8 3.1C6.4 1.9 4 1.5 1 1.8v8.6c3-.3 5.4.1 7 1.3" />
        <path d="M8 3.1c1.6-1.2 4-1.6 7-1.3v8.6c-3-.3-5.4.1-7 1.3" />
        <path d="M8 3.1v8.6" />
      </g>
    </svg>
  );
}

// What an empty place on the paper offers. Two kinds of thing go in one:
// a note sheet, which is one sheet and needs nothing decided about it, and
// a section of your own, which you then design.
//
// It is a modal because a panel under the press sat off the bottom of a 900px
// window, and "pressed ＋ and nothing happened" is how that reads.
// What a refill set is made of, in the words the tray already uses. A section
// starts as one of these rather than as a blank sheet someone has to know how
// to fill: 表紙 is a picture on a sheet, and nobody arrives at that by
// guessing. The dated ones come with the book's period, so a weekly is a
// year of weeks straight away and the contents says how long that is.
// `run` marks the ones that are as long as their dates rather than one page,
// which is what decides whether they can be put on a single empty page.
// A sheet of paper with its corner turned: a file.
export function FileGlyph() {
  return (
    <svg width="15" height="20" viewBox="0 0 15 20" aria-hidden="true" className="block shrink-0">
      <path d="M1 1h9l4 4v14H1z M10 1v4h4" fill="#fff" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" className="text-faint" />
    </svg>
  );
}
