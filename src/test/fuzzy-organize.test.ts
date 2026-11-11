import { describe, it, expect } from "vitest";
import { matchClue, normalize, editDistance, clueProblem } from "@/lib/fuzzy-match";
import { sortFiles, addAlias, editAlias, removeAlias, relatedGroups, DEFAULT_FOLDERS, UNSORTED, planZipPaths, type OrgFile, type OrgRule } from "@/lib/organize";

const f = (p: Partial<OrgFile> & { id: string; name: string }): OrgFile => ({
  path: p.name, size: 100, type: "application/pdf", lastModified: 0, hash: p.id, ...p,
});
const CC_FOLDER = { name: "Caleb Connection presentations", keywords: ["caleb connection", "investor deck"] };
const CC_RULE: OrgRule = { id: "r1", pattern: "Caleb Connection", folder: "Caleb Connection presentations" };
const folders = [...DEFAULT_FOLDERS, CC_FOLDER];

describe("normalizing and typo tolerance", () => {
  it("Caleb Connection matches Caleb Conecton investor deck", () => {
    const m = matchClue("Caleb Connection", "Caleb Conecton investor deck");
    expect(m).toMatchObject({ found: "caleb conecton", exact: false });
  });
  it("ignores case, punctuation, spacing, underscores and hyphens", () => {
    for (const n of ["CALEB_CONNECTION", "caleb-connection", "Caleb   Connection!!", "caleb.connection", "CalebConnection"]) {
      expect(normalize(n)).toBe("caleb connection");
      expect(matchClue("Caleb Connection", n)?.exact).toBe(true);
    }
  });
  it("tolerates one insertion, deletion and substitution", () => {
    expect(editDistance("connection", "connnection")).toBe(1);
    expect(editDistance("connection", "conection")).toBe(1);
    expect(editDistance("connection", "connectian")).toBe(1);
    expect(matchClue("Caleb Connection", "caleb connnection")).not.toBeNull();
    expect(matchClue("Caleb Connection", "caleb conection")).not.toBeNull();
    expect(matchClue("Caleb Connection", "caleb connectian")).not.toBeNull();
    expect(matchClue("receipts", "reciepts march")).not.toBeNull();
  });
  it("short words must be exact", () => {
    expect(matchClue("tax", "tex form")).toBeNull();
  });
});

describe("scoring with typo matches", () => {
  it("several agreeing clues make a strong match with a plain reason", () => {
    const [s] = sortFiles([f({ id: "a", name: "Caleb Conecton investor deck.pptx", type: "" })], folders, [CC_RULE], []);
    expect(s!.folder).toBe("Caleb Connection presentations");
    expect(s!.confidence).toBe("strong");
    expect(s!.summary).toContain("‘caleb conecton’");
    expect(s!.summary).toContain("‘investor deck’");
  });
  it("a single typo match alone stays Unsure but shows the possible folder", () => {
    const [s] = sortFiles([f({ id: "a", name: "Caleb Conecton.pdf" })], DEFAULT_FOLDERS, [CC_RULE], []);
    expect(s!.folder).toBe(UNSORTED);
    expect(s!.confidence).toBe("low");
    expect(s!.maybe).toBe("Caleb Connection presentations");
    expect(s!.summary).toMatch(/^Possible match for Caleb Connection presentations/);
    expect(s!.aliasCandidates?.[0]).toMatchObject({ clue: "Caleb Connection", found: "caleb conecton", ruleId: "r1" });
  });
  it("common words and unrelated documents do not match", () => {
    const out = sortFiles(
      [f({ id: "a", name: "connection settings.pdf" }), f({ id: "b", name: "Calendar connection.pdf" }), f({ id: "c", name: "deck photos.pdf" })],
      DEFAULT_FOLDERS, [CC_RULE, { id: "r2", pattern: "connection", folder: "Caleb Connection presentations" }], [],
    );
    for (const s of out) {
      expect(s.folder).not.toBe("Caleb Connection presentations");
      expect(s.maybe).not.toBe("Caleb Connection presentations");
    }
  });
  it("document text supports a match when the filename is vague", () => {
    const vague = f({ id: "a", name: "deck_v3.pdf", text: "Investor update — Caleb Connection, Q3 traction" });
    const [s] = sortFiles([vague], DEFAULT_FOLDERS, [CC_RULE], []);
    expect(s!.folder).toBe("Caleb Connection presentations");
    expect(s!.summary).toContain("document text mentions");
    const [none] = sortFiles([{ ...vague, text: "" }], DEFAULT_FOLDERS, [CC_RULE], []);
    expect(none!.folder).toBe(UNSORTED);
  });
});

