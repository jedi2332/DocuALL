// pdfjs is browser-only; load it lazily so server rendering never evaluates it.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | undefined;
export function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

export interface RenderedPdfPage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Render every page of a PDF to JPEG data URLs (for display + field placement). */
export async function renderPdfPages(pdfBytes: Uint8Array, maxDim = 1400): Promise<RenderedPdfPage[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: pdfBytes.slice() });
  const pdf = await task.promise;
  const out: RenderedPdfPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxDim / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height });
  }
  await task.destroy();
  return out;
}

/** Render just the first page as a small thumbnail. */
export async function renderPdfThumbnail(pdfBytes: Uint8Array, maxDim = 400): Promise<Uint8Array> {
  const [first] = await renderPdfPages(pdfBytes, maxDim);
  if (!first) throw new Error("PDF has no pages");
  const res = await fetch(first.dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

/** Reads the text layer of the first pages, entirely in the browser. Empty on failure. */
export async function extractPdfText(pdfBytes: Uint8Array, maxPages = 5, maxChars = 20000): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
    let out = "";
    for (let i = 1; i <= Math.min(doc.numPages, maxPages) && out.length < maxChars; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += " " + content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    }
    await doc.cleanup();
    return out.slice(0, maxChars);
  } catch {
    return "";
  }
}
