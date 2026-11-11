import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { classifyIncoming, planImports, MAX_INCOMING_BYTES, SUPPORTED_MIME_TYPES, signedShareFileName } from "@/lib/android-intake";
import { shareSignedPdfAndroid, base64ToBytes } from "@/lib/android-bridge";

const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const ZIPB = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const item = (meta: Parameters<typeof classifyIncoming>[0], head?: Uint8Array, i = 0) => ({ verdict: classifyIncoming(meta, head, i) });

describe("Android incoming files", () => {
  it("opens a PDF from an email-style content:// attachment", () => {
    // Gmail: content://com.google.android.gm.sapi/.../attachment, reports application/pdf
    const v = classifyIncoming({ name: "Lease agreement.pdf", mimeType: "application/pdf", size: 120_000 }, PDF);
    expect(v).toEqual({ ok: true, kind: "pdf", name: "Lease agreement.pdf" });
    const plan = planImports([{ verdict: v }]);
    expect(plan.imports).toHaveLength(1);
    expect(plan.imports[0]!.title).toBe("Lease agreement");
  });

  it("accepts a PDF whose sender reports octet-stream, by its contents", () => {
    expect(classifyIncoming({ name: "scan.pdf", mimeType: "application/octet-stream" }, PDF)).toMatchObject({ ok: true, kind: "pdf" });
  });

  it("names an attachment with no filename", () => {
    expect(classifyIncoming({ name: null, mimeType: "application/pdf" }, PDF, 2)).toMatchObject({ ok: true, name: "Attachment 3.pdf" });
  });

  it("sends one file", () => {
    const plan = planImports([item({ name: "receipt.jpg", mimeType: "image/jpeg" }, JPG)]);
    expect(plan.imports).toEqual([expect.objectContaining({ kind: "image", title: "receipt" })]);
    expect(plan.rejected).toHaveLength(0);
  });

  it("sends several files: each PDF its own document, photos combined", () => {
    const plan = planImports([
      item({ name: "a.pdf", mimeType: "application/pdf" }, PDF),
      item({ name: "b.pdf", mimeType: "application/pdf" }, PDF),
      item({ name: "p1.jpg", mimeType: "image/jpeg" }, JPG),
      item({ name: "p2.png", mimeType: "image/png" }, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ]);
    expect(plan.imports.map((i) => [i.kind, i.files.length])).toEqual([["pdf", 1], ["pdf", 1], ["image", 2]]);
  });

  it("rejects unsupported types, fake PDFs, empty, unreadable and too-large files", () => {
    expect(classifyIncoming({ name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }).ok).toBe(false);
    expect(classifyIncoming({ name: "photo.heic", mimeType: "image/heic" }).ok).toBe(false);
    expect(classifyIncoming({ name: "evil.pdf", mimeType: "application/pdf" }, ZIPB).ok).toBe(false);
    expect(classifyIncoming({ name: "x.pdf", mimeType: "application/pdf" }, new Uint8Array()).ok).toBe(false);
    expect(classifyIncoming({ name: "x.pdf", mimeType: "application/pdf", error: "unreadable" }).ok).toBe(false);
    expect(classifyIncoming({ name: "big.pdf", mimeType: "application/pdf", size: MAX_INCOMING_BYTES + 1 })).toMatchObject({ ok: false, reason: "Too large (25 MB limit)" });
    const plan = planImports([item({ name: "a.pdf", mimeType: "application/pdf" }, PDF), item({ name: "v.mp4", mimeType: "video/mp4" })]);
    expect(plan.imports).toHaveLength(1);
    expect(plan.rejected).toHaveLength(1);
  });

  it("strips path tricks from filenames", () => {
    expect(classifyIncoming({ name: "../../etc/passwd.pdf", mimeType: "application/pdf" }, PDF)).toMatchObject({ name: "passwd.pdf" });
  });

  it("Android manifest claims exactly the supported types for VIEW, SEND and SEND_MULTIPLE", () => {
    const xml = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    for (const a of ["VIEW", "SEND", "SEND_MULTIPLE"]) expect(xml).toContain(`android.intent.action.${a}"`);
    const claimed = [...new Set([...xml.matchAll(/android:mimeType="([^"]+)"/g)].map((m) => m[1]))].sort();
    expect(claimed).toEqual([...SUPPORTED_MIME_TYPES].sort());
    expect(xml).not.toMatch(/STORAGE|MANAGE_EXTERNAL/);
  });
});

describe("returning the signed PDF through the Android share sheet", () => {
  it("writes the PDF to the app cache and opens the share sheet with it", async () => {
    const writeFile = vi.fn(async () => ({ uri: "file:///data/user/0/com.docuall.app/cache/outgoing/Lease signed.pdf" }));
    const share = vi.fn(async () => ({}));
    const bytes = new TextEncoder().encode("%PDF-1.7 signed");
    const ok = await shareSignedPdfAndroid(bytes, "Lease signed", { writeFile, share });
    expect(ok).toBe(true);
    const w = (writeFile.mock.calls[0] as unknown as [unknown])[0] as { path: string; data: string; directory: string };
    expect(w.path).toBe("outgoing/Lease signed.pdf");
    expect(w.directory).toBe("CACHE");
    expect(Array.from(base64ToBytes(w.data))).toEqual(Array.from(bytes));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: ["file:///data/user/0/com.docuall.app/cache/outgoing/Lease signed.pdf"] }));
  });

  it("treats backing out of the share sheet as a cancel, not an error", async () => {
    const ok = await shareSignedPdfAndroid(new Uint8Array([1]), "x", {
      writeFile: async () => ({ uri: "u" }),
      share: async () => { throw new Error("Share canceled"); },
    });
    expect(ok).toBe(false);
  });

  it("makes a clean filename", () => {
    expect(signedShareFileName("Lease: final/v2")).toBe("Lease finalv2.pdf");
  });
});
