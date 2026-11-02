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
import { itemOriginKey, queueText } from "../../scripts/lib/openQueue.mjs";
import { isFeedMirrored } from "../../scripts/lib/openFeeds.mjs";

// @mutate scripts/lib/openFeeds.mjs | export const isFeedMirrored = (text) => tagsOf(text).length > 0; | export const isFeedMirrored = (text) => false;
// @mutate scripts/lib/openQueue.mjs |   if (f) return `finding ${f[1].toLowerCase()}`; |   if (f) return null;
// @mutate src/test/reviewFindingsCarryATag.test.ts | !TAGGED.test(l) && !isFeedMirror(l) && !isFeedMirrored(l);\n} | !TAGGED.test(l);\n}
// @mutate src/test/reviewFindingsCarryATag.test.ts | return entries.filter((q) => !all.includes(q));\n} | return [];\n}
// @mutate src/test/reviewFindingsCarryATag.test.ts | const wholeQueue = queueText(process.cwd());\n | const wholeQueue = "";\n

const OPEN = readFileSync(join(process.cwd(), "docs/OPEN.md"), "utf8").split("\n");
const REVIEW = /\b(?:review(?:ed)?|should-fix|must-fix)\b(?!:(?:record|report)\b)/i; // `npm run review:record` / `review:report` are script names, not a review
const TAGGED = /\bfinding: [a-z0-9-]+@[0-9a-f]{7,40}#\d+/i;
// An item mirrored from an alert feed already carries ONE stable origin tag,
// its `feed:` key (scripts/lib/openFeeds.mjs; open-sync-trackers.mjs files one
// item per source). Its title is the alert's, so "nightly-red: main: sensitive
// review record" (Q1654, bot PR #2717, 2026-10-12) says "review" without being
// a reviewer's finding.

// The highest item number when the rule landed (2026-10-05). Items above it
// are filed under the rule and must carry a tag.
const LAST_UNTAGGED = 1373;

const ITEM_LINE = /^- \[[ x~]\] \*\*Q\d+/;
const ITEMS = OPEN.filter((l) => ITEM_LINE.test(l));
const num = (l: string) => Number(/\*\*Q(\d+)/.exec(l)![1]);
/**
 * Items that say "review" but were NOT filed from a review (an owner decision
 * about the ban settlement REVIEW feature, say). Exact both ways: an entry
 * must still be an untagged review-worded item, or it is removed.
 */
