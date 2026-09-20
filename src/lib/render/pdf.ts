import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { Page } from '../draw';
import { mmToPt } from '../sizes';

// Renders `pages` to a PDF at exact mm dimensions. Guides are omitted.
// NOTE: MVP uses Helvetica for maximum compatibility. Non-ASCII text (i.e.
// Japanese habit names) will not render correctly here — a proper CJK font
// (subsetted via @pdf-lib/fontkit) is a follow-up.
export async function pagesToPdf(pages: Page[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const p of pages) {
    const wPt = mmToPt(p.widthMm);
    const hPt = mmToPt(p.heightMm);
    const page = doc.addPage([wPt, hPt]);
    for (const prim of p.primitives) drawPrimitive(page, prim, hPt, font);
  }

  return doc.save();
}

function drawPrimitive(page: PDFPage, prim: any, hPt: number, font: PDFFont) {
  if (prim.type === 'rect') {
    const x = mmToPt(prim.x);
    const y = hPt - mmToPt(prim.y + prim.h);
    const w = mmToPt(prim.w);
    const h = mmToPt(prim.h);
    page.drawRectangle({
      x, y, width: w, height: h,
      color: prim.fill ? rgb(prim.fill[0], prim.fill[1], prim.fill[2]) : undefined,
      borderColor: prim.stroke ? rgb(prim.stroke[0], prim.stroke[1], prim.stroke[2]) : undefined,
      borderWidth: prim.strokeMm ? mmToPt(prim.strokeMm) : 0,
    });
  } else if (prim.type === 'line') {
    page.drawLine({
      start: { x: mmToPt(prim.x1), y: hPt - mmToPt(prim.y1) },
      end:   { x: mmToPt(prim.x2), y: hPt - mmToPt(prim.y2) },
      thickness: mmToPt(prim.strokeMm ?? 0.2),
      color: rgb(prim.stroke[0], prim.stroke[1], prim.stroke[2]),
    });
  } else if (prim.type === 'text') {
    // Strip non-WinAnsi characters so Helvetica does not throw. Follow-up:
    // embed a CJK-capable font via fontkit.
    const safe = prim.text.replace(/[^\x20-\x7E]/g, '');
    const size = prim.sizePt;
    const width = font.widthOfTextAtSize(safe, size);
    let dx = 0;
    if (prim.align === 'center') dx = -width / 2;
    else if (prim.align === 'right') dx = -width;
    const x = mmToPt(prim.x) + dx;
    const y = hPt - mmToPt(prim.y);
    page.drawText(safe, {
      x, y, size, font,
      color: prim.color ? rgb(prim.color[0], prim.color[1], prim.color[2]) : rgb(0,0,0),
    });
  }
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
