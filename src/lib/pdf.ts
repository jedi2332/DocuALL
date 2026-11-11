import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ResolvedField } from "./docuall-types";

/** Build a PDF from a list of JPEG page images (one image per page, full bleed). */
export async function buildPdfFromImages(pages: Uint8Array[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const bytes of pages) {
    const img = await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return doc.save();
}

/**
 * Stamp resolved fields onto a PDF as overlays. Works for both scanned
 * documents (whose PDF was built from page images) and imported PDFs.
 * Coordinates are top-left anchored fractions, matching the original app.
 */
export async function stampFieldsOnPdf(pdfBytes: Uint8Array, fields: ResolvedField[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const pages = doc.getPages();

  for (const f of fields) {
    const page = pages[f.page_index];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = f.x * pw;
    const yTop = f.y * ph;

    if ((f.type === "signature" || f.type === "initials") && f.imageBytes) {
      const img = await doc.embedPng(f.imageBytes);
      const w = f.w * pw;
      const h = w * (img.height / img.width);
      page.drawImage(img, { x, y: ph - yTop - h, width: w, height: h });
    } else {
      const text = f.text ?? "";
      if (!text.trim()) continue;
      const size = Math.max(6, f.w * ph);
      const usedFont = f.type === "date" ? oblique : font;
      page.drawText(text, {
        x,
        y: ph - yTop - size,
        size,
        font: usedFont,
        color: rgb(0.08, 0.09, 0.14),
      });
    }
  }
  return doc.save();
}

export async function pdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}
