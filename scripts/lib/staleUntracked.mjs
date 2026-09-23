/**
 * Untracked files under docs/ that have sat for more than `maxAgeDays`.
 *
 * Q78 (2026-09-23): two morning reports and a screenshot sat untracked in
 * docs/ for days, in nobody's list. CI never sees untracked files, so this
 * runs locally from scripts/prune-git-hygiene.mjs (session start) and
 * reports them; deciding keep (commit as a dated record) or scratch is a
 * person's call, so it never deletes.
 *
 * @param {{path: string, mtimeMs: number}[]} files untracked files (repo-relative)
 * @param {number} nowMs
 * @param {number} maxAgeDays
 */
export function staleUntracked(files, nowMs, maxAgeDays = 2) {
  const limit = maxAgeDays * 86_400_000;
  return files
    .filter((f) => f.path.startsWith("docs/") && nowMs - f.mtimeMs > limit)
    .map((f) => f.path)
    .sort();
}
