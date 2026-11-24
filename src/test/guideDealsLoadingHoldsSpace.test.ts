import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

/**
 * Guide speed 1124 (speed-1122n S4/S5). A deals day page (Black Friday, Small Business Saturday, Cyber Monday) said
 * "Loading your list…" (the wish list's words) while its chunk loaded, then "Loading deals…", then drew its cards, and
 * each step moved the page: with only one short line on screen, the footer and the Discount codes section sat in view
 * and were pushed down when the cards came in (cwv-lab, local build, Slow 4G + 4x, 375: CLS 0.88 on Black Friday,
 * 0.87 on Cyber Monday; shifts footer y 503 -> off screen, codes section y 440 -> off screen).
 * Now both loading lines say the deals words and hold a screen of space, as the guides' picks line already did, and the
 * deals chunk starts as the page's module runs (the deals file beside the app: routePreload.publicPages.test.ts).
 *
 * @mutate src/pages/info/GiftGuides.tsx | data-gift-deals-loading="">{DEALS_WORDS.loading} | >{WISH.loading}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | role="status" data-gift-deals-loading="">{W.loading} | role="status">{W.loading}
 * @mutate src/pages/info/GiftGuides.tsx | if (coldSlug && dealDay(coldSlug)) { | if (coldSlug && dealDay(coldSlug) && false) {
 * @mutate src/pages/info/giftGuides/GiftGuideSmallBiz.tsx | role="status" data-gift-deals-loading="">{W.loading} | role="status">{W.loading}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | [data-gift-deals-loading]{min-height:100vh} | [data-gift-deals-loading]{min-height:0}
 */
const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("a deals day page's loading lines hold the page's space and say the deals words", () => {
  it("both loading lines carry data-gift-deals-loading, and the first says Loading deals, not Loading your list", () => {
    const page = read("pages/info/GiftGuides.tsx");
    const lazyDeals = /function LazyDeals\b[\s\S]*?\n}\n/.exec(page)?.[0] ?? "";
    expect(lazyDeals.length).toBeGreaterThan(50);
    expect(lazyDeals).toMatch(/role="status" data-gift-deals-loading="">\{DEALS_WORDS\.loading\}/);
    expect(lazyDeals).not.toMatch(/WISH\.loading/);
    const deals = read("pages/info/giftGuides/GiftGuideDeals.tsx");
    const lines = deals.match(/\{W\.loading\}/g) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(deals.match(/data-gift-deals-loading="">\{W\.loading\}/g)?.length).toBe(lines.length);
  });

  it("a cold deals day page starts its deals chunk as GiftGuides.tsx runs, not after the first render", () => {
    const page = read("pages/info/GiftGuides.tsx");
    expect(page).toMatch(/\nif \(coldSlug && dealDay\(coldSlug\)\) \{\n\s+loadDeals\(\)\.catch\(/);
  });

  it("Small Business Saturday's businesses line holds the same space (speed-1122n S6: CLS 0.51)", () => {
    const sb = read("pages/info/giftGuides/GiftGuideSmallBiz.tsx");
    const lines = sb.match(/\{W\.loading\}/g) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(sb.match(/data-gift-deals-loading="">\{W\.loading\}/g)?.length).toBe(lines.length);
  });

  it("the guides' style sheet gives that line a full screen of height", () => {
    const css = read("pages/info/giftGuides/giftGuidesStyles.ts");
    expect(css).toMatch(/\[data-gift-deals-loading\]\{min-height:100vh\}/);
  });
});
