// @mutate scripts/land.sh |   node scripts/lib/landPostMergeReset.mjs --base origin/main |   true
// @mutate scripts/lib/landPostMergeReset.mjs |     } else if (here !== main) { |     } else if (false) {
// @mutate scripts/lib/landPostMergeReset.mjs |     text = text.slice(0, ours.i) + main.slice(theirs.i, theirs.j) + text.slice(ours.j); |     void theirs;
// @mutate scripts/lib/landPostMergeReset.mjs |     if (lines.length) foreign.push({ id: b.id, lines }); |     void lines;
/*
 * GUARD: a landing never carries the whole-tree totals (owner, 2026-10-12:
 * "fix the bottleneck before").
 *
 * Measured on the 60 land PRs merged 2026-10-09..12: docs/SCOREBOARD.md was in
 * 26 PR diffs, GUARD-BURNDOWN.md and vacuity-report.json in 19 each, although
 * land.sh refreshed with --skip-post-merge: the branches' own commits carried
 * them (`npm run inventories:refresh` regenerated them). 27 of the 60 went
 * DIRTY and were force-pushed again; they took 2033 of 2387 PR-open minutes.
 *
 * Driven with real git in a throwaway repository: two branches that each
 * regenerated the scoreboard and OPEN.md's count blocks CONFLICT (the measured
 * failure, shown red first); after scripts/lib/landPostMergeReset.mjs both
 * merge clean, the branches' own OPEN.md items survive, and a hand-written line
 * inside a generated block stops the land instead of being deleted.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error — plain .mjs module
import { reset, postMergeOutputs, spliceBlocks, OPEN_BLOCKS } from "../../scripts/lib/landPostMergeReset.mjs";

const ROOT = join(__dirname, "..", "..");
let repo = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

const EO = OPEN_BLOCKS.find((b: { id: string }) => b.id === "scoreboard");
const QC = OPEN_BLOCKS.find((b: { id: string }) => b.id === "queue-count");
const openMd = (open: number, queue: number, items: string[]) =>
  [
    "# Open list",
    "",
    EO.start,
    "**Open work — start here** (Q58). docs/OPEN.md is the ONE open-work list.",
    "",
    `- **Open: ${open}** (to do).`,
    EO.end,
    "",
    "## QUEUE",
    "",
    QC.start,
    `**Queue: ${queue} items — 1 done, 0 partly done (fixed, protection pending), ${queue - 1} open.**`,
    QC.end,
    "",
    ...items,
    "",
  ].join("\n");
const OUTPUTS = ["docs/SCOREBOARD.md", "docs/GUARD-BURNDOWN.md", "docs/OPEN.md"];

/** A branch off main that adds one item, its own file, and regenerated totals. */
function branch(name: string, item: string, open: number, guards: number) {
  git("checkout", "-q", "-b", name, "main");
  put("docs/OPEN.md", openMd(open, open + 1, ["- [ ] **Q1** first", item]));
  put("docs/SCOREBOARD.md", `# Scoreboard\n\nopen ${open}\n`);
  put("docs/GUARD-BURNDOWN.md", `guards ${guards}\n`);
  put(`src/${name}.ts`, `export const ${name} = 1;\n`);
  git("add", "-A");
  git("commit", "-q", "-m", `feat: ${name}`);
}
const conflicts = (a: string, b: string) => spawnSync("git", ["merge-tree", "--write-tree", a, b], { cwd: repo, encoding: "utf8" }).status !== 0;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "land-postmerge-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  put("docs/OPEN.md", openMd(1, 1, ["- [ ] **Q1** first"]));
  put("docs/SCOREBOARD.md", "# Scoreboard\n\nopen 1\n");
  put("docs/GUARD-BURNDOWN.md", "guards 100\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  branch("a", "- [ ] **Q2** from a", 2, 101);
  branch("b", "- [ ] **Q3** from b", 2, 101);
  // b's numbers would really be 3 / 102 after a; a git merge does not know that
  put("docs/SCOREBOARD.md", "# Scoreboard\n\nopen 2 (b)\n");
  git("commit", "-qam", "chore: b regenerates");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("landPostMergeReset", () => {
  it("RED first: two branches that regenerate the totals conflict (the measured DIRTY loop)", () => {
    // a lands first; b, rebased or merged onto it, stops on the totals
    expect(conflicts("a", "b")).toBe(true);
  });

  it("after the reset neither branch touches the totals, both merge clean, and each keeps its own items and files", () => {
    for (const b of ["a", "b"]) {
      git("checkout", "-q", b);
      const r = reset({ cwd: repo, base: "main", outputs: OUTPUTS });
      expect(r.ok).toBe(true);
      expect(r.moved).toEqual(expect.arrayContaining(["docs/SCOREBOARD.md", "docs/GUARD-BURNDOWN.md", "docs/OPEN.md (generated blocks)"]));
      git("commit", "-qam", "chore: refresh generated inventories");
      expect(git("diff", "--name-only", "main", b).trim().split("\n").sort()).toEqual(["docs/OPEN.md", `src/${b}.ts`]);
      // the PR's OPEN.md diff is its item, never a count line
      const d = git("diff", "-U0", "main", b, "--", "docs/OPEN.md");
      expect(d).toMatch(new RegExp(`^\\+- \\[ \\] \\*\\*Q\\d\\*\\* from ${b}$`, "m"));
      expect(d).not.toMatch(/Open: |Queue: /);
    }
    expect(read("docs/SCOREBOARD.md")).toBe("# Scoreboard\n\nopen 1\n");
    // a and b each append an item at the same spot: that is a real conflict for
    // land.sh's resolver (openItemMerge), but the totals never are
    const tree = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", "a", "b"], { cwd: repo, encoding: "utf8" });
    const conflicted = tree.stdout.split("\n").slice(1).filter((l) => l && !l.startsWith("Auto-merging") && !l.startsWith("CONFLICT"));
    expect(conflicted.filter((f) => f !== "docs/OPEN.md")).toEqual([]);
  });

  it("a hand-written line inside a generated block stops the land and leaves the file alone", () => {
    git("checkout", "-q", "a");
    const before = read("docs/OPEN.md").replace(EO.end, `my note about the queue\n${EO.end}`);
    put("docs/OPEN.md", before);
    const r = reset({ cwd: repo, base: "main", outputs: ["docs/OPEN.md"] });
    expect(r.ok).toBe(false);
    expect(read("docs/OPEN.md")).toBe(before);
  });

  it("a total main does not have yet is removed from the branch", () => {
    git("checkout", "-q", "a");
    put("docs/audit/new-total.json", "{}\n");
    const r = reset({ cwd: repo, base: "main", outputs: ["docs/audit/new-total.json"] });
    expect(r.moved).toEqual(["docs/audit/new-total.json"]);
    expect(spawnSync("test", ["-e", join(repo, "docs/audit/new-total.json")]).status).toBe(1);
  });

  it("spliceBlocks keeps everything outside the markers byte for byte", () => {
    const main = openMd(5, 6, ["- [ ] **Q1** first"]);
    const mine = openMd(7, 8, ["- [ ] **Q1** first", "- [ ] **Q9** mine", "tail text"]);
    const { text, foreign } = spliceBlocks(mine, main);
    expect(foreign).toEqual([]);
    expect(text).toBe(openMd(5, 6, ["- [ ] **Q1** first", "- [ ] **Q9** mine", "tail text"]));
  });
});

describe("what it resets, and where land.sh runs it", () => {
  it("every postMerge output and nothing a branch must regenerate itself", () => {
    const outs = postMergeOutputs() as string[];
    expect(outs.length).toBeGreaterThan(6);
    for (const o of ["docs/SCOREBOARD.md", "docs/GUARD-BURNDOWN.md", "docs/audit/vacuity-report.json", "docs/audit/launch-2026-09/COVERAGE.md", "docs/audit/launch-2026-09/SURFACE.md", "docs/audit/launch-2026-09/ROLLUP.md", "docs/OPEN.md"])
      expect(outs, o).toContain(o);
    for (const o of ["docs/audit/toast-inventory.json", "docs/audit/form-inventory.md", "public/sitemap.xml"]) expect(outs, o).not.toContain(o);
    // OPEN.md's postMerge writers are exactly the two blocks reset
    expect(OPEN_BLOCKS.map((b: { id: string }) => b.id).sort()).toEqual(["queue-count", "scoreboard"]);
  });

  it("land.sh resets after the rebase and the renumbering, before the refresh commit", () => {
    const land = readFileSync(join(ROOT, "scripts", "land.sh"), "utf8");
    const code = land.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const at = code.indexOf("\n  node scripts/lib/landPostMergeReset.mjs --base origin/main\n");
    expect(at).toBeGreaterThan(code.indexOf('if ! "${REBASE[@]}"; then'));
    expect(at).toBeGreaterThan(code.indexOf("node scripts/open-renumber.mjs --base origin/main"));
    expect(at).toBeLessThan(code.indexOf("node scripts/check-generated-current.mjs --fix --skip-post-merge"));
    expect(at).toBeLessThan(code.indexOf('git commit -q --no-verify -m "chore: refresh generated inventories'));
  });

  it("the branch-side refresh never regenerates the totals (the brief's pre-push step)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["inventories:refresh"]).toBe("node scripts/check-generated-current.mjs --fix --skip-post-merge");
    expect(pkg.scripts["inventories:refresh:all"]).toBe("node scripts/check-generated-current.mjs --fix");
    // main's own regeneration still covers everything
    const watch = readFileSync(join(ROOT, ".github", "workflows", "staleness-watch.yml"), "utf8");
    expect(watch).not.toMatch(/npm run (-s )?inventories:refresh(?!:all)/);
    expect(watch).toMatch(/inventories:refresh:all/);
  });
});
