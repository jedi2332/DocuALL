/** Smart Clean & Organize — pure sorting logic (no I/O), so it can be tested. */
import { clueProblem, matchClue, normalize, textContains, titleKey, tokenSimilarity, tokens } from "./fuzzy-match";

export interface OrgFile {
  id: string;
  path: string; // relative path incl. name
  name: string;
  size: number;
  type: string; // mime
  lastModified: number;
  hash: string; // sha-256 hex
  width?: number;
  height?: number;
  /** Searchable text read on-device from PDFs/presentations. Never uploaded. */
  text?: string;
}

export interface OrgFolder {
  name: string;
  keywords: string[];
  kind?: "document" | "image" | "audio" | "video" | "screenshot";
}

/** A user-confirmed rule: file name/path containing `pattern` goes to `folder`. */
export interface OrgRule {
  id: string;
  pattern: string;
  folder: string;
  /** Spellings the user confirmed mean the same thing, e.g. "Caleb Conecton". */
  aliases?: string[];
}

export interface VaultFile {
  path: string;
  name: string;
  size: number;
  hash: string;
}

export interface VaultProject {
  id: string;
  name: string;
  locked: boolean;
  isCapCut?: boolean;
  files: VaultFile[];
}

export type Confidence = "strong" | "low" | "locked";

export interface Suggestion {
  fileId: string;
  folder: string;
  confidence: Confidence;
  reasons: string[];
  vaultId?: string | undefined;
  duplicateOf?: string | undefined; // fileId of the copy that is kept
  /** Best folder when the evidence is not strong enough to preassign. */
  maybe?: string | undefined;
  /** Plain-language summary of the main clue. */
  summary?: string | undefined;
  /** Typos the user could teach as aliases. */
  aliasCandidates?: AliasCandidate[] | undefined;
  /** Clues that matched (for related-document groups). */
  clues?: string[] | undefined;
}

export interface AliasCandidate {
  clue: string;
  found: string;
  folder: string;
  ruleId?: string | undefined;
}

interface Hit { clue: string; found: string; how: "exact" | "fuzzy" | "text"; ruleId?: string | undefined }

export const UNSORTED = "Unsorted";
interface Score { score: number; reasons: string[]; hits: Hit[] }
export const STRONG_THRESHOLD = 3;
const CLUSTER_WINDOW_MS = 10 * 60 * 1000;

export const DEFAULT_FOLDERS: OrgFolder[] = [
  { name: "Documents", kind: "document", keywords: ["contract", "agreement", "form", "letter", "signed", "lease"] },
  { name: "Receipts & Tax", keywords: ["receipt", "invoice", "tax", "w2", "w-2", "1099", "statement", "bill"] },
  { name: "Screenshots", kind: "screenshot", keywords: ["screenshot", "screen shot", "screen_"] },
  { name: "Photos", kind: "image", keywords: ["dsc", "pxl_", "photo"] },
  { name: "Audio & Voice", kind: "audio", keywords: ["voice", "recording", "elevenlabs", "audio"] },
  { name: "Video", kind: "video", keywords: ["capcut", "reel", "vid_", "export"] },
];

export function fileKind(f: Pick<OrgFile, "type" | "name">): OrgFolder["kind"] | undefined {
  const t = f.type;
  const n = f.name.toLowerCase();
  if (t === "application/pdf" || /\.(pdf|docx?|txt|rtf|odt|xlsx?|csv|pptx?|odp|key)$/.test(n)) return "document";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg)$/.test(n)) return "audio";
  if (t.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/.test(n)) return "video";
  return undefined;
}

/** Phone-screen proportions (tall ~19.5:9 / 16:9). A weak clue on its own. */
export function looksLikeScreenshotSize(f: Pick<OrgFile, "width" | "height">): boolean {
  if (!f.width || !f.height) return false;
  const r = Math.max(f.width, f.height) / Math.min(f.width, f.height);
  return r >= 1.75 && r <= 2.4;
}

function vaultMatch(f: OrgFile, vaults: VaultProject[]): VaultProject | undefined {
  return vaults.find(
    (v) => v.locked && v.files.some((vf) => vf.path === f.path && (vf.hash === f.hash || vf.size === f.size)),
  );
}

