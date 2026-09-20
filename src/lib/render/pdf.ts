import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, degrees } from 'pdf-lib';
import type { Page, Primitive } from '../draw';
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
    // Pages are built in reading space, but what gets printed is the physical
    // punched sheet, so a landscape page is given a quarter turn here. The
    // sheet stays portrait and its holes stay on the long edge.
    const page = doc.addPage([mmToPt(p.sheet.widthMm), mmToPt(p.sheet.heightMm)]);
    for (const prim of p.primitives) drawPrimitive(page, prim, p.sheet, font);
  }

  return doc.save();
}

function drawPrimitive(page: PDFPage, prim: Primitive, sheet: Page['sheet'], font: PDFFont) {
  const turned = sheet.rotation === 90;
  // Reading space has a top-left origin; PDF has a bottom-left one. On a turned
  // sheet the reading x-axis runs up the sheet and the reading y-axis across it.
  const pt = (x: number, y: number) =>
    turned
      ? { x: mmToPt(y), y: mmToPt(x) }
      : { x: mmToPt(x), y: mmToPt(sheet.heightMm - y) };

  if (prim.type === 'rect') {
    const origin = turned ? pt(prim.x, prim.y) : pt(prim.x, prim.y + prim.h);
    page.drawRectangle({
      x: origin.x, y: origin.y,
      width: mmToPt(turned ? prim.h : prim.w),
      height: mmToPt(turned ? prim.w : prim.h),
      color: prim.fill ? rgb(...prim.fill) : undefined,
      borderColor: prim.stroke ? rgb(...prim.stroke) : undefined,
      borderWidth: prim.strokeMm ? mmToPt(prim.strokeMm) : 0,
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
    // Strip non-WinAnsi characters so Helvetica does not throw. Follow-up:
    // embed a CJK-capable font via fontkit.
    const safe = prim.text.replace(/[^\x20-\x7E]/g, '');
    const width = font.widthOfTextAtSize(safe, prim.sizePt);
    const dx = prim.align === 'center' ? -width / 2 : prim.align === 'right' ? -width : 0;
    const at = pt(prim.x, prim.y);
    page.drawText(safe, {
      // dx runs along the reading x-axis, which the turn maps onto PDF +Y.
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
