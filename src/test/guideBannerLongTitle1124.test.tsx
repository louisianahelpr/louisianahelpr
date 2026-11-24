/**
 * Lead 2026-11-24: the shared guide banner clipped long titles ("KPop Demon Hunters Gif…" at 375; at 1440 the second
 * line, "Gift Guide", was cut on every theme guide, Monster Jam included). The h1 had a 2-line clamp with overflow
 * hidden inside a fixed-height band. Now a long title wraps: the band's heights are minimums, the arch stretches with
 * the band, the h1 has no clamp and no hidden overflow, and long titles take smaller type.
 * The title is a fixture (the KPop data lives on another branch), so this guards the banner, not one guide's data.
 * Layout itself was measured in a browser at 375 and 1440 (~/.lh-shots/guide-content-1124/).
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner h1,.gg-banner-sub .gg-banner h1{display:block;-webkit-line-clamp:none;overflow:visible; | .gg-banner h1,.gg-banner-sub .gg-banner h1{display:-webkit-box;-webkit-line-clamp:2;overflow:hidden;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner{height:auto;min-height:252px} | .gg-banner{height:252px}
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |   return title.length > 24 ? "xlong" : title.length > 12 ? "long" : ""; |   return "";
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GiftGuidesWords, bannerLength } from "@/pages/info/giftGuides/GiftGuideCover";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

const LONG = "KPop Demon Hunters Gift Guide";

const positions = (re: RegExp) => [...GIFT_GUIDES_CSS.matchAll(re)].map((m) => m.index!);

describe("guide banner: a long title wraps, never clips", () => {
  it("sizes a title by its length and marks the banner", () => {
    expect(bannerLength("Her")).toBe("");
    expect(bannerLength("Monster Jam Gift Guide")).toBe("long");
    expect(bannerLength(LONG)).toBe("xlong");
    const c = render(<GiftGuidesWords lead="the" title={LONG} titleId="t" tint="green" sub={false} />).container;
    const header = c.querySelector("header[data-gift-words]")!;
    expect(header.className).toBe("gg-words gg-banner-wrap gg-banner-long gg-banner-xlong");
    expect(c.querySelector("h1#t")!.textContent).toBe(`the ${LONG}`);
    const short = render(<GiftGuidesWords lead="gifts for" title="Her" titleId="h" tint="green" />).container;
    expect(short.querySelector("header")!.className).toBe("gg-words gg-banner-wrap");
  });

  it("the last word on the title is no clamp and no hidden overflow, after every clamp", () => {
    const reset = GIFT_GUIDES_CSS.indexOf(".gg-banner h1,.gg-banner-sub .gg-banner h1{display:block;-webkit-line-clamp:none;overflow:visible;");
    expect(reset).toBeGreaterThan(0);
    const clamps = positions(/\.gg-banner h1\{[^}]*-webkit-line-clamp:\d/g);
    // Four clamps measured 2026-11-24 (base, compact phone, phone, sub-page phone).
    expect(clamps.length).toBeGreaterThan(3);
    for (const at of clamps) expect(at).toBeLessThan(reset);
  });

  it("the band's heights are minimums, set after every fixed height, and the arch stretches with it", () => {
    const auto = GIFT_GUIDES_CSS.indexOf(".gg-banner{height:auto;min-height:252px}");
    expect(auto).toBeGreaterThan(0);
    const fixed = positions(/\.gg-banner\{[^}]*(?<![-\w])height:\d+px/g);
    expect(fixed.length).toBeGreaterThan(3);
    for (const at of fixed) expect(at).toBeLessThan(auto);
    expect(GIFT_GUIDES_CSS.indexOf(".gg-arch{height:auto;align-self:stretch}")).toBeGreaterThan(Math.max(...positions(/\.gg-arch\{[^}]*height:100%/g)));
    expect(GIFT_GUIDES_CSS).toContain("@media (max-width:767px){.gg-banner-xlong .gg-banner h1{font-size:clamp(28px,8.5vw,34px);");
  });
});
