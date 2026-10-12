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
import { isFeedMirrored } from "../../scripts/lib/openFeeds.mjs";

// @mutate scripts/lib/openFeeds.mjs | export const isFeedMirrored = (text) => tagsOf(text).length > 0; | export const isFeedMirrored = (text) => false;
// @mutate scripts/lib/openQueue.mjs |   if (f) return `finding ${f[1].toLowerCase()}`; |   if (f) return null;
// @mutate src/test/reviewFindingsCarryATag.test.ts | !TAGGED.test(l) && !isFeedMirror(l) && !isFeedMirrored(l);\n} | !TAGGED.test(l);\n}

const OPEN = readFileSync(join(process.cwd(), "docs/OPEN.md"), "utf8").split("\n");
const REVIEW = /\b(?:review(?:ed)?|should-fix|must-fix)\b/i;
const TAGGED = /\bfinding: [a-z0-9-]+@[0-9a-f]{7,40}#\d+/i;
// An item mirrored from an alert feed already carries ONE stable origin tag,
// its `feed:` key (scripts/lib/openFeeds.mjs; open-sync-trackers.mjs files one
// item per source). Its title is the alert's, so "nightly-red: main: sensitive
// review record" (Q1654, bot PR #2717, 2026-10-12) says "review" without being
// a reviewer's finding.

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
  Q1496: "seen by the money-b lane while fixing Q1413, not a reviewer's finding",
  Q1690: "found by the lane closing Q1511, not a reviewer's finding; its text says the lh-silent-failure review narrowed the fix",
};
/**
 * An item MIRRORED from a feed (nightly-red issue, ops ledger, audit bus) is
 * not a review finding even when the feed's title says "review": it already
 * has one stable origin key, its `Mirrored <date> from <source>` (itemOriginKey
 * "origin ..."), so openNoDuplicateItems already refuses a second copy. Bot PR
 * #2705 went red here on "nightly-red: main: Sensitive review record is red."
 * (the sensitive-review workflow's own name), mirrored by
 * scripts/open-sync-trackers.mjs, which can never write a finding tag.
 */
const isFeedMirror = (l: string) => String(itemOriginKey(l) ?? "").startsWith("origin ");
function isUntaggedReviewItem(l: string): boolean {
  return REVIEW.test(l) && !TAGGED.test(l) && !isFeedMirror(l) && !isFeedMirrored(l);
}
function untaggedNewAll(): string[] {
  return ITEMS.filter((l) => num(l) > LAST_UNTAGGED && isUntaggedReviewItem(l)).map((l) => `Q${num(l)}`);
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
  it("a feed-mirrored item is not a review finding; a hand-filed review line still is (#2705)", () => {
    const mirrored =
      "- [ ] **Q1652 MEDIUM nightly-red: main: Sensitive review record is red.** Mirrored 2026-10-12 from nightly-red issue #2687 and alert-ledger row e41c806b9175 by `scripts/open-sync-trackers.mjs`: find the root cause, fix it, re-run the source's own detector. feed: issue #2687 · feed: ledger e41c806b9175.";
    expect(isUntaggedReviewItem(mirrored)).toBe(false);
    const handFiled = "- [ ] **Q9999 MEDIUM The lh-authz-rls review found the crew RPC skips the ban check (filed from the 2026-10-12 review).**";
    expect(isUntaggedReviewItem(handFiled)).toBe(true);
    // A hand-filed line that merely says "mirrored" without a feed source keeps the rule.
    expect(isUntaggedReviewItem("- [ ] **Q9998 LOW review: mirrored the copy fix to Android.**")).toBe(true);
  });

  it("a feed-mirrored item is tagged by its feed key; a plain review-worded one is not", () => {
    const mirrored = "- [ ] **Q1654 MEDIUM nightly-red: main: sensitive review record.** Mirrored 2026-10-12 from alert-ledger row e41c806b9175 by `scripts/open-sync-trackers.mjs`. feed: ledger e41c806b9175. done-when: x";
    expect(isFeedMirrored(mirrored)).toBe(true);
    expect(isFeedMirrored("- [ ] **Q1700 LOW a reviewer said fix it.**")).toBe(false);
    expect(isFeedMirrored("- [ ] **Q1701 LOW x.** feed: issue #2615.")).toBe(true);
  });
  it("two numbers with one finding tag share one origin key", () => {
    const a = "- [ ] **Q1 LOW A thing (x) finding: lh-money-escrow@abc1234#3**";
    const b = "- [x] **Q2 MEDIUM Different words entirely, finding: lh-money-escrow@abc1234#3**";
    expect(itemOriginKey(a)).toBe(itemOriginKey(b));
    expect(itemOriginKey(a)).toBe("finding lh-money-escrow@abc1234#3");
  });
});
