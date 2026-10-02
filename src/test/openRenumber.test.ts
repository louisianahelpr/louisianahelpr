/*
 * GUARD (one open list, 2026-10-02): queue numbers are collision-safe, and one
 * external source never becomes two queue items.
 *
 * 1. Lanes took "next free" from their own base and filed the same number:
 *    Q743 (8c8d298fa), Q904/Q905 (7c34385dc), Q909-Q914 (fdfc99a0d, 53e823a96,
 *    a08fb9606). scripts/open-renumber.mjs, run by land.sh right after the
 *    rebase, keeps the number on the item main already has and moves the
 *    branch's copy to the next number free on both.
 * 2. open-sync-trackers numbered new feed items from the branch base too; it
 *    now uses nextFreeAcross (this tree AND origin/main).
 * 3. applyFeeds attached a source to an untagged item only when exactly one
 *    item's first line named it, and otherwise FILED A NEW ONE — one more copy
 *    of a source already named by several items (issue #1719 opened the first
 *    line of 10 items, #1582 of 9). It now refuses and reports it as ambiguous.
 */
// @mutate scripts/open-renumber.mjs |     const keep = onBase[0] ?? list[0]; |     const keep = list[0];
// @mutate scripts/open-renumber.mjs |     if (o === keep) continue; |     if (o !== keep) continue;
// @mutate scripts/lib/openFeeds.mjs |       else if (hits.length > 1) { ambiguous.push | else if (false) { ambiguous.push
// @mutate scripts/open-sync-trackers.mjs | nextFree: Number(nextFreeAcross(ROOT).slice(1)) | nextFree: 1
// @mutate scripts/land.sh |   node scripts/open-renumber.mjs --base origin/main |   true
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { renumberPlan } from "../../scripts/open-renumber.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { nextFreeAcross, duplicateIds } from "../../scripts/queue-count.mjs";
import { applyFeeds } from "../../scripts/lib/openFeeds.mjs";

const ROOT = join(__dirname, "..", "..");
const item = (n: number, t: string, s = " ") => `- [${s}] **Q${n} ${t}.** body`;

describe("open-renumber: main keeps the number, the branch's copy moves", () => {
  // Main filed Q5 "main's item"; this branch, numbered from an older base,
  // filed its own Q5 ABOVE it in the file (so "first occurrence wins" is wrong).
  const tree = ["# Open", item(4, "old"), item(5, "branch item"), item(5, "main item"), "- see Q5 for context", ""].join("\n");
  const base = ["# Open", item(4, "old"), item(5, "main item"), ""].join("\n");

  it("renames only the branch's head line, to the given next free number", () => {
    const plan = renumberPlan([{ path: "docs/OPEN.md", text: tree }], base, 9);
    expect(plan.renames).toEqual([{ from: "Q5", to: "Q9", path: "docs/OPEN.md", line: 3 }]);
    const out = plan.files[0].text as string;
    expect(out).toContain(item(9, "branch item"));
    expect(out).toContain(item(5, "main item"));
    expect(duplicateIds(out)).toEqual([]);
    expect(plan.mentions).toEqual([{ id: "Q5", path: "docs/OPEN.md", line: 5 }]);
    expect(plan.stuck).toEqual([]);
  });

  it("refuses to pick when main itself carries the duplicate", () => {
    const plan = renumberPlan([{ path: "docs/OPEN.md", text: base + item(5, "again") + "\n" }], base + item(5, "again") + "\n", 9);
    expect(plan.stuck).toEqual(["Q5"]);
    expect(plan.files).toEqual([]);
  });

  it("is a no-op on a tree without duplicates (floor: the real queue has items)", () => {
    const real = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
    expect(real.split("\n").filter((l) => /^- \[[ x~]\] \*\*Q\d+/.test(l)).length).toBeGreaterThan(50);
    expect(renumberPlan([{ path: "docs/OPEN.md", text: base }], base, 9).renames).toEqual([]);
  });
});

describe("nextFreeAcross: higher of this tree and the ref", () => {
  let dir = "";
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lh-renum-"));
    mkdirSync(join(dir, "docs/archive"), { recursive: true });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    writeFileSync(join(dir, "docs/OPEN.md"), [item(1, "a"), item(30, "on main"), ""].join("\n"));
    git("add", "-A"); git("commit", "-q", "-m", "main");
    writeFileSync(join(dir, "docs/OPEN.md"), [item(1, "a"), item(7, "branch"), ""].join("\n"));
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  it("returns the ref's next number when the ref is ahead", () => {
    expect(nextFreeAcross(dir, "HEAD")).toBe("Q31");
  });
  it("falls back to the tree when the ref is unreadable", () => {
    expect(nextFreeAcross(dir, "no-such-ref")).toBe("Q8");
  });
});

describe("applyFeeds never files a second item for a source several items name", () => {
  const group = { keys: ["issue #1719"], title: "nightly red: x", origin: "nightly-red issue #1719", markers: ["done-when: x"] };
  const opts = { status: () => "open" as const, nextFree: 900, today: "2026-10-02" };

  it("ambiguous: two open items open with #1719 -> no new item, reported", () => {
    const md = ["# Open", item(1, "fix #1719 part one"), item(2, "fix #1719 part two"), ""].join("\n");
    const res = applyFeeds(md, [group], opts);
    expect(res.created).toEqual([]);
    expect(res.attached).toEqual([]);
    expect(res.ambiguous).toEqual([{ keys: ["issue #1719"], ids: ["Q1", "Q2"] }]);
    expect(res.md).toBe(md);
  });

  it("exactly one item names it -> attached, nothing ambiguous", () => {
    const md = ["# Open", item(1, "fix #1719"), item(2, "other"), ""].join("\n");
    const res = applyFeeds(md, [group], opts);
    expect(res.attached.map((a) => a.id)).toEqual(["Q1"]);
    expect(res.ambiguous).toEqual([]);
  });

  it("the sync script numbers from nextFreeAcross and exits 1 on ambiguity", () => {
    const src = readFileSync(join(ROOT, "scripts/open-sync-trackers.mjs"), "utf8");
    expect(src).toContain("nextFree: Number(nextFreeAcross(ROOT).slice(1))");
    expect(src).toContain("!res.ambiguous.length");
  });

  it("land.sh renumbers right after the rebase, before the refresh", () => {
    const land = readFileSync(join(ROOT, "scripts/land.sh"), "utf8");
    const r = land.indexOf("git rebase -q origin/main"), n = land.indexOf("node scripts/open-renumber.mjs --base origin/main"), i = land.indexOf("npm run -s inventories:refresh");
    expect(r).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(r);
    expect(i).toBeGreaterThan(n);
  });
});
