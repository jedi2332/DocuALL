import { describe, it, expect } from "vitest";
import { cleanOcrText } from "@/lib/ocr";
import { sortFiles, DEFAULT_FOLDERS } from "@/lib/organize";

describe("on-device OCR text", () => {
  it("drops noise from a blank photo", () => {
    expect(cleanOcrText(" ~ | . \n\n ")).toBe("");
  });
  it("keeps real receipt text, tidied", () => {
    expect(cleanOcrText("RECEIPT   Total  $42.10\n\n\nThank you")).toBe("RECEIPT Total $42.10\nThank you");
  });
});

describe("scanned paper sorts by its read text", () => {
  const scan = (text: string) => ({ id: "s", name: "Scan 2026-11-10.pdf", path: "Scan 2026-11-10.pdf", size: 9, type: "application/pdf", lastModified: 0, hash: "s", text });
  it("a scanned receipt goes to Receipts & Tax", () => {
    const [s] = sortFiles([scan("INVOICE 0042\nRECEIPT of payment\nTotal 42.10")], DEFAULT_FOLDERS, [], []);
    expect(s!.folder).toBe("Receipts & Tax");
  });
  it("a scanned printed agreement goes to Documents", () => {
    const [s] = sortFiles([scan("RENTAL AGREEMENT between the parties")], DEFAULT_FOLDERS, [], []);
    expect(s!.folder).toBe("Documents");
  });
});
