/**
 * Lead 11-24: the "Popular searches" line at the bottom of Her, Him and Kids wraps on a phone; the shared "·" sat
 * BEFORE each item (giftGuidesStyles.ts .gg-also-list li+li::before), so wrapped lines began with a dot (screenshot
 * ~/.lh-shots/declutter-speed-1124/searches-before-375.png). The search lists put the dot AFTER each item but the last,
 * inside the item, on a wrapping row, so every line starts with a link (searches-after-375.png). jsdom has no layout:
 * this pins the rules the 2026-11-24 phone screenshot was taken with.
 *
 * @mutate src/pages/info/giftGuides/GuideSearchLinks.tsx | .gg-searches .gg-also-list li+li::before{content:none} | .gg-searches .gg-also-list li+li::before{}
 * @mutate src/pages/info/giftGuides/GuideSearchLinks.tsx | .gg-searches .gg-also-list li:not(:last-child)::after{content:"·"; | .gg-searches .gg-also-list li::after{content:"·";
 * @mutate src/pages/info/giftGuides/GuideSearchLinks.tsx | .gg-searches .gg-also-list{display:flex;flex-wrap:wrap;align-items:baseline} | .gg-searches .gg-also-list{}
 */
import { describe, expect, it } from "vitest";
import { GUIDE_SEARCH_CSS } from "@/pages/info/giftGuides/GuideSearchLinks";

const rules = GUIDE_SEARCH_CSS.split("\n").map((l) => l.trim()).filter(Boolean);
const rule = (sel: string) => rules.find((r) => r.startsWith(`${sel}{`)) ?? "";

describe("Popular searches: a wrapped line starts with a link, never a dot", () => {
  it("the search list is a wrapping row", () => {
    expect(rules.length).toBeGreaterThan(3);
    expect(rule(".gg-searches .gg-also-list")).toMatch(/display:flex;flex-wrap:wrap/);
  });
  it("the shared leading dot is off, and the dot trails every item but the last", () => {
    expect(rule(".gg-searches .gg-also-list li+li::before")).toContain("content:none");
    expect(rule(".gg-searches .gg-also-list li:not(:last-child)::after")).toContain('content:"·"');
    expect(rules.some((r) => /^\.gg-searches \.gg-also-list li::(after|before)\{/.test(r))).toBe(false);
  });
});
