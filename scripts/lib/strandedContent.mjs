/**
 * Is a ref's work on main? Decided by CONTENT, never by SHA or subject.
 *
 * WHY (owner, 2026-10-03: "nothing should ever be left stranded"; "nothing
 * should ever be closed without merging"). land.sh rebases every PR, so landed
 * work sits on main under new SHAs; `git cherry` misses anything that was
 * re-landed by hand, split, squashed or edited on the way, and a subject match
 * says nothing about content. The 2026-10-03 sweep found work in 31 kept
 * branches, 26 detached worktree HEADs, 10 stash entries, 5 remote branches and
 * 144 PRs closed without merging; the tools that existed either deleted by
 * patch/subject or reported to a log nobody read.
 *
 * The test, per ref: every SIGNIFICANT line the ref ADDS (merge-base..ref) must
 * exist on main, in the same file or anywhere in main's tree (moved code), and
 * lines it REMOVES must not all still be in main's copy of that file (a
 * deletion that never landed). Generated files and the open-work list are
 * skipped: they are rewritten on every landing, so their lines never match.
 *
 * Pure apart from the injected `git(args, opts?) -> stdout` runner, so the
 * guard (src/test/strandedWork.test.ts) can drive it on a scratch repo.
 *
 * The same test decides what scripts/prune-git-hygiene.mjs may DELETE
 * (contentLanded on a strict result; guard src/test/pruneByContent.test.ts).
 * On 2026-10-12 hygiene kept 118 branches by patch-id while only 94 items held
 * lines not on main, so branches whose content had landed were never cleaned.
 */
import { execFileSync } from "node:child_process";

/** Paths whose lines are regenerated or re-edited on every landing. */
export const IGNORED_PATHS = [
  /^docs\/OPEN\.md$/, /^docs\/archive\//, /^docs\/SCOREBOARD\.md$/, /^docs\/GUARD-BURNDOWN\.md$/,
  /^docs\/audit\//, /^docs\/reviews\//, /(^|\/)package-lock\.json$/, /^src\/integrations\/supabase\/types\.ts$/,
  /^scripts\/audit\/.*\.json$/, /baseline\.json$/, /findings\.jsonl$/, /^public\/sitemap\.xml$/,
  /\.(png|jpe?g|webp|gif|ico|pdf|zip|gz|tgz|bundle)$/i,
];
export const isIgnoredPath = (f) => IGNORED_PATHS.some((re) => re.test(f));

/** A line worth matching: trimmed, at least 12 chars, not bare punctuation or an empty comment. */
export function sigLine(line) {
  const t = String(line).trim();
  if (t.length < 12) return null;
  if (/^[\])}{(;,]*$/.test(t)) return null;
  if (/^(\/\/|\*|\/\*|#|--)\s*$/.test(t)) return null;
  return t;
}

const TEXT_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|sql|ya?ml|md|json|jsonl|sh|css|html|swift|toml|txt|xml|plist|kt|java|gradle|rb)$/i;

/** Every significant line in `mainRef`'s tree. Built once per run. */
export function buildMainIndex(git, mainRef) {
  const files = git(["ls-tree", "-r", "--name-only", mainRef]).split("\n").filter((f) => f && TEXT_FILE.test(f));
  const lines = new Set();
  for (let i = 0; i < files.length; i += 400) {
    const chunk = files.slice(i, i + 400);
    const text = git(["cat-file", "--batch"], { input: chunk.map((f) => `${mainRef}:${f}`).join("\n") + "\n" });
    for (const l of text.split("\n")) {
      const s = sigLine(l);
      if (s) lines.add(s);
    }
  }
  return lines;
}

/** Lines of `path` at `ref`, as a Set of trimmed lines; null when the file is absent there. */
function fileLines(git, ref, path) {
  try {
    return new Set(git(["show", `${ref}:${path}`]).split("\n").map((l) => l.trim()));
  } catch {
    return null;
  }
}

/**
 * The -U0 patch of every file in `changed`, keyed by path, from ONE `git diff`.
 * `git diff` prints one `diff --git` section per path, in the same order as
 * --name-status; any disagreement returns null and the caller diffs per file.
 */
