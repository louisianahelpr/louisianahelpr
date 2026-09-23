/*
 * GUARD: no tracked file contains a git merge-conflict marker.
 *
 * 2026-09-23: a rebase stopped on a conflict in generated docs, a follow-up
 * `git commit -a` recorded the conflicted files as-is, and the push put
 * `<<<<<<<` / `>>>>>>>` into docs/OPEN.md, docs/SCOREBOARD.md and
 * docs/audit/vacuity-report.json (invalid JSON) on main (88ee54f74). Pushes use
 * --no-verify, so only a check in the suite catches it.
 */
// @mutate docs/OPEN.md | # Open list\n | <<<<<<< HEAD\n# Open list\n
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SELF = "src/test/noConflictMarkers.test.ts";
const MARKER = /^(<{7}|>{7})( |$)/m;

describe("no merge-conflict markers are committed", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && f !== SELF && /\.(md|json|ts|tsx|mjs|js|sql|ya?ml|css|html|sh|toml)$/.test(f));

  it("scans the whole tree", () => {
    expect(files.length).toBeGreaterThan(1500);
  });

  it("finds no <<<<<<< or >>>>>>> line in any tracked text file", () => {
    const bad = files.filter((f) => {
      try { return MARKER.test(readFileSync(join(ROOT, f), "utf8")); } catch { return false; }
    });
    expect(bad).toEqual([]);
  });
});
