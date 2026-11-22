/**
 * Holiday audit 1121 #75: the 25 Days sponsors page's head called it "25 Days Sponsors gift guide", its share title
 * said "gift guide" twice and its description "hand-picked gift ideas". These are the brands giving away prizes in
 * our 25 Days of Giveaways: the head says so, once, and the page stays indexed.
 *
 * @mutate src/lib/giftGuidePageMeta.mjs |   if (slug === SPONSORS_SLUG) return SPONSORS_META; |
 */
import { describe, expect, it } from "vitest";
import { giftGuidePageMeta, publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";

describe("the 25 Days sponsors page's head (holiday audit 1121 #75)", () => {
  it("names the giveaway sponsors, says gift guide at most once, and never 'hand-picked'", () => {
    const m = giftGuidePageMeta("25-days-sponsors", "25 Days Sponsors", ["Faulk's"], 39);
    expect(m.title).toBe("Shop our 25 Days of Giveaways sponsors — Helpr");
    expect(m.ogTitle).toBe("Shop our 25 Days of Giveaways sponsors");
    for (const t of [m.title, m.ogTitle, m.description, m.ogDescription]) {
      expect((t.match(/gift guide/gi) ?? []).length, t).toBeLessThanOrEqual(1);
      expect(t, t).not.toMatch(/hand-picked/i);
    }
    expect(m.canonical).toBe("https://www.louisianahelpr.com/gift-guides/25-days-sponsors");
    expect("robots" in m).toBe(false);
    // The pre-JS head (api/share.ts) reads the same.
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/25-days-sponsors", null)?.title).toBe(m.title);
    expect(Object.keys(GIFT_GUIDE_SEO)).toContain("25-days-sponsors");
  });
});
