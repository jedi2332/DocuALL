/**
 * Pure rules for files Android hands to DocuALL (Open with / Share).
 * No I/O here so the rules are unit-tested.
 */

/** 25 MB per file. Bigger files are refused instead of freezing the phone. */
export const MAX_INCOMING_BYTES = 25 * 1024 * 1024;

/** The only formats DocuALL can actually import. Must match AndroidManifest intent filters. */
export const SUPPORTED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

export type IncomingKind = "pdf" | "image";

export interface IncomingFileMeta {
  /** Display name from the sending app; may be missing. */
  name?: string | null;
  /** MIME type reported by the sending app; may be missing or wrong (e.g. application/octet-stream). */
  mimeType?: string | null;
  size?: number | null;
  /** Native copy status. */
  error?: string | null;
}

export type IncomingVerdict =
  | { ok: true; kind: IncomingKind; name: string }
  | { ok: false; name: string; reason: string };

const EXT_KIND: Record<string, IncomingKind> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
};

function mimeKind(mime: string | null | undefined): IncomingKind | null {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (m === "application/pdf") return "pdf";
  if (m === "image/jpeg" || m === "image/jpg" || m === "image/png" || m === "image/webp") return "image";
  return null;
}

function extKind(name: string): IncomingKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? (EXT_KIND[ext] ?? null) : null;
}

/** Identify a file from its first bytes. This is the final authority. */
export function sniffKind(bytes: Uint8Array): IncomingKind | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf"; // %PDF-
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image"; // JPEG
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image"; // PNG
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return "image"; // RIFF....WEBP
  return null;
}

/** Strip path parts and control characters; supply a name when the sender gave none. */
export function safeFileName(name: string | null | undefined, kind: IncomingKind | null, index = 0): string {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]+/g, "")
    .trim()
    .slice(0, 120);
  if (base && base !== "." && base !== "..") return base;
  const n = index + 1;
  return kind === "image" ? `Attachment ${n}.jpg` : `Attachment ${n}.pdf`;
}

/** Decide whether one incoming file can be imported. Pass the file's first bytes when available. */
export function classifyIncoming(meta: IncomingFileMeta, head?: Uint8Array, index = 0): IncomingVerdict {
  const claimed = mimeKind(meta.mimeType) ?? extKind(meta.name ?? "");
  const name = safeFileName(meta.name, claimed, index);
  if (meta.error === "too_large" || (meta.size ?? 0) > MAX_INCOMING_BYTES) {
    return { ok: false, name, reason: "Too large (25 MB limit)" };
  }
  if (meta.error) return { ok: false, name, reason: "Couldn't be read from the sending app" };
  if (!claimed) return { ok: false, name, reason: "Not a PDF or photo DocuALL can open" };
  if (head) {
    if (head.length === 0) return { ok: false, name, reason: "File is empty" };
    const actual = sniffKind(head);
    if (!actual) return { ok: false, name, reason: "File is damaged or not really a PDF or photo" };
    return { ok: true, kind: actual, name };
  }
  return { ok: true, kind: claimed, name };
}

export interface ImportPlanItem<T> {
  kind: IncomingKind;
  title: string;
  files: T[];
}

/**
 * Each PDF becomes its own document. All photos in one share become one
 * multi-page document (matches the in-app "Import photos" behaviour).
 */
export function planImports<T extends { verdict: IncomingVerdict }>(items: T[]): {
  imports: ImportPlanItem<T>[];
  rejected: T[];
} {
  const imports: ImportPlanItem<T>[] = [];
  const rejected: T[] = [];
  const images: T[] = [];
  for (const it of items) {
    if (!it.verdict.ok) rejected.push(it);
    else if (it.verdict.kind === "pdf")
      imports.push({ kind: "pdf", title: it.verdict.name.replace(/\.pdf$/i, "").trim() || "Attachment", files: [it] });
    else images.push(it);
  }
  if (images.length) {
    const first = images[0]!.verdict.name.replace(/\.[a-z0-9]+$/i, "").trim();
    imports.push({ kind: "image", title: images.length === 1 ? first || "Photo" : `${first || "Photos"} (+${images.length - 1})`, files: images });
  }
  return { imports, rejected };
}

/** Filename for a signed PDF going back out through the share sheet. */
export function signedShareFileName(title: string): string {
  const clean = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ") || "document";
  return `${clean}.pdf`;
}
