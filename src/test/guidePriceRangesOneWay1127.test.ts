/**
 * Polish audit 11-27 #145 (~/.lh-shots/polish-audit-1127/FINDINGS.md, guides/kids--out-375--filter-open.png): price
 * ranges were written three ways: section bands "$25 to $50" / "$100 and up", the Kids filter chips "$25–$50" /
 * "$50+", and the gift quiz like the bands. Every range label is now "Under $N", "$A–$B" (en dash) or "$N+" (owner
 * 11-21: "sections that go by price 25 50 75 100+"); "Stocking stuffers under $10" keeps the owner's own name (11-23)
 * and "Price coming soon" is not a range. Inventory: the bands, the Kids price chips and the quiz budgets.
 *
 * @mutate src/content/giftGuides.ts |     "25-to-50": "$25–$50", |     "25-to-50": "$25 to $50",
 * @mutate src/content/giftGuides.ts |     "100-and-up": "$100+", |     "100-and-up": "$100 and up",
 * @mutate src/content/giftQuiz.ts | label: "$100+", min: 100 | label: "$100 and up", min: 100
 * @mutate src/content/giftGuideKidsFilter.ts | label: "$50+", lo: 50 | label: "$50 and up", lo: 50
 */
import { describe, it, expect } from "vitest";
import { giftGuides } from "@/content/giftGuides";
import { QUIZ_BUDGETS } from "@/content/giftQuiz";
import { KID_PRICES } from "@/content/giftGuideKidsFilter";

const OWNER_NAMED = new Set(["Stocking stuffers under $10", "Price coming soon"]);
const ONE_WAY = /^(?:Under \$\d+|\$\d+–\$\d+|\$\d+\+)$/;

const labels = [
  ...Object.values(giftGuides.priceSection).filter((l) => !OWNER_NAMED.has(l)),
  ...KID_PRICES.map((p) => p.label),
  ...QUIZ_BUDGETS.map((b) => b.label),
];

describe("#145: every guide price range is written one way", () => {
  it("reads every band, chip and quiz budget (inventory floor)", () => {
    expect(labels.length).toBeGreaterThan(12);
  });
  it.each(labels)("%s", (label) => {
    expect(label).toMatch(ONE_WAY);
  });
  it("the section bands and the quiz budgets use the same words", () => {
    const bands = Object.values(giftGuides.priceSection).filter((l) => !OWNER_NAMED.has(l));
    expect(QUIZ_BUDGETS.map((b) => b.label)).toEqual(bands);
  });
});
