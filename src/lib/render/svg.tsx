import React from 'react';
import type { Page, Primitive, Color } from '../draw';
import { PAPER } from '../draw';
import type { SheetContent } from './impose';

const rgb = (c: Color) => `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;

// Rough px per pt so SVG text sizes visually match PDF output.
const PT_TO_MM = 25.4 / 72;

function Primitives({ items }: { items: Primitive[] }) {
  return (
    <>
      {items.map((p, i) => {
        if (p.type === 'rect') {
          return (
            <rect
              key={i}
              x={p.x} y={p.y} width={p.w} height={p.h}
              fill={p.fill ? rgb(p.fill) : 'none'}
              stroke={p.stroke ? rgb(p.stroke) : 'none'}
              strokeWidth={p.strokeMm ?? 0}
            />
          );
        }
        if (p.type === 'circle') {
          return (
            <circle
              key={i}
              cx={p.cx} cy={p.cy} r={p.r}
              fill={p.fill ? rgb(p.fill) : 'none'}
              stroke={p.stroke ? rgb(p.stroke) : 'none'}
              strokeWidth={p.strokeMm ?? 0}
            />
          );
        }
        if (p.type === 'line') {
          return (
            <line
              key={i}
              x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
              stroke={rgb(p.stroke)}
              strokeWidth={p.strokeMm ?? 0.2}
              strokeDasharray={p.dashMm?.join(' ')}
            />
          );
        }
        // text
        const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
        // A quarter turn on a landscape sheet. SVG's y runs down where the
        // PDF's runs up, so the same quarter turn is the other way round here.
        const turn = p.rotateDeg ? `rotate(${-p.rotateDeg} ${p.x} ${p.y})` : undefined;
        return (
          <text
            key={i}
            x={p.x} y={p.y} transform={turn}
            fill={p.color ? rgb(p.color) : '#000'}
            fontSize={p.sizePt * PT_TO_MM}
            fontFamily='system-ui, -apple-system, "Hiragino Sans", sans-serif'
            textAnchor={anchor}
          >
            {p.text}
          </text>
        );
      })}
    </>
  );
}

// Renders one Page at true size using mm units. Browsers honor
// `width="Xmm"`, so on a correctly-configured display the preview matches
// print output; the PDF export uses the same mm coordinates for exact parity.
export function PageSvg({ page, scale = 3, showGuides = true }: { page: Page; scale?: number; showGuides?: boolean }) {
  return (
    <svg
      className="block"
      width={`${page.widthMm * scale}px`}
      height={`${page.heightMm * scale}px`}
      viewBox={`0 0 ${page.widthMm} ${page.heightMm}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={page.widthMm} height={page.heightMm} fill={rgb(PAPER)} />
      {showGuides && <Primitives items={page.guides} />}
      <Primitives items={page.primitives} />
    </svg>
  );
}

// One sheet of paper exactly as it will come out of the printer: tiles,
// cut lines and all. Nothing is added here that the PDF does not carry, so
// what this shows is what prints.
export function SheetSvg({ sheet, boxPx, className = '' }: {
  sheet: SheetContent; boxPx: number; className?: string;
}) {
  const scale = Math.min(boxPx / sheet.widthMm, (boxPx * 1.42) / sheet.heightMm);
  return (
    <svg
      className={className}
      width={`${sheet.widthMm * scale}px`}
      height={`${sheet.heightMm * scale}px`}
      viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={sheet.widthMm} height={sheet.heightMm} fill="#fff" />
      <Primitives items={sheet.primitives} />
    </svg>
  );
}
