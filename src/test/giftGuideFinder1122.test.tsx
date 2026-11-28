/**
 * GUARD (Guides polish audit 1122 #23): Find a gift.
 *  - The quiz's budgets are the guides' five price bands, same labels.
 *  - (Superseded by guide visual audit 1123b #1: the finder view opens at the page top, so the card carries no #gift-finder
 *    id to jump to; the full arrival check is src/test/giftGuideVisual1123.test.tsx.)
 *  - Four results lay out two by two, so one is never left alone on a row.
 *
 * @mutate src/content/giftQuiz.ts | { id: "50-75", label: "$50–$75", min: 50, max: 74 }, | { id: "50-100", label: "$50 to $100", min: 50, max: 99 },
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx |     <section aria-labelledby={FINDER_TITLE_ID} | <section id={FINDER_ID} aria-labelledby={FINDER_TITLE_ID}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-quiz-list[data-quiz-count="4"]{grid-template-columns:repeat(2,minmax(0,1fr))} | .gg-quiz-list[data-quiz-count="4"]{grid-template-columns:repeat(3,minmax(0,1fr))}
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx | data-quiz-count={shown.length} | data-quiz-x={shown.length}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QUIZ_BUDGETS } from "@/content/giftQuiz";
import { giftGuides as G } from "@/content/giftGuides";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

describe("Find a gift (guides polish 1122 #23)", () => {
  it("uses the guides' price bands and labels", () => {
    const sec = G.priceSection as Record<string, string>;
    const ids = ["under-25", "25-to-50", "50-to-75", "75-to-100", "100-and-up"];
    expect(QUIZ_BUDGETS.map((b) => b.id)).toEqual(["under-25", "25-50", "50-75", "75-100", "100-plus"]);
    expect(QUIZ_BUDGETS.map((b) => b.label.toLowerCase())).toEqual(
      ids.map((i) => sec[i].toLowerCase()),
    );
  });
  it("the card is not a #gift-finder jump target (the view opens at the top, guide visual 1123b #1)", () => {
    const src = readFileSync("src/pages/info/giftGuides/GiftGuideFinder.tsx", "utf8");
    expect(src).toContain('<section aria-labelledby={FINDER_TITLE_ID} className="gg-finder gg-quiz"');
    expect(src).not.toMatch(/<section id=/);
  });
  it("lays four results out two by two", () => {
    expect(GIFT_GUIDES_CSS).toContain('.gg-quiz-list[data-quiz-count="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}');
    const src = readFileSync("src/pages/info/giftGuides/GiftGuideFinder.tsx", "utf8");
    expect(src).toContain("data-quiz-count={shown.length}");
  });
});
