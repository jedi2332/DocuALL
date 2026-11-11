import { describe, it, expect } from "vitest";
import { sortFiles, DEFAULT_FOLDERS, UNSORTED, type OrgFile } from "@/lib/organize";

const f = (p: Partial<OrgFile> & { id: string; name: string }): OrgFile => ({
  path: p.name, size: 100, type: "image/jpeg", lastModified: 0, hash: p.id, ...p,
});

describe("organize sorting", () => {
  it("locked vault files stay in their project, never re-sorted", () => {
    const file = f({ id: "a", name: "receipt.jpg", hash: "h1" });
    const [s] = sortFiles([file], DEFAULT_FOLDERS, [], [
      { id: "v", name: "Caleb Commercials & Ads", locked: true, files: [{ path: "receipt.jpg", name: "receipt.jpg", size: 100, hash: "h1" }] },
    ]);
    expect(s!.confidence).toBe("locked");
    expect(s!.folder).toBe("Caleb Commercials & Ads");
  });

  it("file type alone is not enough — stays Unsorted", () => {
    const [s] = sortFiles([f({ id: "a", name: "IMG_4821.jpg" })], DEFAULT_FOLDERS, [], []);
    expect(s!.folder).toBe(UNSORTED);
  });

  it("screenshot dimensions alone are not enough", () => {
    const [s] = sortFiles([f({ id: "a", name: "IMG_1.png", width: 1080, height: 2340 })], DEFAULT_FOLDERS, [], []);
    expect(s!.folder).toBe(UNSORTED);
  });

  it("time cluster alone cannot place a file with no other clue", () => {
    const out = sortFiles(
      [f({ id: "a", name: "invoice.pdf", type: "application/pdf" }), f({ id: "b", name: "zzz.bin", type: "" })],
      DEFAULT_FOLDERS, [], [],
    );
    expect(out[0]!.folder).toBe("Receipts & Tax");
    expect(out[1]!.folder).toBe(UNSORTED);
  });

  it("confirmed rule wins", () => {
    const [s] = sortFiles([f({ id: "a", name: "elevenlabs_clip.mp3", type: "audio/mpeg" })], DEFAULT_FOLDERS,
      [{ id: "r", pattern: "elevenlabs", folder: "Caleb Commercials & Ads" }], []);
    expect(s!.folder).toBe("Caleb Commercials & Ads");
  });

  it("exact duplicates keep the oldest copy", () => {
    const out = sortFiles(
      [f({ id: "new", name: "a.jpg", hash: "same", lastModified: 50 }), f({ id: "old", name: "b.jpg", hash: "same", lastModified: 1 })],
      DEFAULT_FOLDERS, [], [],
    );
    expect(out[0]!.duplicateOf).toBe("old");
    expect(out[1]!.duplicateOf).toBeUndefined();
  });
});

import { planZipPaths } from "@/lib/organize";

describe("zip paths", () => {
  it("two different files named IMG_001.jpg both survive", () => {
    const out = planZipPaths([
      { path: "a/IMG_001.jpg", name: "IMG_001.jpg", folder: "Photos", locked: false },
      { path: "b/IMG_001.jpg", name: "IMG_001.jpg", folder: "Photos", locked: false },
    ]);
    expect(out).toEqual(["Photos/IMG_001.jpg", "Photos/IMG_001 (2).jpg"]);
  });

  it("locked files keep their full nested path", () => {
    const out = planZipPaths([{ path: "Reel14/media/clip.mp4", name: "clip.mp4", folder: "Caleb", locked: true }]);
    expect(out).toEqual(["Caleb/Reel14/media/clip.mp4"]);
  });

  it("a locked exact duplicate keeps its protected path", () => {
    const out = planZipPaths([{ path: "Reel14/a.jpg", name: "a.jpg", folder: "Caleb", locked: true, duplicateOfName: "x.jpg" }]);
    expect(out).toEqual(["Caleb/Reel14/a.jpg"]);
  });
});

describe("locked duplicates in sorting", () => {
  it("both vault copies stay locked; no duplicate flag", () => {
    const vault = { id: "v", name: "Caleb", locked: true, files: [{ path: "a.jpg", name: "a.jpg", size: 100, hash: "same" }, { path: "b.jpg", name: "b.jpg", size: 100, hash: "same" }] };
    const out = sortFiles([f({ id: "a", name: "a.jpg", hash: "same" }), f({ id: "b", name: "b.jpg", hash: "same" })], DEFAULT_FOLDERS, [], [vault]);
    expect(out.every((s) => s.confidence === "locked" && !s.duplicateOf)).toBe(true);
  });
});

describe("copies of vault files outside the vault", () => {
  it("are flagged as duplicates, not locked", () => {
    const vault = { id: "v", name: "Caleb", locked: true, files: [{ path: "Reel/a.jpg", name: "a.jpg", size: 100, hash: "h" }] };
    const out = sortFiles(
      [f({ id: "in", name: "a.jpg", path: "Reel/a.jpg", hash: "h" }), f({ id: "out", name: "stray.jpg", path: "loose/stray.jpg", hash: "h" })],
      DEFAULT_FOLDERS, [], [vault],
    );
    expect(out[0]!.confidence).toBe("locked");
    expect(out[1]!.confidence).not.toBe("locked");
    expect(out[1]!.duplicateOf).toBe("in");
  });
});
