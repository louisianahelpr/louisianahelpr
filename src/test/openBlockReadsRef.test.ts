/*
 * GUARD (one open list, 2026-10-02): the session-start "Open work" block reads
 * the queue from ORIGIN/MAIN, not from whatever branch the checkout sits on.
 * That day the shared checkout was on the stale branch lead/q210-wip and the
 * hook printed "111 open" while origin/main had 182 open + 48 partly done.
 *
 * A temp git repo whose committed OPEN.md (3 open, 1 unnumbered) differs from
 * its working tree (1 open): `scoreboard.mjs --open-block --ref HEAD --repo <tmp>`
 * must print the committed numbers. The hook must fetch and pass --ref.
 */
// @mutate scripts/scoreboard.mjs |         local = localRows((p) => g.read(p) ?? "", g.list); |         local = localRows();
// @mutate scripts/lib/openQueue.mjs |   const read = (p) => { try { return git("show", `${sha}:${p}`); } catch { return null; } }; |   const read = (p) => { try { return readFileSync(join(repo, p), "utf8"); } catch { return null; } };
// @mutate .claude/hooks/session-start.sh | --open-block --ref "$LH_SHA0" --repo "$LH_DIR0" | --open-block
// @mutate .claude/hooks/session-start.sh | git -C "$LH_DIR0" fetch -q origin main | true
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { gitRefReader, queueText } from "../../scripts/lib/openQueue.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { queueCounts } from "../../scripts/queue-count.mjs";

const ROOT = join(__dirname, "..", "..");
const item = (n: number, s = " ") => `- [${s}] **Q${n} item ${n}.** text`;
const COMMITTED = ["# Open", "", item(1), item(2), item(3), item(4, "~"), "- [ ] an unnumbered line", ""].join("\n");
const WORKING = ["# Open", "", item(1), ""].join("\n");

let dir = "";
const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lh-open-ref-"));
  mkdirSync(join(dir, "docs/archive"), { recursive: true });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "docs/OPEN.md"), COMMITTED);
  writeFileSync(join(dir, "docs/archive/OPEN-done-2026-09.md"), [item(9, "x"), item(10, "x"), ""].join("\n"));
  git("add", "-A");
  git("commit", "-q", "-m", "c");
  writeFileSync(join(dir, "docs/OPEN.md"), WORKING); // the stale checkout
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("gitRefReader reads the ref, not the working tree", () => {
  it("counts the committed queue, archives included", () => {
    const g = gitRefReader(dir, "HEAD");
    const c = queueCounts(queueText(dir, (p: string) => g.read(p) ?? "", g.list));
    expect(c).toMatchObject({ open: 3, partial: 1, done: 2, unnumbered: 1 });
    // and the working tree really differs, or this proves nothing
    expect(queueCounts(queueText(dir)).open).toBe(1);
  });
});

describe("scoreboard --open-block --ref", () => {
  it("prints the ref's numbers, says where it read them, and names the unnumbered lines", () => {
    const r = spawnSync("node", ["scripts/scoreboard.mjs", "--open-block", "--ref", "HEAD", "--repo", dir], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(read from HEAD [0-9a-f]{9}\)/);
    expect(r.stdout).toMatch(/\*\*Open: 4\*\* \(3 to do, 1 fixed with protection pending; 2 done\)/);
    expect(r.stdout).toContain("Plus 1 unnumbered open line not yet given a Q number.");
  });
});

describe("the session-start hook reads origin/main", () => {
  const hook = readFileSync(join(ROOT, ".claude/hooks/session-start.sh"), "utf8");
  it("fetches origin main and runs main's own scoreboard with --ref", () => {
    expect(hook).toContain('git -C "$LH_DIR0" fetch -q origin main');
    expect(hook).toContain('git -C "$LH_DIR0" archive "$LH_SHA0" scripts');
    expect(hook).toContain('--open-block --ref "$LH_SHA0" --repo "$LH_DIR0"');
    expect(hook.split("\n").length).toBeGreaterThan(20); // inventory floor: the real hook, not a stub
  });
});
