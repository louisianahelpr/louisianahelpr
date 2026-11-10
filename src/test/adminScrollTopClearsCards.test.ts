/**
 * Q2583 (Auditor 1 Declutter audit 1102a, 2026-11-02, adm-s4-1440.png): at 1440 the
 * floating scroll-to-top button sat on the first "Edit" in "Declutter meetup
 * spots", and the Declutter admin cards were scattered among Shops, Homes and
 * SMS cards on one ~9,900 px Settings page.
 *
 * 1. From lg up, the admin scroll container's right padding is wider than the
 *    button's right offset plus its width, so the button sits in the gutter.
 * 2. The Declutter cards render next to each other, the stage preview with them.
 *
 * @mutate src/pages/admin/AdminFrame.tsx | lg:pl-6 lg:pr-[4.5rem] | lg:pl-6
 * @mutate src/components/ScrollToTop.tsx | fixed right-4 z-30 active:scale-[0.94] | fixed right-12 z-30 active:scale-[0.94]
 * @mutate src/components/ui/RoundIconButton.tsx | md: "w-11 h-11" | md: "w-20 h-20"
 * @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |     <DonationPartnersCard />\n    <DeclutterFunnelCard />\n    <DeclutterPreviewCard />\n    <ShopItemsReviewCard />\n | <ShopItemsReviewCard />\n    <DonationPartnersCard />\n    <DeclutterFunnelCard />\n    <DeclutterPreviewCard />\n
 * @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |     <DeclutterProblemsCard includeTest={declutterShowTest} />\n    <MeetupSpotsCard />\n | <MeetupSpotsCard />\n    <CategorySuggestionsCard />\n    <DeclutterProblemsCard includeTest={declutterShowTest} />\n
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

/** Tailwind spacing class value in px: `right-4` -> 16, `pr-[4.5rem]` -> 72. */
function px(value: string): number {
  const arb = value.match(/^\[(\d+(?:\.\d+)?)(rem|px)\]$/);
  if (arb) return Number(arb[1]) * (arb[2] === "rem" ? 16 : 1);
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 4;
  throw new Error(`unreadable spacing ${value}`);
}

describe("Q2583 admin scroll-to-top clears card actions; Declutter cards grouped", () => {
  it("the admin container's lg right padding is wider than the button's offset plus width", () => {
    const btn = read("src/components/ScrollToTop.tsx");
    const cls = btn.match(/className="(fixed [^"]*)"/)?.[1] ?? "";
    expect(cls).not.toBe("");
    const right = px(cls.match(/(?:^| )right-(\S+)/)?.[1] ?? "x");
    // Since 2026-11-07 (Q2709) the button is the shared RoundIconButton: with no w- of its own, its width is that
    // primitive's size (md unless a size is passed), read from its source.
    let widthClass = cls.match(/(?:^| )w-(\S+)/)?.[1];
    if (!widthClass && /<RoundIconButton\b/.test(btn)) {
      const size = btn.match(/<RoundIconButton\b[^>]*?\bsize="(\w+)"/)?.[1] ?? "md";
      const sizes = read("src/components/ui/RoundIconButton.tsx");
      widthClass = sizes.match(new RegExp(`\\b${size}: "[^"]*?\\bw-(\\S+?)[ "]`))?.[1];
    }
    const width = px(widthClass ?? "x");
    // A breakpoint-prefixed right/w on the button would escape this check.
    expect(cls).not.toMatch(/(?:sm|md|lg|xl):(?:right|w)-/);

    const frame = read("src/pages/admin/AdminFrame.tsx");
    const scroll = frame.match(/data-admin-scroll\s+className="([^"]*)"/)?.[1] ?? "";
    expect(scroll).not.toBe("");
    const lgPr = scroll.match(/(?:^| )lg:pr-(\S+)/)?.[1] ?? scroll.match(/(?:^| )lg:px?-(\S+)/)?.[1] ?? "0";
    // 8px air between the button and the cards.
    expect(px(lgPr)).toBeGreaterThanOrEqual(right + width + 8);
    expect(right + width).toBeGreaterThan(40);
  });

  it("the Declutter admin cards render as one run, the stage preview included", () => {
    const src = read("src/components/admin/settings/FeatureSwitchesCard.tsx");
    const order = [...src.matchAll(/<([A-Z][A-Za-z]+Card)\b/g)].map((m) => m[1]).filter((n) => n !== "AdminCard");
    expect(order.length).toBeGreaterThan(6);
    const isDeclutter = (n: string) => /^Declutter|^MeetupSpots|^DonationPartners/.test(n);
    const idx = order.map((n, i) => (isDeclutter(n) ? i : -1)).filter((i) => i >= 0);
    expect(idx.length).toBeGreaterThanOrEqual(5);
    expect(idx[idx.length - 1] - idx[0]).toBe(idx.length - 1);
    expect(order).toContain("DeclutterPreviewCard");
    // Not rendered a second time, apart from the group, in Settings itself.
    expect(read("src/components/admin/AdminSettings.tsx")).not.toMatch(/<DeclutterPreviewCard\b/);
  });
});