export function sortFiles(
  files: OrgFile[],
  folders: OrgFolder[],
  rules: OrgRule[],
  vaults: VaultProject[],
): Suggestion[] {
  // 1. Exact duplicates: identical bytes. Keep a vault copy if any, else the oldest.
  const byHash = new Map<string, OrgFile[]>();
  for (const f of files) byHash.set(f.hash, [...(byHash.get(f.hash) ?? []), f]);
  const keptFor = new Map<string, string>();
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const keep =
      group.find((f) => vaultMatch(f, vaults)) ?? [...group].sort((a, b) => a.lastModified - b.lastModified)[0]!;
    for (const f of group) if (f.id !== keep.id) keptFor.set(f.id, keep.id);
  }

  // A copy of a protected file found elsewhere is a duplicate, not part of the vault.
  const protectedHashes = new Set(vaults.filter((v) => v.locked).flatMap((v) => v.files.map((vf) => vf.hash)));

  // 2. Score each file against each folder.
  const first = new Map<string, Suggestion>();
  const scores = new Map<string, Map<string, Score>>();
  for (const f of files) {
    const vault = vaultMatch(f, vaults);
    if (vault) {
      first.set(f.id, { fileId: f.id, folder: vault.name, confidence: "locked", vaultId: vault.id, reasons: [`Protected in vault “${vault.name}”`] });
      continue;
    }
    const hay = f.path.toLowerCase();
    const nameText = f.path.replace(/\.[^./]+$/, "");
    const kind = fileKind(f);
    const s = new Map<string, Score>();
    const entry = (folder: string) => {
      const cur = s.get(folder) ?? { score: 0, reasons: [], hits: [] };
      s.set(folder, cur);
      return cur;
    };
    const add = (folder: string, pts: number, why: string) => {
      const cur = entry(folder);
      cur.score += pts;
      cur.reasons.push(why);
    };
    for (const r of rules) {
      if (!r.pattern) continue;
      const spellings = [r.pattern, ...(r.aliases ?? [])];
      // Legacy substring rules keep working; aliases/patterns also match by words with typo tolerance.
      const sub = spellings.find((p) => hay.includes(p.toLowerCase()) && !clueProblem(p));
      const m = sub ? { clue: sub, found: sub, exact: true } : spellings.map((p) => matchClue(p, nameText)).find(Boolean);
      if (m && m.exact) {
        add(r.folder, 4, m.clue === r.pattern ? `Your rule: “${r.pattern}”` : `Your alias “${m.clue}” for “${r.pattern}”`);
        entry(r.folder).hits.push({ clue: r.pattern, found: m.found, how: "exact", ruleId: r.id });
      } else if (m) {
        add(r.folder, 2, `Close spelling of your rule “${r.pattern}”: “${m.found}”`);
        entry(r.folder).hits.push({ clue: r.pattern, found: m.found, how: "fuzzy", ruleId: r.id });
      } else if (f.text && spellings.some((p) => textContains(p, f.text!))) {
        add(r.folder, 3, `Document text mentions “${r.pattern}”`);
        entry(r.folder).hits.push({ clue: r.pattern, found: r.pattern, how: "text", ruleId: r.id });
      }
    }
    for (const folder of folders) {
      let nameHits = 0;
      let textHits = 0;
      for (const k of folder.keywords) {
        if (!k) continue;
        const generic = !!clueProblem(k);
        let hit: Hit | undefined;
        if (hay.includes(k.toLowerCase())) hit = { clue: k, found: k, how: "exact" };
        else if (!generic) {
          const m = matchClue(k, nameText);
          if (m) hit = { clue: k, found: m.found, how: m.exact ? "exact" : "fuzzy" };
        }
        if (hit) {
          const pts = nameHits === 0 ? (hit.how === "exact" ? 3 : 2) : 1;
          nameHits++;
          add(folder.name, pts, hit.how === "exact" ? `Name contains “${k}”` : `Name contains “${hit.found}” (close to “${k}”)`);
          entry(folder.name).hits.push(hit);
        } else if (f.text && textHits < 2 && !generic && textContains(k, f.text)) {
          textHits++;
          add(folder.name, nameHits === 0 && textHits === 1 ? 2 : 1, `Document text mentions “${k}”`);
          entry(folder.name).hits.push({ clue: k, found: k, how: "text" });
        }
      }
      if (folder.kind && folder.kind === kind) add(folder.name, 1, `File type: ${kind}`);
      if (folder.kind === "screenshot" && kind === "image" && looksLikeScreenshotSize(f)) add(folder.name, 1, "Phone-screen size");
    }
    scores.set(f.id, s);
  }

  // 3. Time clusters add support (never enough alone) toward a strong neighbour's folder.
  const strongOf = (id: string) => {
    const s = scores.get(id);
    if (!s) return undefined;
    const best = [...s.entries()].sort((a, b) => b[1].score - a[1].score)[0];
    return best && best[1].score >= STRONG_THRESHOLD ? best[0] : undefined;
  };
  const baseStrong = new Map(files.map((f) => [f.id, strongOf(f.id)]));
  for (const f of files) {
    const s = scores.get(f.id);
    if (!s) continue;
    const near = files.find(
      (o) => o.id !== f.id && Math.abs(o.lastModified - f.lastModified) <= CLUSTER_WINDOW_MS && baseStrong.get(o.id),
    );
    const folder = near && baseStrong.get(near.id);
    if (folder && (s.get(folder)?.score ?? 0) > 0) {
      const cur = s.get(folder)!;
      cur.score += 1;
      cur.reasons.push(`Made within 10 min of ${near.name}`);
    }
  }

  return files.map((f) => {
    const dupOf = keptFor.get(f.id);
    const locked = first.get(f.id);
    // Locked vault files keep their protected path even when they are exact copies.
    if (locked) return locked;
    if (!dupOf && protectedHashes.has(f.hash)) {
      return { fileId: f.id, folder: UNSORTED, confidence: "low", reasons: ["Exact copy of a protected vault file — the vault copy is kept"], duplicateOf: f.id };
    }
    const best = [...(scores.get(f.id) ?? new Map<string, Score>()).entries()].sort((a, b) => b[1].score - a[1].score)[0];
    const extra = best ? explain(best[0], best[1]) : {};
    if (best && best[1].score >= STRONG_THRESHOLD) {
      return { fileId: f.id, folder: best[0], confidence: "strong", reasons: best[1].reasons, duplicateOf: dupOf, ...extra };
    }
    const hasClue = !!best && best[1].hits.length > 0;
    return {
      fileId: f.id,
      folder: UNSORTED,
      confidence: "low",
      reasons: best ? [...best[1].reasons, `Not enough clues for ${best[0]}`] : ["No clues found"],
      duplicateOf: dupOf,
      ...extra,
      maybe: hasClue ? best![0] : undefined,
    };
  });
}