function patchesByFile(git, mergeBase, ref, changed) {
  if (!changed.length) return new Map();
  const sections = git(["diff", "-U0", "--no-renames", mergeBase, ref]).split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "));
  if (sections.length !== changed.length) return null;
  return new Map(changed.map((f, i) => [f, sections[i]]));
}

/**
 * Main's copy of each path as a Set of trimmed lines (null when absent), from
 * ONE `git cat-file --batch`. Sizes are in bytes, so the output is re-encoded;
 * output that did not decode cleanly, or any surprise, falls back per file.
 */
function mainFileLines(git, mainRef, paths) {
  const out = new Map();
  if (paths.some((p) => p.includes("\n"))) return out;
  const text = git(["cat-file", "--batch"], { input: paths.map((p) => `${mainRef}:${p}`).join("\n") + "\n" });
  if (text.includes("�")) return out;
  const buf = Buffer.from(text, "utf8");
  let pos = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) return new Map();
    const header = buf.toString("utf8", pos, nl);
    if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
      out.set(p, null);
      pos = nl + 1;
      continue;
    }
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!m) return new Map();
    const size = Number(m[2]);
    if (m[1] === "blob") out.set(p, new Set(buf.toString("utf8", nl + 1, nl + 1 + size).split("\n").map((l) => l.trim())));
    pos = nl + 1 + size + 1;
  }
  return out;
}

/** Binary, by extension: its diff has no lines, so strict mode compares blobs instead. */
const BINARY_FILE = /\.(png|jpe?g|webp|gif|ico|pdf|zip|gz|tgz|bundle|woff2?|ttf|otf|mp4|mov|car|jar|keystore|p12)$/i;

/** The blob id of `path` at `ref`, or null when it is absent there. */
function blobAt(git, ref, path) {
  try {
    return git(["rev-parse", "--verify", "-q", `${ref}:${path}`]).trim() || null;
  } catch {
    return null;
  }
}

/**
 * What of `ref` is not on `mainRef`.
 *
 * `strict` is for deciding a DELETE (scripts/lib/branchHygiene.mjs,
 * worktreeHygiene.mjs), never for the stranded report: it also counts, in
 * `shortMissing`, every short added line ("x = 2;", "true") that is not in
 * main's copy of the SAME file (too common to look up anywhere else), a binary
 * file whose blob differs from main's, and a whole-file delete main never took.
 * @returns {{ ref, mergeBase, files: {file, missing: string[], removedStill: string[], shortMissing: string[]}[], missing: number, removedStill: number, shortMissing: number, stranded: boolean }}
 */
