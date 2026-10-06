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
 *    now numbers from the ONE allocator, scripts/lib/queueAllocator.mjs (this
 *    tree AND origin/main; every minter goes through it:
 *    queueAllocatorIsTheOnlyMinter.test.ts).
 * 3. applyFeeds attached a source to an untagged item only when exactly one
 *    item's first line named it, and otherwise FILED A NEW ONE — one more copy
 *    of a source already named by several items (issue #1719 opened the first
 *    line of 10 items, #1582 of 9). It now refuses and reports it as ambiguous.
 * 4. (2026-10-03) ONE item twice under one number (ticked into an archive by
 *    the branch, still open in OPEN.md on main) was renumbered like two items:
 *    f38b17024 made Q456 -> Q919 ... Q900 -> Q924, so Q456 stayed open while
 *    done as Q919. The done copy now stays and the other is dropped.
 * 5. (2026-10-05) Bot PR #2372 (its own commit 6cb67c9ea, forked at 5b58de3bb)
 *    added Q1378-Q1380 for feed items; main meanwhile landed the crew items as
 *    Q1378-Q1380. branchCollisions names a number the branch ADDED that main
 *    also added since the fork, for a different item; queue-count exits 1 on it.
 */
// @mutate scripts/open-renumber.mjs |     if (list.every((o) => sameItemHead(o.line, list[0].line))) { |     if (false) {
// @mutate scripts/open-renumber.mjs |       if (!done.length) { stuck.push(id); continue; } |       if (!done.length) { continue; }
// @mutate scripts/open-renumber.mjs |         for (let k = 0; k < n; k++) dropped[o.fi].add(o.li + k); |         dropped[o.fi].add(o.li);
// @mutate scripts/open-renumber.mjs | for (const o of list.filter((c) => c !== stays)) { | for (const o of list.filter((c) => c !== stays && false)) {
// @mutate scripts/open-renumber.mjs |     const keep = onBase[0] ?? list[0]; |     const keep = list[0];
// @mutate scripts/open-renumber.mjs |     if (o === keep) continue; |     if (o !== keep) continue;
// @mutate scripts/lib/openFeeds.mjs |       else if (hits.length > 1) { ambiguous.push | else if (false) { ambiguous.push
// @mutate scripts/open-sync-trackers.mjs | nextFree: nextFreeNumber(ROOT) | nextFree: 1
// @mutate scripts/lib/queueAllocator.mjs |     if (fork.has(id)) continue; |     if (fork.has(id) \|\| true) continue;
// @mutate scripts/lib/queueAllocator.mjs |     const branchOnly = branchLines.filter((b) => !mainLines.some((m) => m === b \|\| sameItem(m, b))); |     const branchOnly = branchLines.filter((b) => !mainLines.some((m) => true));
// @mutate scripts/land.sh |   node scripts/open-renumber.mjs --base origin/main |   true
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { renumberPlan, sameItemHead } from "../../scripts/open-renumber.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { nextFreeAcross, duplicateIds } from "../../scripts/queue-count.mjs";
import { applyFeeds } from "../../scripts/lib/openFeeds.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { branchCollisions, treeCollisions } from "../../scripts/lib/queueAllocator.mjs";

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

describe("open-renumber: one item in two states is not a collision (2026-10-03)", () => {
  const fed = (s: string, note = "") => `- [${s}] **Q5 MEDIUM nightly-red: x is red.**${note} Mirrored 2026-09-30 from nightly-red issue #7.`;
  const DONE = fed("x", " DONE 2026-10-02: issue #7 closed.");
  const ARCH = "docs/archive/OPEN-done-2026-10.md";
  // Main still has Q5 open (with a note under it); this branch ticked it into the archive.
  const open = ["# Open", item(4, "old"), fed(" "), "  **STATUS 2026-10-01:** a note under the open copy", item(6, "next"), ""].join("\n");
  const arch = ["# Done", DONE, ""].join("\n");

  it("keeps the done copy, drops the open one with its indented lines, renumbers nothing", () => {
    const plan = renumberPlan([{ path: "docs/OPEN.md", text: open }, { path: ARCH, text: arch }], open, 9);
    expect(plan.renames).toEqual([]);
    expect(plan.stuck).toEqual([]);
    expect(plan.drops).toEqual([{ id: "Q5", path: "docs/OPEN.md", line: 3, kept: `${ARCH}:2` }]);
    expect(plan.files.map((f: { path: string }) => f.path)).toEqual(["docs/OPEN.md"]);
    expect(plan.files[0].text).toBe(["# Open", item(4, "old"), item(6, "next"), ""].join("\n"));
  });

  it("two done copies: main's stays, the branch's goes", () => {
    const mainArch = ["# Done", DONE, ""].join("\n");
    const branch = ["# Done", fed("x", " TICKED 2026-10-02 (branch)."), DONE, ""].join("\n");
    const plan = renumberPlan([{ path: ARCH, text: branch }], mainArch, 9);
    expect(plan.drops).toEqual([{ id: "Q5", path: ARCH, line: 2, kept: `${ARCH}:3` }]);
    expect(plan.files[0].text).toBe(mainArch);
  });

  it("one item twice with no done copy: stuck, nothing written", () => {
    const tree = ["# Open", fed(" "), fed("~"), ""].join("\n");
    const plan = renumberPlan([{ path: "docs/OPEN.md", text: tree }], ["# Open", fed(" "), ""].join("\n"), 9);
    expect(plan.stuck).toEqual(["Q5"]);
    expect(plan.files).toEqual([]);
  });

  it("number-only heads (the real Q456/Q919 pair) match by their first 100 characters", () => {
    const text = "(lh-money-escrow review of Q411, 2026-09-25, code read only): a job left at payment_status 'cancelling' (cancel_escrow's refund landed but a later step failed)";
    expect(sameItemHead(`- [ ] **Q456** ${text}`, `- [x] **Q456** ${text} DONE: guarded.`)).toBe(true);
    expect(sameItemHead("- [ ] **Q5 branch item.** body", "- [ ] **Q5 main item.** body")).toBe(false);
    expect(sameItemHead("- [ ] **Q5** short", "- [x] **Q5** short")).toBe(false);
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

  it("the sync script numbers from the one allocator and exits 1 on ambiguity", () => {
    const src = readFileSync(join(ROOT, "scripts/open-sync-trackers.mjs"), "utf8");
    expect(src).toContain("nextFree: nextFreeNumber(ROOT)");
    expect(src).toContain("!res.ambiguous.length");
  });

  it("land.sh renumbers right after the rebase, before the refresh", () => {
    const land = readFileSync(join(ROOT, "scripts/land.sh"), "utf8");
    const r = land.indexOf("git rebase -q origin/main"), n = land.indexOf("node scripts/open-renumber.mjs --base origin/main"), i = land.indexOf("node scripts/check-generated-current.mjs --fix --skip-post-merge");
    expect(r).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(r);
    expect(i).toBeGreaterThan(n);
  });
});

describe("a number the branch added that main also added since, for a different item, fails (2026-10-05)", () => {
  // The #2372 shape, measured: fork had up to Q1377; the bot added Q1378 for a
  // feed item; main added Q1378 for a crew item.
  const fork = ["# Open", item(1377, "last shared"), ""].join("\n");
  const bot = ["# Open", item(1377, "last shared"), item(1378, "nightly-red: main: Test is red"), ""].join("\n");
  const main = ["# Open", item(1377, "last shared"), item(1378, "A crew sent back to open is stranded"), ""].join("\n");

  it("names the collision", () => {
    const r = branchCollisions({ forkText: fork, mainText: main, treeText: bot }, sameItemHead);
    expect(r.map((c: { id: string }) => c.id)).toEqual(["Q1378"]);
    expect(r[0].branch[0]).toContain("Test is red");
    expect(r[0].main[0]).toContain("crew");
  });

  it("the same item landed on both sides, an edit of a number already on the fork, or a number main never used is not one", () => {
    expect(branchCollisions({ forkText: fork, mainText: bot, treeText: bot }, sameItemHead)).toEqual([]);
    const edited = bot.replace("last shared", "last shared, edited");
    expect(branchCollisions({ forkText: fork, mainText: main.replace("Q1378", "Q1390"), treeText: edited }, sameItemHead)).toEqual([]);
    const ticked = bot.replace("- [ ] **Q1378", "- [x] **Q1378");
    expect(branchCollisions({ forkText: fork, mainText: bot, treeText: ticked }, sameItemHead)).toEqual([]);
  });

  it("this checkout adds no number main gave to a different item (when origin/main is readable)", () => {
    const r = treeCollisions(ROOT, "origin/main", sameItemHead);
    if (r === null) return; // shallow CI checkout with no origin/main: duplicateIds on the merge commit covers it
    expect(r).toEqual([]);
  });
});
