/**
 * Polish audit 11-27 #102 (~/.lh-shots/polish-audit-1127/FINDINGS.md, guides/small-business-saturday--out-375--2.png):
 * Small Business Saturday's logo tiles differed: some logos sat on a cream #faf6ee well, others on none. Owner 11-20
 * ("None of the images should have a background either", giftGuideCalmCards1120) covers logos too: every logo box in
 * the gift guides' CSS is white or transparent. Inventory: every CSS rule in the guide style files whose selector names
 * a logo (giftGuideCalmCards1120 checks the product photo rules and leaves logos out).
 *
 * @mutate src/pages/info/giftGuides/smallBizCardStyles.ts | width:72px;height:72px;border-radius:12px;background:#fff;overflow:hidden} | width:72px;height:72px;border-radius:12px;background:#faf6ee;overflow:hidden}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const CSS_FILES = [
  "src/pages/info/giftGuides/giftGuidesStyles.ts",
  "src/pages/info/giftGuides/giftWishStyles.ts",
  "src/pages/info/giftGuides/GiftGuideDeals.tsx",
  "src/pages/info/giftGuides/GiftGuideDealCards.tsx",
  "src/pages/info/giftGuides/GiftGuideSponsorRow.tsx",
  "src/pages/info/giftGuides/GiftGuideSmallBiz.tsx",
  "src/pages/info/giftGuides/smallBizCardStyles.ts",
];
const rules = (src: string) => [...src.matchAll(/([^{}`]+)\{([^{}`]*)\}/g)].map((m) => ({ sel: m[1].trim().split("\n").pop()!.trim(), body: m[2] }));
const logoRules = CSS_FILES.flatMap((f) => rules(blankComments(readFileSync(f, "utf8"))).filter((r) => /logo/.test(r.sel)).map((r) => ({ f, ...r })));

describe("#102: no tinted well behind a guide logo", () => {
  it("finds the logo rules (inventory floor)", () => {
    expect(logoRules.length).toBeGreaterThan(2);
  });
  it("every logo box's background is white or transparent", () => {
    const bad = logoRules
      .map((r) => ({ ...r, bg: /(?:^|;)\s*background(?:-color)?:\s*([^;]+)/.exec(r.body)?.[1].trim() }))
      .filter((r) => r.bg !== undefined && !/^(#fff|#ffffff|white|transparent|none)$/i.test(r.bg))
      .map((r) => `${r.f}: ${r.sel} -> ${r.bg}`);
    expect(bad).toEqual([]);
  });
});
