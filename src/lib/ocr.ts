/**
 * On-device OCR (browser only). Recognition runs in a Web Worker on this device;
 * the image never leaves it. Only the English language model is downloaded once and cached.
 */
type Worker = { recognize: (img: Blob | string) => Promise<{ data: { text: string } }> };
let workerP: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerP) {
    workerP = import("tesseract.js")
      .then((t) => t.createWorker("eng") as unknown as Promise<Worker>)
      .catch((e) => {
        workerP = null;
        throw e;
      });
  }
  return workerP;
}

/** Tidies OCR output; returns "" when there's too little real text to trust (blank photo, noise). */
export function cleanOcrText(raw: string, maxChars = 20000): string {
  const t = raw.replace(/[^\S\n]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  const letters = (t.match(/[a-z0-9]/gi) || []).length;
  return letters >= 8 ? t.slice(0, maxChars) : "";
}

export async function ocrImage(img: Blob | string): Promise<string> {
  if (typeof window === "undefined") return "";
  try {
    const w = await getWorker();
    const { data } = await w.recognize(img);
    return cleanOcrText(data.text || "");
  } catch {
    return "";
  }
}

/** OCR the first pages of a PDF that has no text layer (e.g. a camera scan). */
export async function ocrPdf(pdfBytes: Uint8Array, maxPages = 3): Promise<string> {
  const { renderPdfPages } = await import("./pdf-render");
  const pages = await renderPdfPages(pdfBytes, 1800);
  let out = "";
  for (const p of pages.slice(0, maxPages)) {
    out += "\n" + (await ocrImage(p.dataUrl));
  }
  return cleanOcrText(out);
}
