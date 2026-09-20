import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, degrees } from 'pdf-lib';
import type { Primitive } from '../draw';
import { mmToPt } from '../sizes';
import type { SheetContent } from './impose';

// Pages arrive already flattened onto the paper they print on — either the
// punched sheet itself, or a sheet of A4 with refills imposed on it — so this
// only has to turn millimetres into points.
//
// NOTE: Helvetica for now, so Japanese text does not come out. A CJK font
// subset via @pdf-lib/fontkit is the follow-up.
export async function sheetsToPdf(sheets: SheetContent[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const sheet of sheets) {
    const page = doc.addPage([mmToPt(sheet.widthMm), mmToPt(sheet.heightMm)]);
    for (const prim of sheet.primitives) drawPrimitive(page, prim, sheet.heightMm, font);
  }
  return doc.save();
}

function drawPrimitive(page: PDFPage, prim: Primitive, sheetH: number, font: PDFFont) {
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
  } else {
    // Strip non-WinAnsi characters so Helvetica does not throw.
    const safe = prim.text.replace(/[^\x20-\x7E]/g, '');
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, prim.sizePt);
    const dx = prim.align === 'center' ? -width / 2 : prim.align === 'right' ? -width : 0;
    const at = pt(prim.x, prim.y);
    const turned = prim.rotateDeg === 90;
    page.drawText(safe, {
      // The alignment offset runs along the text, which a quarter turn puts
      // on the other axis.
      x: turned ? at.x : at.x + dx,
      y: turned ? at.y + dx : at.y,
      size: prim.sizePt,
      font,
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