function quoteList(xs: string[]) {
  const q = xs.map((x) => `‘${x}’`);
  return q.length <= 1 ? q.join("") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

function explain(folder: string, sc: Score): Pick<Suggestion, "summary" | "aliasCandidates" | "clues"> {
  if (!sc.hits.length) return {};
  const inName = sc.hits.filter((h) => h.how !== "text").map((h) => h.found);
  const inText = sc.hits.filter((h) => h.how === "text").map((h) => h.clue);
  const parts: string[] = [];
  if (inName.length) parts.push(`The filename contains ${quoteList([...new Set(inName)])}.`);
  if (inText.length) parts.push(`The document text mentions ${quoteList([...new Set(inText)])}.`);
  const lead = sc.score >= STRONG_THRESHOLD ? `Likely match for ${folder}.` : `Possible match for ${folder}.`;
  const aliasCandidates = sc.hits
    .filter((h) => h.how === "fuzzy")
    .map((h) => ({ clue: h.clue, found: h.found, folder, ruleId: h.ruleId }));
  return {
    summary: `${lead} ${parts.join(" ")}`,
    aliasCandidates: aliasCandidates.length ? aliasCandidates : undefined,
    clues: [...new Set(sc.hits.map((h) => h.clue))],
  };
}

// ---------- Aliases ----------

export type AliasResult = { rules: OrgRule[]; error?: undefined } | { rules?: undefined; error: string };

/** Teach DocuALL that `alias` means the same as a rule (or a folder clue, which becomes a rule). */
export function addAlias(rules: OrgRule[], target: { ruleId?: string | undefined; clue: string; folder: string }, alias: string, newId: () => string = () => crypto.randomUUID()): AliasResult {
  const a = alias.trim().replace(/\s+/g, " ");
  const problem = clueProblem(a);
  if (problem) return { error: problem };
  const existing = target.ruleId ? rules.find((r) => r.id === target.ruleId) : rules.find((r) => r.folder === target.folder && normalize(r.pattern) === normalize(target.clue));
  if (existing) {
    const all = [existing.pattern, ...(existing.aliases ?? [])].map(normalize);
    if (all.includes(normalize(a))) return { rules };
    return { rules: rules.map((r) => (r.id === existing.id ? { ...r, aliases: [...(r.aliases ?? []), a] } : r)) };
  }
  return { rules: [...rules, { id: newId(), pattern: target.clue, folder: target.folder, aliases: [a] }] };
}

export function editAlias(rules: OrgRule[], ruleId: string, index: number, value: string): AliasResult {
  const problem = clueProblem(value);
  if (problem) return { error: problem };
  return { rules: rules.map((r) => (r.id === ruleId ? { ...r, aliases: (r.aliases ?? []).map((x, i) => (i === index ? value.trim() : x)) } : r)) };
}

export function removeAlias(rules: OrgRule[], ruleId: string, index: number): OrgRule[] {
  return rules.map((r) => (r.id === ruleId ? { ...r, aliases: (r.aliases ?? []).filter((_, i) => i !== index) } : r));
}

// ---------- Related-document groups ----------

export interface RelatedGroup {
  title: string;
  fileIds: string[];
  evidence: string;
  kind: "clue" | "title";
}

/** Suggested groups of files that seem to belong together. Never claims they are versions. */
export function relatedGroups(files: OrgFile[], suggestions: Suggestion[]): RelatedGroup[] {
  const locked = new Set(suggestions.filter((s) => s.confidence === "locked").map((s) => s.fileId));
  const pool = files.filter((f) => !locked.has(f.id));
  const out: RelatedGroup[] = [];

  const byClue = new Map<string, string[]>();
  for (const s of suggestions) {
    if (locked.has(s.fileId)) continue;
    for (const c of s.clues ?? []) {
      const k = normalize(c);
      byClue.set(k, [...(byClue.get(k) ?? []), s.fileId]);
    }
  }
  for (const [k, ids] of byClue) {
    if (ids.length < 2) continue;
    const label = suggestions.find((s) => s.clues?.some((c) => normalize(c) === k))!.clues!.find((c) => normalize(c) === k)!;
    out.push({ title: `Files about “${label}”`, fileIds: ids, kind: "clue", evidence: `Each one's name or text matches the clue “${label}”.` });
  }

  const seen = new Set<string>();
  for (const a of pool) {
    if (seen.has(a.id)) continue;
    const ka = titleKey(a.name);
    if (tokens(ka).length < 2) continue; // "IMG 0001" style names are not titles
    const members = pool.filter((b) => {
      if (b.id === a.id) return true;
      const kb = titleKey(b.name);
      return tokens(kb).length >= 2 && (ka === kb || tokenSimilarity(ka, kb) >= 0.75);
    });
    if (members.length < 2) continue;
    members.forEach((m) => seen.add(m.id));
    const same = members.every((m) => titleKey(m.name) === ka);
    out.push({
      title: `Similar titles: “${ka}”`,
      fileIds: members.map((m) => m.id),
      kind: "title",
      evidence: same
        ? "Names differ only by version words or numbers (like v2, final, copy). They may be versions — compare before deciding."
        : "Names are nearly the same. They may be related — compare before deciding.",
    });
  }
  return out;
}

/** Suggest a rule pattern from a file name: its first meaningful word. */
export function suggestPattern(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  const word = base.split(/[^a-z]+/).find((w) => w.length >= 4 && !["img", "image", "file", "copy"].includes(w));
  return word ?? base.slice(0, 12);
}

export const DUPLICATES = "Duplicates to review";

export interface PlanEntry {
  path: string;
  name: string;
  folder: string;
  locked: boolean;
  duplicateOfName?: string | undefined;
}

/** Decide every ZIP path. Locked files keep their full original path; names never collide. */
export function planZipPaths(entries: PlanEntry[]): string[] {
  const used = new Set<string>();
  return entries.map((e) => {
    const base = e.locked ? e.folder : e.duplicateOfName ? DUPLICATES : e.folder;
    const want = e.locked ? `${base}/${e.path}` : `${base}/${e.name}`;
    let target = want;
    let n = 2;
    while (used.has(target.toLowerCase())) {
      target = want.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
      n++;
    }
    used.add(target.toLowerCase());
    return target;
  });
}
