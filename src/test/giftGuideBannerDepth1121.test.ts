// Owner 11-21: "the arches and letters are just small and squished together" and "add like some effect so it doesn't
// look flat". Same design, bigger airy type, and a printed-card look: soft shadow under the band, an inner vignette on
// the gingham, a raised arch and a thin gold inner arch line. Deal-day banners share .gg-banner/.gg-arch.
import { describe, expect, it } from "vitest";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import DEALS_SRC from "@/pages/info/giftGuides/GiftGuideDeals.tsx?raw";

/** The banner block (the owner's 11-21 note to the end of the sheet): desktop rules, then the tablet and phone @media. */
const BLOCK = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.lastIndexOf('"the arches and letters are just small and squished together"'));
const DESKTOP = BLOCK.slice(0, BLOCK.indexOf("@media"));
const PHONE = BLOCK.slice(BLOCK.indexOf("@media (max-width:767px)"));
const px = (re: RegExp) => Number(DESKTOP.match(re)?.[1] ?? 0);

describe("gift guide banner: bigger airy type and a printed-card effect (owner 11-21)", () => {
  it("desktop 'gifts for' is at least 24px and the name at least 44px", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner .gg-lead{font-size:26px;line-height:1.15;margin:0 0 14px} | .gg-banner .gg-lead{font-size:16px;line-height:1.15;margin:0 0 14px}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner h1{font-size:46px;line-height:1.1} | .gg-banner h1{font-size:30px;line-height:1.1}
    expect(BLOCK.length).toBeGreaterThan(0);
    expect(px(/\.gg-banner \.gg-lead\{font-size:(\d+)px/)).toBeGreaterThanOrEqual(24);
    expect(px(/\.gg-banner h1\{font-size:(\d+)px/)).toBeGreaterThanOrEqual(44);
  });

  it("the band casts a soft shadow, the gingham has an inner vignette, and the arch is raised with a gold inner line", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner{position:relative;height:216px;box-shadow:0 2px 10px rgba(0,0,0,.10)} | .gg-banner{position:relative;height:216px}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | box-shadow:inset 0 0 28px rgba(60,40,20,.14) | box-shadow:none
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | border:1px solid rgba(176,141,87,.75);border-bottom:0 | border:0
    expect(DESKTOP).toMatch(/\.gg-banner\{[^}]*box-shadow:0 2px \d+px rgba/);
    expect(DESKTOP).toMatch(/\.gg-banner::after\{[^}]*box-shadow:inset /);
    expect(DESKTOP).toMatch(/\.gg-arch\{[^}]*box-shadow:[^;}]*rgba/);
    expect(DESKTOP).toMatch(/\.gg-arch::before\{[^}]*border:1px solid rgba\(176,141,87/);
  });

  it("on a phone the name scales with the screen (clamp) so 320px never overflows", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner h1{font-size:clamp(22px,7.5vw,30px);-webkit-line-clamp:2} | .gg-banner h1{font-size:30px;-webkit-line-clamp:2}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | font-size:clamp(22px,7.5vw,30px);-webkit-line-clamp:2} | font-size:clamp(22px,7.5vw,30px)}
    expect(PHONE).toMatch(/\.gg-banner h1\{font-size:clamp\(/);
    // A long name ("25 Days Sponsors") wraps to two lines instead of being cut to "25 Days..." (seen at 375, 11-21).
    expect(PHONE).toMatch(/\.gg-banner h1\{[^}]*-webkit-line-clamp:2/);
  });

  it("in dark mode the cream arch keeps a brown 'gifts for' that beats the later .gg-words dark rule", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | :root[data-theme="dark"] .gg-words .gg-banner .gg-lead{color:#6b5a48} | :root[data-theme="dark"] .gg-banner .gg-x{color:#6b5a48}
    expect(BLOCK).toMatch(/:root\[data-theme="dark"\] \.gg-words \.gg-banner \.gg-lead\{color:#6b5a48\}/);
  });

  it("deal-day banners on a phone keep a larger, screen-scaled title (was a fixed 17px)", () => {
    // @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | -webkit-line-clamp:2;font-size:clamp(19px,6vw,24px) | -webkit-line-clamp:2;font-size:17px
    const rule = DEALS_SRC.match(/\[data-gift-deals-page\]\) \.gg-banner h1\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/font-size:clamp\(19px,/);
  });
});
