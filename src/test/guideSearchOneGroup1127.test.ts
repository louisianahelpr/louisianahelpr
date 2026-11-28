/**
 * Polish audit 11-27 #148: the guide search showed a lone "GIFTS" heading even when gifts were the only group, and the
 * 25 Days sponsor businesses came back as "In 25 Days Sponsors" rows with no price (they looked broken). Now the
 * heading shows only beside the Guides group, and a sponsor row says what it is: "Louisiana shop".
 *
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | {foundItems.length > 0 && found.length > 0 && <li className="gg-search-head" | {foundItems.length > 0 && <li className="gg-search-head"
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | {slug === SPONSORS_SLUG ? G.searchLocalShop : G.searchItemIn( | {G.searchItemIn(
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { giftGuides as G } from "@/content/giftGuides";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";

const share = blankComments(readFileSync("src/pages/info/giftGuides/GiftGuideShare.tsx", "utf8"));

describe("guide search: one group has no heading; sponsor businesses say what they are (#148)", () => {
  it("is not vacuous", () => {
    expect(share).toContain('id="gift-search-results"');
    expect(share).toContain("foundItems.map(");
  });

  it("the Gifts heading needs the Guides group beside it", () => {
    const heads = share.match(/\{[^{}]*<li className="gg-search-head"/g) ?? [];
    expect(heads).toHaveLength(2);
    for (const h of heads) expect(h).toMatch(/found\.length > 0 && foundItems\.length > 0|foundItems\.length > 0 && found\.length > 0/);
  });

  it("a sponsor business row reads 'Louisiana shop', never 'In 25 Days Sponsors'", () => {
    expect(G.searchLocalShop).toBe("Louisiana shop");
    expect(share).toContain('const SPONSORS_SLUG = "25-days-sponsors";');
    expect(LIVE_GUIDES_1121).toContain("25-days-sponsors");
    expect(share).toContain("{slug === SPONSORS_SLUG ? G.searchLocalShop : G.searchItemIn(");
  });
});
