/** Browser-side image helpers: decode, downscale, enhance, grayscale, thumbnails. */

export async function fileToProcessedJpeg(
  file: File | Blob,
  opts: { maxDim?: number; quality?: number; enhance?: boolean; grayscale?: boolean } = {},
): Promise<Uint8Array> {
  const { maxDim = 2000, quality = 0.85, enhance = true, grayscale = false } = opts;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const filters: string[] = [];
  if (enhance) filters.push("contrast(1.15)", "brightness(1.08)", "saturate(1.05)");
  if (grayscale) filters.push("grayscale(1)");
  if (filters.length) ctx.filter = filters.join(" ");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), "image/jpeg", quality),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function makeThumbnail(bytes: Uint8Array, maxDim = 400): Promise<Uint8Array> {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
  return fileToProcessedJpeg(blob, { maxDim, quality: 0.7, enhance: false });
}

export function bytesToObjectUrl(bytes: Uint8Array, type = "image/jpeg"): string {
  return URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type }));
}

export function bytesToDataUrl(bytes: Uint8Array, type = "image/jpeg"): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function downloadBytes(bytes: Uint8Array, filename: string, type = "application/pdf") {
  const url = bytesToObjectUrl(bytes, type);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Share via the native share sheet when available, else download. */
export async function shareOrDownload(bytes: Uint8Array, filename: string, title: string) {
  const file = new File([bytes.buffer as ArrayBuffer], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // user cancelled
    }
  }
  downloadBytes(bytes, filename);
}