describe("aliases", () => {
  it("can be created, edited and removed", () => {
    const add = addAlias([CC_RULE], { ruleId: "r1", clue: "Caleb Connection", folder: CC_RULE.folder }, "Caleb Conecton");
    expect(add.rules![0]!.aliases).toEqual(["Caleb Conecton"]);
    const [s] = sortFiles([f({ id: "a", name: "caleb conecton.pdf" })], DEFAULT_FOLDERS, add.rules!, []);
    expect(s!.confidence).toBe("strong");
    const ed = editAlias(add.rules!, "r1", 0, "Kaleb Connection");
    expect(ed.rules![0]!.aliases).toEqual(["Kaleb Connection"]);
    expect(removeAlias(ed.rules!, "r1", 0)[0]!.aliases).toEqual([]);
  });
  it("a folder clue alias becomes a new rule", () => {
    const res = addAlias([], { clue: "investor deck", folder: "X" }, "invester deck", () => "n1");
    expect(res.rules).toEqual([{ id: "n1", pattern: "investor deck", folder: "X", aliases: ["invester deck"] }]);
  });
  it("refuses an overly broad alias like ‘Connection’", () => {
    expect(addAlias([CC_RULE], { ruleId: "r1", clue: "Caleb Connection", folder: "x" }, "Connection").error).toBeTruthy();
    expect(editAlias([CC_RULE], "r1", 0, "deck").error).toBeTruthy();
    expect(clueProblem("Caleb")).toBeNull();
  });
});

describe("related groups", () => {
  it("groups by shared clue and similar titles without calling them versions", () => {
    const files = [
      f({ id: "a", name: "Caleb Connection investor deck v2.pdf" }),
      f({ id: "b", name: "Caleb Conecton investor deck final.pdf" }),
      f({ id: "c", name: "IMG_0001.jpg", type: "image/jpeg" }),
    ];
    const groups = relatedGroups(files, sortFiles(files, folders, [CC_RULE], []));
    expect(groups.some((g) => g.kind === "clue" && g.fileIds.includes("a") && g.fileIds.includes("b"))).toBe(true);
    const t = groups.find((g) => g.kind === "title")!;
    expect(t.fileIds.sort()).toEqual(["a", "b"]);
    expect(t.evidence).toMatch(/may be/);
    expect(groups.every((g) => !g.fileIds.includes("c"))).toBe(true);
  });
});

describe("existing safeguards still hold", () => {
  it("locked vault file isn't re-sorted even with a strong typo match", () => {
    const vault = { id: "v", name: "Reel", locked: true, files: [{ path: "Caleb Conecton investor deck.pdf", name: "x", size: 100, hash: "a" }] };
    const [s] = sortFiles([f({ id: "a", name: "Caleb Conecton investor deck.pdf" })], folders, [CC_RULE], [vault]);
    expect(s!.confidence).toBe("locked");
    expect(s!.folder).toBe("Reel");
  });
  it("exact duplicates still flagged and both names survive in the ZIP", () => {
    const out = sortFiles([f({ id: "n", name: "deck.pdf", hash: "h", lastModified: 9 }), f({ id: "o", name: "deck.pdf", path: "b/deck.pdf", hash: "h", lastModified: 1 })], folders, [], []);
    expect(out[0]!.duplicateOf).toBe("o");
    expect(planZipPaths([
      { path: "deck.pdf", name: "deck.pdf", folder: "Unsorted", locked: false, duplicateOfName: "b/deck.pdf" },
      { path: "deck.pdf", name: "deck.pdf", folder: "Duplicates to review", locked: false },
    ])).toEqual(["Duplicates to review/deck.pdf", "Duplicates to review/deck (2).pdf"]);
  });
});
