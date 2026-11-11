/** Typo-tolerant clue matching — pure (no I/O) so its rules are unit-tested. */

/** Words too generic to route a file on their own (e.g. "Connection" alone must not mean Caleb Connection). */
export const COMMON_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "your", "our", "new", "old", "final", "draft", "copy", "file", "files",
  "doc", "docs", "document", "documents", "image", "img", "photo", "picture", "pic", "scan", "page", "pages", "deck",
  "slide", "slides", "presentation", "report", "notes", "note", "version", "edit", "edited", "updated", "update",
  "connection", "connect", "project", "projects", "meeting", "work", "personal", "misc", "other", "stuff", "untitled",
  "download", "downloads", "screenshot", "video", "audio", "clip", "export", "plan", "info", "data", "form", "letter",
]);

/** Version-ish words ignored when comparing titles. */
const VERSION_WORDS = new Set(["final", "draft", "copy", "edited", "updated", "new", "old", "rev", "latest", "fixed"]);

export function normalize(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/** Meaningful = not a common word, at least 3 characters (or a number). */
export function meaningfulTokens(s: string): string[] {
  return tokens(s).filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !COMMON_WORDS.has(t));
}

/** Optimal-string-alignment edit distance: insert, delete, substitute, swap neighbours. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** How many typos a word may contain. Short words must match exactly. */
export function allowedTypos(word: string, standalone: boolean): number {
  if (/^\d+$/.test(word)) return 0;
  if (standalone) return word.length >= 7 ? 1 : 0;
  if (word.length >= 9) return 2;
  if (word.length >= 5) return 1;
  return 0;
}

export interface ClueMatch {
  clue: string;
  found: string; // the words as they appear in the file
  exact: boolean;
}

/**
 * Does `clue` appear in `text`? Every word of the clue must be present (in any order).
 * Small typos are tolerated on longer words, but a multi-word clue needs at least one word spelled exactly,
 * and a single-word clue must not be a common word.
 */
export function matchClue(clue: string, text: string): ClueMatch | null {
  const ct = tokens(clue);
  const tt = tokens(text);
  if (!ct.length || !tt.length) return null;
  if (ct.length === 1 && COMMON_WORDS.has(ct[0]!)) {
    return null; // too generic to route a file by itself
  }
  // Adjacent exact phrase (handles spacing/punctuation variations).
  const nt = ` ${tt.join(" ")} `;
  if (nt.includes(` ${ct.join(" ")} `)) return { clue, found: ct.join(" "), exact: true };
  // Joined words: "investordeck" vs "investor deck".
  const joined = ct.join("");
  if (ct.length > 1 && tt.includes(joined)) return { clue, found: joined, exact: true };

  const standalone = ct.length === 1;
  const used = new Set<number>();
  const found: string[] = [];
  let exactCount = 0;
  for (const c of ct) {
    let best = -1;
    let bestD = Infinity;
    tt.forEach((t, i) => {
      if (used.has(i)) return;
      const d = t === c ? 0 : editDistance(c, t);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > allowedTypos(c, standalone)) return null;
    // A fuzzy hit on a common word is not trusted.
    if (bestD > 0 && COMMON_WORDS.has(c) && ct.length === 1) return null;
    used.add(best);
    found.push(tt[best]!);
    if (bestD === 0) exactCount++;
  }
  if (!standalone && exactCount === 0) return null;
  // Every word matched exactly but not adjacent — still exact, words just separated.
  return { clue, found: found.join(" "), exact: exactCount === ct.length };
}

/** Exact phrase inside extracted document text (no typo tolerance — text is long and noisy). */
export function textContains(clue: string, text: string): boolean {
  const ct = tokens(clue);
  if (!ct.length) return false;
  if (ct.length === 1 && (COMMON_WORDS.has(ct[0]!) || ct[0]!.length < 4)) return false;
  return ` ${normalize(text)} `.includes(` ${ct.join(" ")} `);
}

/** Why a clue/alias is too broad to save, or null if it's fine. */
export function clueProblem(clue: string): string | null {
  const t = tokens(clue);
  if (!t.length) return "Type at least one word.";
  const m = meaningfulTokens(clue);
  if (!m.length) return `“${clue.trim()}” is too common on its own — add a more specific word, like a name.`;
  if (t.length === 1 && t[0]!.length < 3) return "Use at least 3 letters.";
  return null;
}

/** Title used to compare versions: no extension, no version words, numbers like v2 / (3) / dates. */
export function titleKey(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return tokens(base)
    .filter((t) => !VERSION_WORDS.has(t) && !/^v?\d+$/.test(t))
    .join(" ");
}

export function tokenSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if ([...B].some((y) => y === x || (allowedTypos(x, false) > 0 && editDistance(x, y) <= allowedTypos(x, false)))) inter++;
  return inter / (A.size + B.size - inter);
}
