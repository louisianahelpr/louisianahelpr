/**
 * The Small Business Saturday page (owner 2026-11-19 ~7:05/7:15 PM; FOLLOWUP-OWNER-1119.md items 60, 61, 64), read from
 * the generated businesses (src/content/giftGuideSmallBiz.json) and the page:
 *   - never a giveaway day or any giveaway wording, no price, no email or phone;
 *   - every link is https; "Visit" opens the website, else the Facebook Page, else Instagram; no link, no button;
 *   - Sprinkle in Time Too shows its name only (it declined logo use); every logo file exists;
 *   - sections in the page's category order; the "25 Days sponsor" badge on every card;
 *   - featured on the landing Nov 24-29 (Louisiana), then gone; "Shop Small Louisiana" after Nov 29;
 *   - the page answers 200 with its own head before JavaScript, and it is in the sitemap.
 *
 * Owner 11-21 ("launch the 3 guides remove the rest that are live"): the Small Business Saturday page is retired
 * (src/content/giftGuideLive.mjs) and its old link lands on /gift-guides (src/test/giftGuideOnlyThree1121.test.tsx);
 * the page-render test is gone, the data and feature-window checks stay for its return.
 *
 * @mutate src/content/giftGuideSmallBiz.mjs |   return today >= SMALL_BIZ_FEATURE_FROM && today <= SMALL_BIZ_FEATURE_TO; |   return today >= SMALL_BIZ_FEATURE_FROM;
 * Owner 11-21: the businesses are the deals page's Small Business Saturday section, confirmed Louisiana 25 Days
 * sponsors only (scripts/gift-guide-sponsor-order-1121.json: never its notConfirmed or national names).
 *
 * @mutate scripts/gift-guide-small-biz.mjs |   return Object.hasOwn(order.value, name) && !order.notConfirmed.includes(name) && !order.national.includes(name); |   return Object.hasOwn(order.value, name) && !order.notConfirmed.includes(name);
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ROWS from "@/content/giftGuideSmallBiz.json";
import { SMALL_BIZ_CATEGORIES, SMALL_BIZ_SLUG, smallBizFeatured, smallBizSections, smallBizTitle, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { TRACKER_NAME, confirmedLocal } from "../../scripts/gift-guide-small-biz.mjs";
// The Featured local section (owner 11-20) reads the server; unit tests never reach Supabase.
vi.mock("@/lib/sbsFeaturedApi", async (orig) => ({ ...(await orig<typeof import("@/lib/sbsFeaturedApi")>()), listFeaturedLocal: async () => [] }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import { SmallBizFeature } from "@/pages/info/giftGuides/GiftGuideSmallBiz";

afterEach(() => cleanup());
const rows = ROWS as SmallBiz[];

describe("Small Business Saturday: the businesses", () => {
  it("say nothing of a giveaway day, prize or price, and link only https pages", () => {
    expect(rows.length).toBeGreaterThan(30); // 37 measured 2026-11-21 (confirmed Louisiana sponsors only)
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/\bgiveaway\b|\bprize\b|\bwinner\b/i);
    expect(text).not.toMatch(/\$\s?\d/);
    // No single December day (a giveaway day); a show's run ("Dec 3–27") is a schedule, not a giveaway day.
    expect(text).not.toMatch(/\bdec(ember)?\.? ?\d{1,2}\b(?![–-]\d)|\b12\/\d{1,2}\b|\bday \d{1,2}\b/i);
    expect(text).not.toMatch(/@[a-z0-9.-]+\.(com|net|org)|\(\d{3}\) ?\d{3}-\d{4}/i);
    for (const b of rows) {
      for (const k of ["href", "website", "facebook", "instagram"] as const) if (b[k]) expect(b[k], `${b.name} ${k}`).toMatch(/^https:\/\//);
      if (b.href) expect([b.website, b.facebook, b.instagram].find(Boolean), b.name).toBe(b.href);
      if (b.logo) expect(existsSync(`public${b.logo}`), b.logo).toBe(true);
      expect(SMALL_BIZ_CATEGORIES, b.name).toContain(b.category);
    }
  });

  it("are confirmed Louisiana 25 Days sponsors only: none national, none unconfirmed, none off the tracker (owner 11-21)", () => {
    const order = JSON.parse(readFileSync("scripts/gift-guide-sponsor-order-1121.json", "utf8")) as { notConfirmed: string[]; national: string[]; value: Record<string, number> };
    expect(order.notConfirmed.length).toBeGreaterThan(5);
    expect(order.national.length).toBeGreaterThan(20);
    for (const b of rows) {
      const name = TRACKER_NAME[b.slug];
      expect(name, `${b.name}: no tracker name`).toBeTruthy();
      expect(Object.keys(order.value), b.name).toContain(name);
      expect(order.notConfirmed, b.name).not.toContain(name);
      expect(order.national, b.name).not.toContain(name);
      expect(confirmedLocal(b.slug, order), b.name).toBe(true);
    }
    // Both ways: every confirmed Louisiana sponsor the research file holds is on the page, minus the one held for the
    // owner's OK (Sprinkle in Time Too declined "OK on the wall") and R&R Wedding Co. (dropped by the owner 11-20).
    const expected = Object.keys(TRACKER_NAME).filter((s) => confirmedLocal(s, order)).sort();
    expect(rows.map((b) => b.slug).sort()).toEqual(expected);
    expect(rows.map((b) => b.slug)).not.toContain("sprinkle-in-time-too");
    for (const s of ["written-on-the-river", "megan-benoits-closet", "humble-home-decor-candles", "barclell-photography", "birdwells", "accesorios-para-ninas", "rr-wedding-co"]) {
      expect(rows.map((b) => b.slug), s).not.toContain(s);
    }
    // A national or unconfirmed name is refused even when the tracker lists a value for it.
    expect(confirmedLocal("bake-and-brush", { ...order, national: ["Bake & Brush"] })).toBe(false);
    expect(confirmedLocal("bake-and-brush", { ...order, notConfirmed: ["Bake & Brush"] })).toBe(false);
    expect(confirmedLocal("bake-and-brush", order)).toBe(true);
  });

  it("group into the page's sections, in order", () => {
    const sections = smallBizSections(rows);
    expect(sections.map((s) => s.category)).toEqual(SMALL_BIZ_CATEGORIES.filter((c) => rows.some((b) => b.category === c)));
  });
});

describe("Small Business Saturday: the page", () => {

  it("is featured on the landing Nov 24-29 only, and retitled after", () => {
    expect(smallBizFeatured("2026-11-23")).toBe(false);
    expect(smallBizFeatured("2026-11-24")).toBe(true);
    expect(smallBizFeatured("2026-11-29")).toBe(true);
    expect(smallBizFeatured("2026-11-30")).toBe(false);
    expect(smallBizTitle("2026-11-28")).toBe("Small Business Saturday: Shop Small Louisiana");
    expect(smallBizTitle("2026-11-30")).toBe("Shop Small Louisiana");
    const on = render(<MemoryRouter><SmallBizFeature now={new Date("2026-11-26T18:00:00Z")} /></MemoryRouter>).container;
    expect(on.querySelector("[data-gift-sb-feature]")?.getAttribute("href")).toBe(`/gift-guides/${SMALL_BIZ_SLUG}`);
    cleanup();
    expect(render(<MemoryRouter><SmallBizFeature now={new Date("2026-12-02T18:00:00Z")} /></MemoryRouter>).container.querySelector("[data-gift-sb-feature]")).toBeNull();
  });

  it("has its own indexed head; out of the sitemap while retired (owner 11-21)", () => {
    const meta = giftGuidePageMeta(SMALL_BIZ_SLUG);
    expect(meta.canonical).toBe(`https://www.louisianahelpr.com/gift-guides/${SMALL_BIZ_SLUG}`);
    expect("robots" in meta).toBe(false);
    // Owner 11-21: the page is retired with every guide but Her, Him and Kids (src/content/giftGuideLive.mjs).
    expect(readFileSync("public/sitemap.xml", "utf8")).not.toContain(`<loc>https://www.louisianahelpr.com/gift-guides/${SMALL_BIZ_SLUG}</loc>`);
  });
});
