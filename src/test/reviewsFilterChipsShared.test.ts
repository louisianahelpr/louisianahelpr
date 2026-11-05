/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the You -> Reviews "about you" filter
 * chips (All / As a Helpr / As a poster, each with its count) are the shared ToggleChip (src/components/ui: the
 * 44px pill, the shared selected gloss, the offset focus ring, aria-pressed), never a hand-made <button
 * aria-pressed>. The scroll row gives the ring room (py-1: ring 2px + offset 2px would be clipped by py-0.5).
 * hand-made-controls-baseline and hand-made-toggle-chips-baseline both drop the file in the same commit.
 *
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx | <ToggleChip\n            key={c.value}\n            pressed={on} | <ToggleChip\n            key={c.value}\n            pressed={false}
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx | overflow-x-auto px-1 py-1 | overflow-x-auto px-1 py-0.5
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/profile/reviewsTab/reviewsAboutYou.tsx"), "utf8"));

describe("the reviews-about-you filter chips are the shared ToggleChip (Q2709)", () => {
  it("each chip is a ToggleChip pressed when it is the chosen filter, in a row that leaves its ring room", () => {
    expect(src).toMatch(/<ToggleChip\s+key=\{c\.value\}\s+pressed=\{on\}\s+data-review-filter=\{c\.value\}\s+onClick=\{\(\) => onChange\(c\.value\)\}\s*>/);
    expect(src).toMatch(/role="group" aria-label="Filter reviews" className="[^"]*\bpy-1\b/);
    expect(src).not.toMatch(/<button\b/);
  });
});
