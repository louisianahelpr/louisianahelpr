/*
 * GUARD (2026-10-03): one item is never counted under two numbers.
 *
 * scripts/open-renumber.mjs met the SAME item twice under one number (ticked
 * into an archive by the landing branch, still open in docs/OPEN.md on main),
 * took the pair for a number collision and gave the ticked copy a fresh number.
 * f38b17024 made Q456 -> Q919, Q877 -> Q920, Q878 -> Q921, Q897 -> Q922,
 * Q899 -> Q923 and Q900 -> Q924, and Q732 was an exact copy of Q708: Q456 was
 * counted open AND done, six done items were counted twice, and the queue said
 * 925 items where there were 918. Every count keyed on the number
 * (queue-count, the Everything-open block) was wrong and no check could see it.
 *
 * Class check: across docs/OPEN.md and every done archive, no two numbers share
 * an origin (scripts/lib/openQueue.mjs itemOriginKey: a feed item's
 * "Mirrored|Filed <date> from <source>", else its first 100 characters). An
 * alert that fires again on a later date is mirrored as a NEW item with a
 * different date, so real repeats (staleness-watch red twice: Q917, Q787) pass.
 * Red first: 7 groups on origin/main at ca5acf08d.
 */
// @mutate scripts/lib/openQueue.mjs | .filter(([, ids]) => ids.size > 1) | .filter(([, ids]) => ids.size > 99)
// @mutate scripts/lib/openQueue.mjs |   if (o) return `origin ${o[1]} ${o[2].toLowerCase()}`; |   if (o) return `origin ${line}`;
import { describe, it, expect } from "vitest";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { queueText, duplicateItems, itemOriginKey } from "../../scripts/lib/openQueue.mjs";

const ROOT = join(__dirname, "..", "..");
const fed = (n: number, s: string, date: string, extra = "") =>
  `- [${s}] **Q${n} nightly-red: x is red.**${extra} Mirrored ${date} from nightly-red issue #7 and alert-ledger row 0123456789ab by \`scripts/open-sync-trackers.mjs\`: find the root cause.`;
const LONG = "(lh-money-escrow review, 2026-09-25, code read only): a job left at payment_status 'cancelling' is picked up by nothing";

describe("no item is counted under two numbers", () => {
  it("the real queue (OPEN.md + archives) has no item under two numbers", () => {
    const md = queueText(ROOT);
    expect(md.split("\n").filter((l: string) => /^- \[[ x~]\] \*\*Q\d+/.test(l)).length).toBeGreaterThan(500);
    expect(duplicateItems(md)).toEqual([]);
  });

  it("a ticked copy renumbered away from its open original is caught", () => {
    const md = [fed(5, " ", "2026-09-30"), fed(9, "x", "2026-09-30", " DONE 2026-10-02: closed.")].join("\n");
    expect(duplicateItems(md)).toEqual([
      { key: "origin 2026-09-30 nightly-red issue #7 and alert-ledger row 0123456789ab", items: [{ id: "Q5", state: " " }, { id: "Q9", state: "x" }] },
    ]);
  });

  it("an unfed item copied under a new number is caught by its text", () => {
    expect(duplicateItems([`- [ ] **Q456** ${LONG}`, `- [x] **Q919** ${LONG} DONE.`].join("\n")).map((g: { items: { id: string }[] }) => g.items.map((i) => i.id))).toEqual([["Q456", "Q919"]]);
  });

  it("the same alert firing again on a later date is a new item, not a copy", () => {
    expect(duplicateItems([fed(5, "x", "2026-09-30"), fed(9, " ", "2026-10-02")].join("\n"))).toEqual([]);
  });

  it("short heads say too little to call two items one", () => {
    expect(itemOriginKey("- [ ] **Q1 Fix it.** soon")).toBeNull();
    expect(duplicateItems(["- [ ] **Q1 Fix it.** soon", "- [x] **Q2 Fix it.** soon"].join("\n"))).toEqual([]);
  });
});
