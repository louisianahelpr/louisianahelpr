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
 */

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
 * What of `ref` is not on `mainRef`.
 * @returns {{ ref, mergeBase, files: {file, missing: string[], removedStill: string[]}[], missing: number, removedStill: number, stranded: boolean }}
 */
export function unlandedContent(git, ref, mainRef, mainIndex) {
  let mergeBase;
  try {
    mergeBase = git(["merge-base", mainRef, ref]).trim();
  } catch {
    return { ref, mergeBase: null, files: [], missing: 0, removedStill: 0, stranded: false, error: "no merge base with main" };
  }
  const changed = git(["diff", "--name-only", "--no-renames", mergeBase, ref]).split("\n").filter(Boolean);
  const files = [];
  let missing = 0, removedStill = 0;
  for (const file of changed) {
    if (isIgnoredPath(file)) continue;
    const patch = git(["diff", "-U0", "--no-renames", mergeBase, ref, "--", file]);
    const onMain = fileLines(git, mainRef, file);
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
    if (fileMissing.length || fileRemovedStill.length) {
      files.push({ file, missing: fileMissing, removedStill: fileRemovedStill });
      missing += fileMissing.length;
      removedStill += fileRemovedStill.length;
    }
  }
  return { ref, mergeBase, files, missing, removedStill, stranded: isStranded(missing, removedStill) };
}

/** Stranded: any added line missing from main, or a deletion of at least 5 lines that never landed. */
export function isStranded(missing, removedStill) {
  return missing > 0 || removedStill >= 5;
}
