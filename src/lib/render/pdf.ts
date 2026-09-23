import {
  PDFDocument, rgb, PDFFont, PDFImage, PDFPage, degrees,
  clip, closePath, endPath, lineTo, moveTo, popGraphicsState, pushGraphicsState,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Primitive } from '../draw';
import { mmToPt } from '../sizes';
import type { SheetContent } from './impose';

// Pages arrive already flattened onto the paper they print on — either the
// punched sheet itself, or a sheet of A4 with refills imposed on it — so this
// only has to turn millimetres into points.

// The embedded face carries a fixed set of characters, so what can be drawn
// travels with it.
interface PrintFont { font: PDFFont; chars: string }

// A hundred-odd kilobytes that only a download needs, so it is fetched when
// one is asked for rather than carried by the editor.
async function printFont(doc: PDFDocument): Promise<PrintFont> {
  const { PRINT_FONT_BASE64, PRINT_FONT_CHARS } = await import('./printfont');
  doc.registerFontkit(fontkit);
  // Subsetting again on the way out keeps the PDF to the glyphs it uses,
  // which matters when a year of refills is one file.
  const font = await doc.embedFont(PRINT_FONT_BASE64, { subset: true });
  return { font, chars: PRINT_FONT_CHARS };
}

// Every picture in the job, embedded once. A photo on a monthly is the same
// photo on all twelve sheets, and embedding it twelve times would carry the
// same megabyte twelve times over.
async function embedImages(doc: PDFDocument, sheets: SheetContent[]): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  const srcs = new Set<string>();
  for (const sheet of sheets) {
    for (const p of sheet.primitives) if (p.type === 'image') srcs.add(p.src);
  }
  for (const src of srcs) {
    try {
      out.set(src, src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')
        ? await doc.embedJpg(src)
        : await doc.embedPng(src));
    } catch {
      // A picture that cannot be read is left out rather than losing the
      // whole export; the sheet prints without it.
    }
  }
  return out;
}

export async function sheetsToPdf(sheets: SheetContent[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await printFont(doc);
  const images = await embedImages(doc, sheets);

  for (const sheet of sheets) {
    const page = doc.addPage([mmToPt(sheet.widthMm), mmToPt(sheet.heightMm)]);
    for (const prim of sheet.primitives) drawPrimitive(page, prim, sheet.heightMm, font, images);
  }
  return doc.save();
}

function drawPrimitive(
  page: PDFPage, prim: Primitive, sheetH: number, pf: PrintFont, images?: Map<string, PDFImage>,
) {
  // Millimetres run down the sheet; PDF points run up it.
  const pt = (x: number, y: number) => ({ x: mmToPt(x), y: mmToPt(sheetH - y) });

  if (prim.type === 'rect') {
    const origin = pt(prim.x, prim.y + prim.h);
    page.drawRectangle({
      x: origin.x, y: origin.y,
      width: mmToPt(prim.w), height: mmToPt(prim.h),
      color: prim.fill ? rgb(...prim.fill) : undefined,
      borderColor: prim.stroke ? rgb(...prim.stroke) : undefined,
      borderWidth: prim.strokeMm ? mmToPt(prim.strokeMm) : 0,
      borderDashArray: prim.dashMm?.map(mmToPt),
    });
  } else if (prim.type === 'line') {
    page.drawLine({
      start: pt(prim.x1, prim.y1),
      end: pt(prim.x2, prim.y2),
      thickness: mmToPt(prim.strokeMm ?? 0.2),
      color: rgb(...prim.stroke),
      dashArray: prim.dashMm?.map(mmToPt),
    });
  } else if (prim.type === 'circle') {
    const c = pt(prim.cx, prim.cy);
    page.drawCircle({
      x: c.x, y: c.y, size: mmToPt(prim.r),
      color: prim.fill ? rgb(...prim.fill) : undefined,
      borderColor: prim.stroke ? rgb(...prim.stroke) : undefined,
      borderWidth: prim.strokeMm ? mmToPt(prim.strokeMm) : 0,
    });
  } else if (prim.type === 'image') {
    const img = images?.get(prim.src);
    if (!img) return;
    // The frame is the area; the picture keeps its own shape and is cropped to
    // it, which is what the preview's `slice` does. A covering picture is
    // bigger than its frame, so the frame (or the narrower `clip`, where the
    // gutter cut one) is pushed as a clipping path first -- otherwise the
    // overflow would print over whatever sits beside it.
    const box = { w: mmToPt(prim.w), h: mmToPt(prim.h) };
    const k = prim.fit === 'contain'
      ? Math.min(box.w / img.width, box.h / img.height)
      : Math.max(box.w / img.width, box.h / img.height);
    const w = img.width * k, h = img.height * k;
    const origin = pt(prim.x, prim.y + prim.h);
    const c = prim.clip ?? { x: prim.x, y: prim.y, w: prim.w, h: prim.h };
    const lo = pt(c.x, c.y + c.h), hi = pt(c.x + c.w, c.y);
    page.pushOperators(
      pushGraphicsState(),
      moveTo(lo.x, lo.y), lineTo(hi.x, lo.y), lineTo(hi.x, hi.y), lineTo(lo.x, hi.y),
      closePath(), clip(), endPath(),
    );
    page.drawImage(img, {
      x: origin.x + (box.w - w) / 2,
      y: origin.y + (box.h - h) / 2,
      width: w,
      height: h,
      opacity: prim.opacity,
    });
    page.pushOperators(popGraphicsState());
  } else {
    // A character the subset does not carry has no glyph to draw, so it is
    // dropped rather than left to come out as a blank box.
    const safe = [...prim.text].filter(c => pf.chars.includes(c)).join('');
    if (!safe) return;
    const width = pf.font.widthOfTextAtSize(safe, prim.sizePt);
    const dx = prim.align === 'center' ? -width / 2 : prim.align === 'right' ? -width : 0;
    const at = pt(prim.x, prim.y);
    const turned = prim.rotateDeg === 90;
    page.drawText(safe, {
      // The alignment offset runs along the text, which a quarter turn puts
      // on the other axis.
      x: turned ? at.x : at.x + dx,
      y: turned ? at.y + dx : at.y,
      size: prim.sizePt,
      font: pf.font,
      rotate: degrees(turned ? 90 : 0),
      color: prim.color ? rgb(...prim.color) : rgb(0, 0, 0),
    });
  }
}

interface HostDownloads {
  save(request: { filename: string; data: Blob }): Promise<unknown>;
}

// A published preview runs in a sandboxed frame, where clicking an anchor is
// ignored and the host offers its own save prompt instead. Everywhere else
// this resolves to nothing and the ordinary download runs.
async function hostDownloads(): Promise<HostDownloads | null> {
  try {
    const use = (window as { claude?: { use?: (n: string) => Promise<unknown> } }).claude?.use;
    return use ? ((await use('downloads')) as HostDownloads | null) : null;
  } catch {
    return null;
  }
}

export async function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });

  const host = await hostDownloads();
  if (host) {
    // A rejection here is the viewer declining, so there is nothing to retry.
    await host.save({ filename, data: blob }).catch(() => {});
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
