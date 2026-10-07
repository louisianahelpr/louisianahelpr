/**
 * GUARD (owner 2026-10-05: "there needs to be some rules that the duplicates
 * can not be added"): on 2026-10-05 three review findings were filed twice,
 * once by the lane that fixed them and once again as "follow-ups to file"
 * (Q1333/Q1334/Q1335 duplicated the money lane's own fixes), so the open count
 * carried finished work.
 *
 * Rule: every open item filed from a review carries ONE stable tag,
 * `finding: <reviewer>@<reviewed-sha>#<n>`, written by whoever files it.
 * openNoDuplicateItems (via scripts/lib/openQueue.mjs itemOriginKey) then
 * treats two numbers with one tag as one item and fails.
 *
 * This file: (1) every review item filed AFTER the rule (number above
 * LAST_UNTAGGED, the highest number when it landed) carries a tag; older items
 * are not counted, so the auto-tick bot closing one never breaks a baseline
 * (a 2026-10-05 exact count of 85 did exactly that on bot PR #2350);
 * (2) the tag really is the origin key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no declaration file
import { itemOriginKey } from "../../scripts/lib/openQueue.mjs";

// @mutate scripts/lib/openQueue.mjs |   if (f) return `finding ${f[1].toLowerCase()}`; |   if (f) return null;

const OPEN = readFileSync(join(process.cwd(), "docs/OPEN.md"), "utf8").split("\n");
const REVIEW = /\b(?:review(?:ed)?|should-fix|must-fix)\b/i;
const TAGGED = /\bfinding: [a-z0-9-]+@[0-9a-f]{7,40}#\d+/i;

// The highest item number when the rule landed (2026-10-05). Items above it
// are filed under the rule and must carry a tag.
const LAST_UNTAGGED = 1373;

const ITEMS = OPEN.filter((l) => /^- \[[ x~]\] \*\*Q\d+/.test(l));
const num = (l: string) => Number(/\*\*Q(\d+)/.exec(l)![1]);
/**
 * Items that say "review" but were NOT filed from a review (an owner decision
 * about the ban settlement REVIEW feature, say). Exact both ways: an entry
 * must still be an untagged review-worded item, or it is removed.
 */
// @two-way src/test/reviewFindingsCarryATag.test.ts:NOT_FROM_A_REVIEW is exact: every entry is still untagged and review-worded
const NOT_FROM_A_REVIEW: Record<string, string> = {
};
function untaggedNewAll(): string[] {
  return ITEMS.filter((l) => num(l) > LAST_UNTAGGED && REVIEW.test(l) && !TAGGED.test(l)).map((l) => `Q${num(l)}`);
}
function untaggedNew(): string[] {
  return untaggedNewAll().filter((q) => !(q in NOT_FROM_A_REVIEW));
}

describe("review findings carry one stable tag, so a finding cannot be filed twice", () => {
  it("every review item filed after the rule carries a finding tag", () => {
    expect(ITEMS.length).toBeGreaterThan(100); // reads a real queue (196 open on 2026-10-07; the list is shrinking)
    expect(untaggedNew(), "file review findings with `finding: <reviewer>@<sha>#<n>`").toEqual([]);
  });

  it("NOT_FROM_A_REVIEW is exact: every entry is still untagged and review-worded", () => {
    const all = untaggedNewAll();
    expect(Object.keys(NOT_FROM_A_REVIEW).filter((q) => !all.includes(q))).toEqual([]);
  });
  it("two numbers with one finding tag share one origin key", () => {
    const a = "- [ ] **Q1 LOW A thing (x) finding: lh-money-escrow@abc1234#3**";
    const b = "- [x] **Q2 MEDIUM Different words entirely, finding: lh-money-escrow@abc1234#3**";
    expect(itemOriginKey(a)).toBe(itemOriginKey(b));
    expect(itemOriginKey(a)).toBe("finding lh-money-escrow@abc1234#3");
  });
});
