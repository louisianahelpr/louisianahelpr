/*
 * GUARD (Q78): untracked files left in docs/ are reported at session start.
 * scripts/prune-git-hygiene.mjs (run by .claude/hooks/git-hygiene.sh) calls
 * staleUntracked(); this pins the rule and that the script still calls it.
 */
// @mutate scripts/lib/staleUntracked.mjs | f.path.startsWith("docs/") && nowMs - f.mtimeMs > limit | false
// @mutate scripts/prune-git-hygiene.mjs |     const stale = staleUntracked(untracked, Date.now(), 2);\n |     const stale = [];\n
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staleUntracked } from "../../scripts/lib/staleUntracked.mjs";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 23);

describe("stale untracked docs are reported", () => {
  it("flags docs/ files older than 2 days, and only those", () => {
    const files = [
      { path: "docs/audit/morning/2026-09-21.md", mtimeMs: now - 3 * DAY },
      { path: "docs/audit/new-today.md", mtimeMs: now - DAY / 2 },
      { path: "scratch/old.txt", mtimeMs: now - 10 * DAY },
    ];
    expect(staleUntracked(files, now, 2)).toEqual(["docs/audit/morning/2026-09-21.md"]);
  });

  it("the session-start hygiene script calls it", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prune-git-hygiene.mjs"), "utf8");
    expect(src).toMatch(/staleUntracked\(untracked, Date\.now\(\), 2\)/);
    expect(src).toMatch(/ls-files", "--others", "--exclude-standard", "docs\/"/);
  });
});
