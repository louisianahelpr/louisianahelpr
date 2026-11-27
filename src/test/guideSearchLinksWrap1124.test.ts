/**
 * Lead 11-24: the "Popular searches" line at the bottom of Her, Him and Kids wraps on a phone; the shared "·" sat
 * BEFORE each item (giftGuidesStyles.ts .gg-also-list li+li::before), so wrapped lines began with a dot (screenshot
 * ~/.lh-shots/declutter-speed-1124/searches-before-375.png). The fix then put the dot after each item, and polish audit
 * 1127 #144 found it left a stray dot at the end of most wrapped lines (shot guides/her--sec-out-375--09.png). Now there
 * is no separator at all: a wrapping row of links 12px apart, rows 4px apart. jsdom has no layout: this pins the rules.
 *
 * @mutate src/pages/info/giftGuides/GuideSearchLinks.tsx | .gg-searches .gg-also-list li+li::before{content:none} | .gg-searches .gg-also-list li+li::before{}
 * @mutate src/pages/info/giftGuides/GuideSearchLinks.tsx | .gg-searches .gg-also-list{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px} | .gg-searches .gg-also-list{display:flex;flex-wrap:wrap;align-items:baseline}
 * @mutate src/pages/info/giftGuides/GuideSearchLinks.tsx | .gg-searches .gg-also-list li+li::before{content:none} | .gg-searches .gg-also-list li+li::before{content:none}\n.gg-searches .gg-also-list li:not(:last-child)::after{content:"·"}
 */
import { describe, expect, it } from "vitest";
import { GUIDE_SEARCH_CSS } from "@/pages/info/giftGuides/GuideSearchLinks";

const rules = GUIDE_SEARCH_CSS.split("\n").map((l) => l.trim()).filter(Boolean);
const rule = (sel: string) => rules.find((r) => r.startsWith(`${sel}{`)) ?? "";

describe("Popular searches: a wrapping row of links with no separator", () => {
  it("the search list is a wrapping row, links 12px apart and rows 4px apart", () => {
    expect(rules.length).toBeGreaterThan(3);
    expect(rule(".gg-searches .gg-also-list")).toMatch(/display:flex;flex-wrap:wrap/);
    expect(rule(".gg-searches .gg-also-list")).toContain("gap:4px 12px");
  });
  it("no dot before or after any item (the shared leading dot is off)", () => {
    expect(rule(".gg-searches .gg-also-list li+li::before")).toContain("content:none");
    expect(GUIDE_SEARCH_CSS).not.toContain("·");
  });
});