export function unlandedContent(git, ref, mainRef, mainIndex, { strict = false } = {}) {
  let mergeBase;
  try {
    mergeBase = git(["merge-base", mainRef, ref]).trim();
  } catch {
    return { ref, mergeBase: null, files: [], missing: 0, removedStill: 0, shortMissing: 0, stranded: false, error: "no merge base with main" };
  }
  // One status listing, one patch and one batch read of main's copies per ref
  // (a spawn per file made a 130-branch hygiene run take minutes).
  const status = git(["diff", "--name-status", "--no-renames", mergeBase, ref]).split("\n").filter(Boolean)
    .map((l) => { const tab = l.indexOf("\t"); return { st: l.slice(0, tab), file: l.slice(tab + 1) }; });
  const deleted = new Set(status.filter((s) => s.st === "D").map((s) => s.file));
  const changed = status.map((s) => s.file);
  const wanted = changed.filter((f) => !isIgnoredPath(f) && !(strict && BINARY_FILE.test(f)));
  const patches = patchesByFile(git, mergeBase, ref, changed);
  const mainCopies = wanted.length ? mainFileLines(git, mainRef, wanted) : new Map();
  const files = [];
  let missing = 0, removedStill = 0, shortMissing = 0;
  for (const file of changed) {
    if (strict && BINARY_FILE.test(file)) {
      // Landed when main holds the very same blob (or the same absence) at that path.
      if (blobAt(git, ref, file) !== blobAt(git, mainRef, file)) {
        files.push({ file, missing: [], removedStill: [], shortMissing: ["(binary file differs from main)"] });
        shortMissing += 1;
      }
      continue;
    }
    if (isIgnoredPath(file)) continue;
    const patch = patches?.get(file) ?? git(["diff", "-U0", "--no-renames", mergeBase, ref, "--", file]);
    const onMain = mainCopies.has(file) ? mainCopies.get(file) : fileLines(git, mainRef, file);
    const added = [], removed = [];
    for (const l of patch.split("\n")) {
      if (l.startsWith("+++") || l.startsWith("---")) continue;
      if (l.startsWith("+")) added.push(l.slice(1));
      else if (l.startsWith("-")) removed.push(l.slice(1));
    }
    const addedSet = new Set(added.map((l) => l.trim()));
    const fileMissing = added.map(sigLine).filter((s) => s && !onMain?.has(s) && !mainIndex.has(s));
    // A removed line still in main's copy that the ref does not re-add elsewhere in the file.
    const fileRemovedStill = onMain
      ? removed.map(sigLine).filter((s) => s && onMain.has(s) && !addedSet.has(s))
      : [];
    const fileShort = [];
    if (strict) {
      for (const l of added) {
        const t = l.trim();
        if (t && !sigLine(t) && !/^[\])}{(;,]*$/.test(t) && !onMain?.has(t)) fileShort.push(t);
      }
      if (onMain && deleted.has(file)) fileShort.push("(file deleted here, still on main)");
      if (/^Binary files /m.test(patch) && blobAt(git, ref, file) !== blobAt(git, mainRef, file)) {
        fileShort.push("(binary file differs from main)");
      }
    }
    if (fileMissing.length || fileRemovedStill.length || fileShort.length) {
      files.push({ file, missing: fileMissing, removedStill: fileRemovedStill, shortMissing: fileShort });
      missing += fileMissing.length;
      removedStill += fileRemovedStill.length;
      shortMissing += fileShort.length;
    }
  }
  return { ref, mergeBase, files, missing, removedStill, shortMissing, stranded: isStranded(missing, removedStill) };
}

/** Stranded: any added line missing from main, or a deletion of at least 5 lines that never landed. */
export function isStranded(missing, removedStill) {
  return missing > 0 || removedStill >= 5;
}

/**
 * Safe to DELETE (scripts/prune-git-hygiene.mjs), from a `strict` result.
 * Stricter than "not stranded": every added line is on main, and EVERY
 * deletion landed (not merely fewer than 5 still there).
 */
export function contentLanded(r) {
  return !r.error && r.mergeBase !== null && r.missing === 0 && r.removedStill === 0 && r.shortMissing === 0;
}

/** One line on what of a strict result is not on main, for a hygiene skip reason. */
export function contentNote(r) {
  if (r.error) return `content check: ${r.error}`;
  const parts = [];
  if (r.missing) parts.push(`${r.missing} line(s) not on main`);
  if (r.removedStill) parts.push(`${r.removedStill} deleted line(s) still on main`);
  if (r.shortMissing) parts.push(`${r.shortMissing} short line(s)/file(s) not on main`);
  const files = r.files.slice(0, 3).map((x) => x.file).join(", ");
  return `by content: ${parts.join(", ")}${files ? ` in ${files}${r.files.length > 3 ? ", …" : ""}` : ""}`;
}

/** A `git(args, {input}) -> stdout` runner rooted at `cwd`, the shape every function above takes. */
export function gitRunner(cwd) {
  return (argv, o = {}) => execFileSync("git", argv, {
    cwd, encoding: "utf8", maxBuffer: 1 << 30, input: o.input, timeout: 120_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    stdio: [o.input ? "pipe" : "ignore", "pipe", "pipe"],
  });
}

/**
 * ref -> strict unlandedContent result, for the hygiene planners. Main's line
 * index is built once, on first use, so a run where every branch is already an
 * ancestor of main never pays for it.
 */
export function makeContentJudge(repo, mainRef) {
  const git = gitRunner(repo);
  let index = null;
  return (ref) => {
    index ??= buildMainIndex(git, mainRef);
    return unlandedContent(git, ref, mainRef, index, { strict: true });
  };
}
