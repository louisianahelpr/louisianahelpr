// @mutate scripts/lib/openFeeds.mjs |   const isRobot = (g) => g.label === "nightly-red" \|\| g.robotTitle !== undefined; |   const isRobot = (g) => false;
// @mutate scripts/lib/openFeeds.mjs |     if (g.robots) continue; |     if (false) continue;
// @mutate scripts/lib/openFeeds.mjs |           lines[current2.start].replace(/^- \[ \]/, "- [x]") |           lines[current2.start]
// @mutate scripts/lib/openFeeds.mjs |       if (elsewhere.length) { |       if (false) {
// @mutate scripts/lib/openFeeds.mjs |     if (it.state !== " " \|\| isRobotsItem(it.text)) continue; |     if (it.state !== " ") continue;
/*
 * GUARD (owner 2026-10-14, pop-up: "All failing robot checks roll into ONE
 * 'fix the test robots' item instead of 18"): every red overnight check is a
 * sub-line of ONE docs/OPEN.md item, not an item of its own.
 *
 * Before: scripts/open-sync-trackers.mjs mirrored each open nightly-red issue
 * (and each nightly_red ledger row) as its own item: 18 on 2026-10-14 (Q785,
 * Q1275, Q1374, Q1376, Q1426, Q1427, Q1429, Q1507, Q1775, Q1778-Q1781, Q1807,
 * Q1808, Q1814, Q1815, plus Q593's tag), so the open count rose and fell with
 * the robots. Now they are members of one item (ROBOTS_MARK) whose title
 * counts them; the sync rewrites its sub-lines (workflow, issue, newest red
 * run) every run, keeps it open while any is red and ticks it when none is.
 * Each red check still gets fixed (standing order unchanged). Side notes found
 * while fixing other things stay on the main list: only the robot mirror
 * changed, and other alert labels and ledger rows keep one item each.
 *
 * Red when: robots are filed one item each, the rollup is not rewritten or not
 * ticked, a member is left on a second item, or the real OPEN.md holds an open
 * nightly-red source outside the one robots item.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROBOTS_MARK,
  SNAPSHOT,
  applyFeeds,
  feedCounts,
  groupSources,
  isRobotsItem,
  mirrored,
  newestRunUrl,
  queueItems,
  robotMembersOf,
  tagsOf,
} from "../../scripts/lib/openFeeds.mjs";

const ROOT = join(__dirname, "..", "..");
const RUN = (n: number) => `https://github.com/o/r/actions/runs/${n}`;
const issues = [
  { number: 11, title: "nightly-red: vacuity", label: "nightly-red", run: RUN(500), runTruncated: false },
  { number: 12, title: "nightly-red: main: Vitest", label: "nightly-red", run: RUN(600), runTruncated: false },
  { number: 13, title: "nightly-red: branch-prune", label: "nightly-red", run: null, runTruncated: true },
  { number: 20, title: "🚨 Production is DOWN", label: "prod-down" },
];
const ledger = [
  { fingerprint: "aaaaaaaaaaaa1111", source_kind: "nightly_red", source: "nightly-red", status: "open", title: "nightly-red: vacuity", sample_ref: { issue: 11 } },
  { fingerprint: "bbbbbbbbbbbb2222", source_kind: "nightly_red", source: "nightly-red", status: "open", title: "nightly-red: feature-switch-audience", sample_ref: {} },
  { fingerprint: "cccccccccccc3333", source_kind: "sentry", source: "sentry:assets/app-shared", status: "open", title: "error: permission denied for table jobs", sample_ref: {} },
];
const BASE = "# OPEN\n\n## FEEDS — x\n\n- [ ] **Q1 LOW something else.** keep me.\n\n## CARRIED\n";
const opts = (over = {}) => ({ status: () => "open" as const, nextFree: 100, today: "2026-10-14", ...over });

describe("all red overnight checks are ONE OPEN.md item", () => {
  it("groups every nightly-red issue and nightly_red ledger row into one robots group; other alerts stay separate", () => {
    const groups = groupSources({ ledger, issues });
    const robots = groups.filter((g) => g.robots);
    expect(robots).toHaveLength(1);
    expect(robots[0].robots!.map((m) => [m.workflow, m.issue])).toEqual([
      ["vacuity", 11], ["main: Vitest", 12], ["branch-prune", 13], ["feature-switch-audience", null],
    ]);
    expect(robots[0].robots![0].keys).toEqual(["issue #11", "ledger aaaaaaaaaaaa"]);
    expect(groups.filter((g) => !g.robots).map((g) => g.keys)).toEqual([["issue #20"], ["ledger cccccccccccc"]]);
  });

  it("files ONE item (not one per workflow) with a sub-line per check: workflow, issue, newest red run", () => {
    const res = applyFeeds(BASE, groupSources({ ledger, issues }), opts());
    const items = queueItems(res.md);
    const robots = items.filter((it) => isRobotsItem(it.text));
    expect(robots).toHaveLength(1);
    expect(robots[0].text.split("\n")[0]).toContain("Fix the test robots: 4 overnight checks red.");
    expect(robotMembersOf(robots[0].text).map((m) => m.workflow)).toEqual(["vacuity", "main: Vitest", "branch-prune", "feature-switch-audience"]);
    expect(robots[0].text).toContain(`issue #11, newest red run ${RUN(500)}`);
    expect(robots[0].text).toContain("issue #13, newest red run: see the issue's latest comment");
    // prod-down and the sentry row: one item each; nothing else filed for a robot
    expect(res.created.map((c) => c.keys)).toEqual([["issue #20"], ["ledger cccccccccccc"]]);
    expect(feedCounts(res.md).robots).toBe(4);
    expect(res.md).toContain("- [ ] **Q1 LOW something else.** keep me.");
  });

  it("rewrites the sub-lines each sync under the same number, keeping a member's notes; a closed check drops off", () => {
    const first = applyFeeds(BASE, groupSources({ ledger, issues }), opts()).md;
    const id = queueItems(first).find((it) => isRobotsItem(it.text))!.id;
    const noted = first.replace(/( {2}- main: Vitest: issue #12, newest red run \S+\.)( feed:)/, "$1 notes: Q1814.$2");
    expect(noted).not.toBe(first);
    const later = applyFeeds(noted, groupSources({ ledger: ledger.slice(1), issues: issues.filter((i) => i.number !== 11) }), opts({ nextFree: 200 }));
    const it2 = queueItems(later.md).find((it) => isRobotsItem(it.text))!;
    expect(it2.id).toBe(id);
    expect(it2.text.split("\n")[0]).toContain("Fix the test robots: 3 overnight checks red.");
    expect(it2.text).toContain("notes: Q1814.");
    expect(tagsOf(it2.text)).not.toContain("issue #11");
    expect(later.md.split("\n").filter((l) => l.includes(ROBOTS_MARK))).toHaveLength(1);
    // re-running on its own output changes nothing
    expect(applyFeeds(later.md, groupSources({ ledger: ledger.slice(1), issues: issues.filter((i) => i.number !== 11) }), opts({ nextFree: 300 })).md).toBe(later.md);
  });

  it("ticks the item, naming its guard, when no check is red; never flips it to [~] on its own", () => {
    const first = applyFeeds(BASE, groupSources({ ledger, issues }), opts()).md;
    const done = applyFeeds(first, groupSources({ ledger: [], issues: [] }), opts({ status: () => "closed" as const }));
    const it = queueItems(done.md).find((x) => isRobotsItem(x.text))!;
    expect(it.state).toBe("x");
    expect(it.text).toContain("0 overnight checks red");
    expect(it.text).toContain("src/test/openRobotsRollup.test.ts");
    expect(done.flipped).not.toContain(it.id);
  });

  it("leaves the item alone when a feed was unreadable", () => {
    const first = applyFeeds(BASE, groupSources({ ledger, issues }), opts()).md;
    const robotsText = (md: string) => queueItems(md).find((x) => isRobotsItem(x.text))!.text;
    const after = applyFeeds(first, groupSources({ ledger: [], issues: [] }), opts({ robotsReadable: false, status: () => "closed" as const })).md;
    expect(robotsText(after)).toBe(robotsText(first));
  });

  it("refuses (ambiguous) instead of writing a second copy when another open item still carries a member's tag", () => {
    const md = BASE.replace("keep me.", "keep me. feed: issue #12");
    const res = applyFeeds(md, groupSources({ ledger, issues }), opts());
    expect(res.ambiguous).toEqual([{ keys: ["issue #12"], ids: ["Q1"] }]);
    expect(queueItems(res.md).some((it) => isRobotsItem(it.text))).toBe(false);
  });

  it("takes the newest run from the issue body and its comments", () => {
    expect(newestRunUrl(["Run: " + RUN(5), "Still red: " + RUN(9), "Still red: " + RUN(7)])).toBe(RUN(9));
    expect(newestRunUrl([undefined, "no link"])).toBeNull();
  });

  it("the real OPEN.md: every open nightly-red source is on the ONE robots item and nowhere else", () => {
    const md = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
    const snap = JSON.parse(readFileSync(join(ROOT, SNAPSHOT), "utf8")) as {
      issues: { open: { number: number; label?: string }[] };
      ledger: { open: { fingerprint: string; source_kind: string }[] };
    };
    const items = queueItems(md);
    expect(items.length).toBeGreaterThan(100);
    const robotItems = items.filter((it) => it.state !== "x" && isRobotsItem(it.text));
    expect(robotItems.length).toBeLessThanOrEqual(1);
    const robotKeys = [
      ...snap.issues.open.filter((i) => (i.label ?? "nightly-red") === "nightly-red").map((i) => `issue #${i.number}`),
      ...snap.ledger.open.filter((r) => r.source_kind === "nightly_red").map((r) => `ledger ${r.fingerprint.slice(0, 12)}`),
    ];
    const by = mirrored(md);
    const off = robotKeys.filter((k) => (by.get(k) ?? []).some((id) => id !== robotItems[0]?.id));
    expect(off, "a red overnight check is mirrored outside the robots item").toEqual([]);
    if (robotKeys.length) {
      expect(robotItems).toHaveLength(1);
      const n = Number(/Fix the test robots: (\d+) overnight/.exec(robotItems[0].text)?.[1]);
      expect(n).toBe(robotMembersOf(robotItems[0].text).length);
    }
  });
});
