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
 * @mutate src/content/giftGuideSmallBiz.mjs |   return today >= SMALL_BIZ_FEATURE_FROM && today <= SMALL_BIZ_FEATURE_TO; |   return today >= SMALL_BIZ_FEATURE_FROM;
 * @mutate scripts/gift-guide-small-biz.mjs | const NO_LOGO = new Set(["sprinkle-in-time-too", | const NO_LOGO = new Set([
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ROWS from "@/content/giftGuideSmallBiz.json";
import { SMALL_BIZ_CATEGORIES, SMALL_BIZ_SLUG, smallBizFeatured, smallBizSections, smallBizTitle, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
// The Featured local section (owner 11-20) reads the server; unit tests never reach Supabase.
vi.mock("@/lib/sbsFeaturedApi", async (orig) => ({ ...(await orig<typeof import("@/lib/sbsFeaturedApi")>()), listFeaturedLocal: async () => [] }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { SmallBizFeature } from "@/pages/info/giftGuides/GiftGuideSmallBiz";

afterEach(() => cleanup());
const rows = ROWS as SmallBiz[];

describe("Small Business Saturday: the businesses", () => {
  it("say nothing of a giveaway day, prize or price, and link only https pages", () => {
    expect(rows.length).toBeGreaterThan(40);
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
    expect(rows.find((b) => b.slug === "sprinkle-in-time-too")?.logo).toBeUndefined();
    // The two sponsors who signed up 11-19 PM.
    expect(rows.map((b) => b.name)).toEqual(expect.arrayContaining(["Birdwell's", "Accesorios Para Niñas"]));
  });

  it("group into the page's sections, in order", () => {
    const sections = smallBizSections(rows);
    expect(sections.map((s) => s.category)).toEqual(SMALL_BIZ_CATEGORIES.filter((c) => rows.some((b) => b.category === c)));
  });
});

describe("Small Business Saturday: the page", () => {
  it("draws every business with its badge, and a Visit button only where it has a link", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/gift-guides/${SMALL_BIZ_SLUG}`]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelectorAll("li[data-gift-sb]").length).toBe(rows.length));
    for (const li of container.querySelectorAll("li[data-gift-sb]")) {
      const b = rows.find((x) => x.slug === li.getAttribute("data-gift-sb"))!;
      expect(li.querySelector('[data-gift-badge="sponsor"]')?.textContent).toBe("25 Days sponsor");
      const out = [...li.querySelectorAll("a[data-gift-sb-out]")];
      expect(out.length > 0, b.name).toBe(Boolean(b.href));
      for (const a of out) {
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toContain("noopener");
      }
    }
    expect(container.querySelector("[data-gift-sb-guide]")?.getAttribute("href")).toBe("/gift-guides/shop-small-louisiana");
  });

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

  it("has its own indexed head and is in the sitemap", () => {
    const meta = giftGuidePageMeta(SMALL_BIZ_SLUG);
    expect(meta.canonical).toBe(`https://www.louisianahelpr.com/gift-guides/${SMALL_BIZ_SLUG}`);
    expect("robots" in meta).toBe(false);
    expect(readFileSync("public/sitemap.xml", "utf8")).toContain(`<loc>https://www.louisianahelpr.com/gift-guides/${SMALL_BIZ_SLUG}</loc>`);
  });
});