// @two-way src/test/reviewFindingsCarryATag.test.ts:NOT_FROM_A_REVIEW is exact: every entry is still untagged and review-worded
const NOT_FROM_A_REVIEW: Record<string, string> = {
  Q2484: "the owner-approved Jobs ease-of-use list (2026-10-29, audit page UX-3/4/6/7, builder 73); \"review\" is the review prompt it adds after I got it / Mark done, not a filed finding",
  Q2478: "the owner's Jobs best-in-class item (2026-10-29: trust line, reply speed, Get help now); \"review\" names the lh-authz-rls pass on get_reply_speed and the reviews feature, not a filed finding",
  Q2476: "the lead's photo-edit follow-up to Q2475 (2026-10-29); \"review\" is the listing going back to pending_review, not a filed finding",
  Q2435: "the owner-approved busy-area map item (lead 2026-10-27, growth lane); \"lh-money-escrow review\" names a review its build will need, not a filed finding",
  Q2434: "the owner-approved favorite Helprs item (lead 2026-10-27, growth lane); \"lh-authz-rls review\" names a review its build will need, not a filed finding",
  Q2417: "Lander 9's measured e2e red (2026-10-27); \"Review bar\" is the Post a job screen's floating Review bar, not a filed finding",
  Q2374: "ui-builder-5's parked Explore follow-up WIP (2026-10-23); \"not yet reviewed\" is its own screenshots still to look at, not a filed finding",
  Q2361: "the owner's completion-notice-counts-photos item (2026-10-23); \"Review them\" is the notice's own copy and the code-review it names found a bug fixed in the same branch, not a filed finding",
  Q2328: "an owner question about the member-to-member review notice (double-blind reviews), filed with Q2327; not a code reviewer's finding",
  Q2275: "the owner's saved-searches-for-every-section feature item (board 91, lead 2026-10-21); \"review on the migration\" names a review its build will need, not a filed finding",
  Q2272: "an owner decision on board 141 (a refund-request feature), mapped by Builder 5 on 2026-10-21; its \"review\" wording describes how disputes are decided today, not a filed finding",
  Q1790: "Apple's App Review (the reviewer's demo password), found preparing the 1.0.4 resubmission; not a code reviewer's finding",
  Q1791: "Apple's App Review rule 5.1.1(v), found preparing the 1.0.4 resubmission; not a code reviewer's finding",
  Q1793: "Apple's App Review demo account, found preparing the 1.0.4 resubmission; not a code reviewer's finding",
  Q1892: "\"Identity Review\" is the admin screen's title (the reds lane looked at /admin?view=idvreview at 375 on prod); not a code reviewer's finding",
  Q2112: "the lead measuring prod analytics_events (robot traffic in the sign-up funnel), salvaged from ready/train-big-1016; not a code reviewer's finding",
  Q2082: "the owner's jobs-fee feature item; it lists lh-money-escrow review points of slice 3a as before-the-flip conditions, not a filed finding",
  Q1901: "the loading-states budget red mirrored from a CI run; \"lead review\" notes why the budget was left, not a filed finding",
  // Q2229 (the owner's D4 lease feature, Homes) moved to docs/NOT-LAUNCHED.md on 2026-11-01 (owner rule: unlaunched
  // areas are not open items). Re-add its entry here if it moves back into the queue.
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
/**
 * The entries that are not an untagged review-worded item ANYWHERE in the queue
 * (docs/OPEN.md + the done archives). Reading OPEN.md alone turned every bot PR
 * red that ticked a listed item: open-auto-tick moves the line to an archive and
 * may only change docs paths, so it cannot edit this file (Q2476, PR #3820,
 * 2026-10-31). A ticked entry exempts nothing, because untaggedNew reads OPEN.md
 * only, and whoever next edits this list may drop it.
 */
function staleExemptions(entries: string[], queueLines: string[]): string[] {
  const all = queueLines.filter((l) => ITEM_LINE.test(l) && num(l) > LAST_UNTAGGED && isUntaggedReviewItem(l)).map((l) => `Q${num(l)}`);
  return entries.filter((q) => !all.includes(q));
}

describe("review findings carry one stable tag, so a finding cannot be filed twice", () => {
  it("every review item filed after the rule carries a finding tag", () => {
    expect(ITEMS.length).toBeGreaterThan(100); // reads a real queue (196 open on 2026-10-07; the list is shrinking)
    expect(untaggedNew(), "file review findings with `finding: <reviewer>@<sha>#<n>`").toEqual([]);
  });

  it("NOT_FROM_A_REVIEW is exact: every entry is still untagged and review-worded", () => {
    const wholeQueue = queueText(process.cwd());
    expect(staleExemptions(Object.keys(NOT_FROM_A_REVIEW), wholeQueue.split("\n"))).toEqual([]);
  });

  it("an entry the bot ticked into an archive is not stale; a number nowhere, or a line now tagged or not review-worded, is (bot PR #3820)", () => {
    const worded = (n: number, s: string, tail = "") => `- [${s}] **Q${n} MEDIUM back to review on save.**${tail}`;
    // open, or ticked by the bot and moved to the archive: the queue holds both
    expect(staleExemptions(["Q2000", "Q2001"], [worded(2000, "~"), "", worded(2001, "x", " DONE (auto-tick).")])).toEqual([]);
    expect(staleExemptions(["Q2002"], [worded(2000, "~")])).toEqual(["Q2002"]);
    expect(staleExemptions(["Q2000"], [worded(2000, "x", " finding: lh-money-escrow@abc1234#3")])).toEqual(["Q2000"]);
    expect(staleExemptions(["Q2000"], ["- [x] **Q2000 MEDIUM a copy fix.** DONE."])).toEqual(["Q2000"]);
    // below the rule's first number an entry exempts nothing
    expect(staleExemptions(["Q1000"], [worded(1000, "x")])).toEqual(["Q1000"]);
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
