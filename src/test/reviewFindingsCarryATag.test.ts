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
 * This file: (1) an open review item filed WITHOUT a tag can only shrink the
 * count below (exact, two-way: lower it as old items close or get tagged);
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

// Open review-derived items still WITHOUT a finding tag (measured 2026-10-05).
// Exact: lower it in the commit that closes or tags one; it never goes up.
const UNTAGGED_REVIEW_ITEMS = 84;

function untagged(): string[] {
  return OPEN.filter((l) => /^- \[[ ~]\] \*\*Q\d+/.test(l) && REVIEW.test(l) && !TAGGED.test(l)).map(
    (l) => /\*\*(Q\d+)/.exec(l)![1],
  );
}

describe("review findings carry one stable tag, so a finding cannot be filed twice", () => {
  it("the untagged count is exact (lower it as items close; new review items must be tagged)", () => {
    const now = untagged();
    expect(now.length, `untagged review items: ${now.join(", ")}`).toBe(UNTAGGED_REVIEW_ITEMS);
    expect(OPEN.length).toBeGreaterThan(500);
  });
  it("two numbers with one finding tag share one origin key", () => {
    const a = "- [ ] **Q1 LOW A thing (x) finding: lh-money-escrow@abc1234#3**";
    const b = "- [x] **Q2 MEDIUM Different words entirely, finding: lh-money-escrow@abc1234#3**";
    expect(itemOriginKey(a)).toBe(itemOriginKey(b));
    expect(itemOriginKey(a)).toBe("finding lh-money-escrow@abc1234#3");
  });
});
