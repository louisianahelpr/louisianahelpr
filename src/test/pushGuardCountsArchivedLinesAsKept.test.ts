/*
 * GUARD (docs/OPEN.md Q16 follow-up): the pre-push revert guard
 * (scripts/check-push-no-silent-reverts.mjs) still refuses a push that SHRINKS
 * docs/OPEN.md, but lines moved verbatim into docs/archive/OPEN-done-*.md by
 * scripts/archive-done.mjs count as kept. Before this, archiving the 259 done
 * items read as "net 1139 line(s) removed" and blocked the push.
 * Runs the real script against a fixture repo with a bare origin.
 */
// @mutate scripts/check-push-no-silent-reverts.mjs |   const removed = changedLines(diff, "-").filter((l) => !movedTo.has(l)).length; |   const removed = changedLines(diff, "-").length;
// @mutate scripts/check-push-no-silent-reverts.mjs |   if (lost > 10) problems.push( |   if (lost > 1e9) problems.push(
// @mutate scripts/check-push-no-silent-reverts.mjs | f === "docs/OPEN.md" ? archived : new Set() | new Set(changedLines(sh(`git diff -U0 ${base} HEAD -- docs`), "+"))
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "..", "scripts", "check-push-no-silent-reverts.mjs");
const ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e", GIT_CONFIG_NOSYSTEM: "1" };
let dir = "";
const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, ...ENV } }).trim();
const items = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `- [x] **Q${i + 1} ${tag} item ${i}** GUARD: x.test.ts`).join("\n") + "\n";
function commitAll(msg: string) { git("add", "-A"); git("-c", "commit.gpgsign=false", "commit", "-q", "-m", msg); }
const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...ENV } });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lh-pushguard-")));
  const origin = join(dir, "..", `${dir.split("/").pop()}-origin.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", origin);
  mkdirSync(join(dir, "docs", "archive"), { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), "rules\n");
  writeFileSync(join(dir, "docs", "OPEN.md"), "# Open\n" + items(30, "done"));
  commitAll("base");
  git("push", "-q", "origin", "main");
  git("fetch", "-q", "origin");
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(`${dir}-origin.git`, { recursive: true, force: true }); });

describe("the pre-push revert guard and the done-item archive", () => {
  it("passes when the removed OPEN.md lines were moved verbatim to docs/archive/OPEN-done-*.md", () => {
    writeFileSync(join(dir, "docs", "archive", "OPEN-done-2026-09.md"), "# Done\n" + items(30, "done"));
    writeFileSync(join(dir, "docs", "OPEN.md"), "# Open\n");
    commitAll("archive");
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("still refuses when the lines vanish (or go to a file that is not the archive)", () => {
    writeFileSync(join(dir, "docs", "other.md"), items(30, "done"));
    writeFileSync(join(dir, "docs", "OPEN.md"), "# Open\n");
    commitAll("lose them");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("docs/OPEN.md: net 30 line(s) removed");
  });
});
