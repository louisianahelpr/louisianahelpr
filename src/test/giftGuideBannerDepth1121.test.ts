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
  // Pass 2 (owner 11-21 night: "gifts for her is still too small text size and still close together"): at 1440 "gifts
  // for" 34-38px, the name 72-84px, a 12-18px gap between the lines and a 240-260px band so the arch holds them.
  it("desktop 'gifts for' is 34-38px, the name 72-84px, 12-18px apart, in a 240-260px band", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner .gg-lead{font-size:36px;line-height:1.1;margin:0 0 16px} | .gg-banner .gg-lead{font-size:26px;line-height:1.1;margin:0 0 16px}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner h1{font-size:80px;line-height:1.04} | .gg-banner h1{font-size:46px;line-height:1.04}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner .gg-lead{font-size:36px;line-height:1.1;margin:0 0 16px} | .gg-banner .gg-lead{font-size:36px;line-height:1.1;margin:0 0 6px}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner{position:relative;height:252px; | .gg-banner{position:relative;height:216px;
    expect(BLOCK.length).toBeGreaterThan(0);
    const lead = px(/^\.gg-banner \.gg-lead\{font-size:(\d+)px/m);
    const name = px(/^\.gg-banner h1\{font-size:(\d+)px/m);
    const gap = px(/^\.gg-banner \.gg-lead\{[^}]*margin:0 0 (\d+)px/m);
    const band = px(/^\.gg-banner\{[^}]*height:(\d+)px/m);
    expect(lead).toBeGreaterThanOrEqual(34);
    expect(lead).toBeLessThanOrEqual(38);
    expect(name).toBeGreaterThanOrEqual(72);
    expect(name).toBeLessThanOrEqual(84);
    expect(gap).toBeGreaterThanOrEqual(12);
    expect(gap).toBeLessThanOrEqual(18);
    expect(band).toBeGreaterThanOrEqual(240);
    expect(band).toBeLessThanOrEqual(260);
  });

  it("the long two-line titles (deal days, 25 Days Sponsors) keep a large but smaller desktop size so two lines fit", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg:has([data-gift-countrow]) .gg-banner h1{font-size:60px;line-height:1.04}} | .gg:has([data-gift-countrow]) .gg-banner h1{font-size:78px;line-height:1.04}}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (min-width:768px){.gg:has([data-gift-deals-page]) | @media (min-width:0px){.gg:has([data-gift-deals-page])
    // Only from 768px up: on a phone every guide has the count row after its banner, so an unscoped rule shrank Her to 60px.
    // The rule keys on the page holding the count row anywhere (owner 11-22: on a desktop the sponsors' row heads the
    // content column, no longer the banner's next sibling).
    const n = Number(BLOCK.match(/^@media \(min-width:768px\)\{\.gg:has\(\[data-gift-deals-page\]\) \.gg-banner h1,\.gg:has\(\[data-gift-countrow\]\) \.gg-banner h1\{font-size:(\d+)px/m)?.[1] ?? 0);
    expect(n).toBeGreaterThanOrEqual(54);
    expect(n).toBeLessThanOrEqual(64);
  });

  it("the band casts a soft shadow, the gingham has an inner vignette, and the arch is raised with a gold inner line", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner{position:relative;height:252px;box-shadow:0 2px 10px rgba(0,0,0,.10)} | .gg-banner{position:relative;height:252px}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | box-shadow:inset 0 0 28px rgba(60,40,20,.14) | box-shadow:none
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | border:1px solid rgba(176,141,87,.75);border-bottom:0 | border:0
    expect(DESKTOP).toMatch(/\.gg-banner\{[^}]*box-shadow:0 2px \d+px rgba/);
    expect(DESKTOP).toMatch(/\.gg-banner::after\{[^}]*box-shadow:inset /);
    expect(DESKTOP).toMatch(/\.gg-arch\{[^}]*box-shadow:[^;}]*rgba/);
    expect(DESKTOP).toMatch(/\.gg-arch::before\{[^}]*border:1px solid rgba\(176,141,87/);
  });

  it("on a phone the name scales with the screen (clamp) so 320px never overflows", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner h1{font-size:clamp(34px,11vw,44px);line-height:1.02;-webkit-line-clamp:2} | .gg-banner h1{font-size:44px;line-height:1.02;-webkit-line-clamp:2}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | font-size:clamp(34px,11vw,44px);line-height:1.02;-webkit-line-clamp:2} | font-size:clamp(34px,11vw,44px);line-height:1.02}
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner h1{font-size:clamp(34px,11vw,44px) | .gg-banner h1{font-size:clamp(22px,7.5vw,30px)
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-banner .gg-lead{font-size:clamp(20px,6vw,24px);margin-bottom:12px} | .gg-banner .gg-lead{font-size:17px;margin-bottom:8px}
    expect(PHONE).toMatch(/\.gg-banner h1\{font-size:clamp\(/);
    // Pass 2: clearly bigger than pass 1 (name 22-30px, "gifts for" 17px, 8px gap, 136px band) at 320 and 375.
    const clamp = (re: RegExp) => (PHONE.match(re) ?? []).slice(1).map(Number);
    const at = ([lo, vw, hi]: number[], w: number) => Math.min(hi, Math.max(lo, (vw * w) / 100));
    const name = clamp(/\.gg-banner h1\{font-size:clamp\((\d+)px,([\d.]+)vw,(\d+)px\)/);
    const lead = clamp(/\.gg-banner \.gg-lead\{font-size:clamp\((\d+)px,([\d.]+)vw,(\d+)px\)/);
    expect(name).toHaveLength(3);
    expect(lead).toHaveLength(3);
    expect(at(name, 320)).toBeGreaterThanOrEqual(32);
    expect(at(name, 375)).toBeGreaterThanOrEqual(38);
    expect(at(lead, 320)).toBeGreaterThanOrEqual(20);
    expect(Number(PHONE.match(/\.gg-banner \.gg-lead\{[^}]*margin-bottom:(\d+)px/)?.[1])).toBeGreaterThanOrEqual(12);
    expect(Number(PHONE.match(/\.gg-banner\{height:(\d+)px/)?.[1])).toBeGreaterThanOrEqual(170);
    // A long name ("25 Days Sponsors") wraps to two lines instead of being cut to "25 Days..." (seen at 375, 11-21).
    expect(PHONE).toMatch(/\.gg-banner h1\{[^}]*-webkit-line-clamp:2/);
  });

  it("in dark mode the cream arch keeps a brown 'gifts for' that beats the later .gg-words dark rule", () => {
    // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | :root[data-theme="dark"] .gg-words .gg-banner .gg-lead{color:#6b5a48} | :root[data-theme="dark"] .gg-banner .gg-x{color:#6b5a48}
    expect(BLOCK).toMatch(/:root\[data-theme="dark"\] \.gg-words \.gg-banner \.gg-lead\{color:#6b5a48\}/);
  });

  it("deal-day banners on a phone keep a larger, screen-scaled title (was a fixed 17px)", () => {
    // @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | -webkit-line-clamp:3;font-size:clamp(25px,8vw,34px) | -webkit-line-clamp:3;font-size:17px
    // @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | -webkit-line-clamp:3;font-size:clamp(25px,8vw,34px) | -webkit-line-clamp:3;font-size:clamp(19px,6vw,24px)
    // @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | -webkit-line-clamp:3;font-size:clamp(25px,8vw,34px) | -webkit-line-clamp:2;font-size:clamp(25px,8vw,34px)
    const rule = DEALS_SRC.match(/\[data-gift-deals-page\]\) \.gg-banner h1\{([^}]*)\}/)?.[1] ?? "";
    // Pass 2: three lines allowed, so "Small Business Saturday" at 320px is never cut to "Small Business..." (seen 11-21).
    expect(rule).toMatch(/-webkit-line-clamp:3/);
    // At least 25px at 320 (pass 1 was 19px) and 30px at 375 (pass 1 was 22.5px).
    const [lo, vw, hi] = (rule.match(/font-size:clamp\((\d+)px,([\d.]+)vw,(\d+)px\)/) ?? []).slice(1).map(Number);
    expect(lo).toBeGreaterThanOrEqual(25);
    expect(Math.min(hi, Math.max(lo, (vw * 375) / 100))).toBeGreaterThanOrEqual(30);
  });
});
