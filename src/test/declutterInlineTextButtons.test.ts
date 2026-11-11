/**
 * CLASS GUARD (Q2709, 2026-11-04 night; owner 10-31 "Nothing hand-made"): a word-sized action inside a Declutter
 * sentence is the shared InlineTextButton (src/components/ui/InlineTextButton.tsx: link-standard, its 44px touch
 * overlay, a text-sized box), never a hand-made <button>. Moved in this packet: the price nudge's "Drop the price?",
 * the question box's "Make an offer", the Selling tab's "Show N sales" toggle. Each kept its own classes (weight,
 * ink, the drawn underline), so at rest it reads the same; the ratchet fell by 3 in the same commit.
 *
 * @mutate src/components/declutter/DeclutterPriceNudge.tsx | <InlineTextButton className="font-semibold underline underline-offset-2" onClick={onOpen}> | <button type="button" className="font-semibold underline underline-offset-2" onClick={onOpen}>
 * @mutate src/components/declutter/DeclutterQuestions.tsx | <InlineTextButton className="font-semibold text-foreground underline underline-offset-2" onClick={onMakeOffer} | <InlineTextButton className="font-semibold text-foreground" onClick={onMakeOffer}
 * @mutate src/components/declutter/DeclutterManageListing.tsx | <InlineTextButton className="text-ds-14 font-semibold underline underline-offset-2" onClick={() => setFloor(price)}> | <button type="button" className="min-h-11 text-ds-14 font-semibold underline underline-offset-2" onClick={() => setFloor(price)}>
 * @mutate src/components/declutter/DeclutterTabParts.tsx | <InlineTextButton className="text-sm font-medium underline underline-offset-2" aria-expanded={showDone} | <span className="text-sm font-medium underline underline-offset-2" aria-expanded={showDone}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const CASES: Array<[file: string, label: RegExp]> = [
  ["src/components/declutter/DeclutterPriceNudge.tsx", /Drop the price\?/],
  ["src/components/declutter/DeclutterQuestions.tsx", /dq\.makeOffer/],
  ["src/components/declutter/DeclutterTabParts.tsx", /data-done-sales-toggle/],
  // 11-05 night: the price sheet's "Also set lowest to $X" (was a hand-made 44px-tall text button on its own line).
  ["src/components/declutter/DeclutterManageListing.tsx", /Also set lowest to/],
];

describe("Declutter's in-sentence actions are the shared InlineTextButton (Q2709)", () => {
  it("each moved action is an InlineTextButton that keeps its drawn underline", () => {
    expect(CASES.length).toBeGreaterThan(3);
    for (const [file, label] of CASES) {
      const src = blankComments(readFileSync(resolve(REPO, file), "utf8"));
      const tags = [...src.matchAll(/<InlineTextButton\b[^>]*>[\s\S]*?<\/InlineTextButton>/g)].map((m) => m[0]);
      const tag = tags.find((t) => label.test(t));
      expect(tag, `${file}: the action is not an InlineTextButton`).toBeDefined();
      expect(tag!, `${file}: lost its drawn underline`).toMatch(/\bunderline underline-offset-2\b/);
      expect(src, `${file}: a hand-made <button> is back`).not.toMatch(/<button\b/);
    }
  });
});
