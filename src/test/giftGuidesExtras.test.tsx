/**
 * The gift guides' extras (owner 2026-11-18): the date-driven shipping banner, the sidebar search, the hearts / My
 * list and the merged discount codes. The main page guard is src/test/giftGuidesPage.test.tsx.
 *
 * @mutate src/content/giftGuideShipping.ts |   if (month !== 12 \|\| day < 15) return SHIP_LINES.early; |   if (month !== 12 \|\| day <= 15) return SHIP_LINES.early;
 * @mutate src/content/giftGuideShipping.ts |   if (day <= 20) return SHIP_LINES.late; |   if (day < 20) return SHIP_LINES.late;
 * @mutate src/content/giftGuideShipping.ts |   if (day <= 25) return SHIP_LINES.instant; |   if (day <= 31) return SHIP_LINES.instant;
 * @mutate src/content/giftGuideShipping.ts | timeZone: "America/Chicago" | timeZone: "UTC"
 * @mutate src/content/giftGuideCatalog.ts |   ...(brand && LOUISIANA_MADE_BRANDS.includes(brand) ? (["louisiana-made"] as const) : []), |   ...(brand ? (["louisiana-made"] as const) : []),
 * @mutate src/content/giftGuideCatalog.ts |   ...(brand && SPONSOR_BRANDS.includes(brand) ? (["sponsor"] as const) : []), |   ...([] as const),
 * @mutate src/content/giftGuideCatalog.ts |   if (d) draftOf.set(slug, { ...d, picks: [], links: [] }); |   if (d && false) draftOf.set(slug, { ...d, picks: [], links: [] });
 * @mutate scripts/gift-guide-picks.mjs |   if (HELD.includes(slug)) continue; |   if (HELD.includes(slug) && false) continue;
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SHIP_LINES, shippingLine } from "@/content/giftGuideShipping";
import { RESEARCHED_PICKS } from "@/content/giftGuidePicks";
import { LOUISIANA_MADE_BRANDS, SPONSOR_BRANDS } from "@/content/giftGuides";
import { HELD_PICK_GUIDES, guideBySlug } from "@/content/giftGuideCatalog";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";

afterEach(cleanup);
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("gift guides: the shipping banner follows the date in Louisiana", () => {
  // Noon Chicago time is 18:00Z (CST, UTC-6).
  const at = (iso: string) => new Date(iso);
  it("before Dec 15, Dec 15–20, Dec 21–25, then hidden", () => {
    expect(shippingLine(at("2026-11-18T18:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-14T18:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-15T18:00:00Z"))).toBe(SHIP_LINES.late);
    expect(shippingLine(at("2026-12-20T18:00:00Z"))).toBe(SHIP_LINES.late);
    expect(shippingLine(at("2026-12-21T18:00:00Z"))).toBe(SHIP_LINES.instant);
    expect(shippingLine(at("2026-12-25T18:00:00Z"))).toBe(SHIP_LINES.instant);
    expect(shippingLine(at("2026-12-26T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2026-12-31T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2027-01-02T18:00:00Z"))).toBe(SHIP_LINES.early);
  });
  it("uses Louisiana's date, not UTC: 11 PM Chicago on Dec 14 is 05:00Z Dec 15", () => {
    expect(shippingLine(at("2026-12-15T05:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-26T05:30:00Z"))).toBe(SHIP_LINES.instant);
  });
  it("the exact owner wording", () => {
    expect(Object.values(SHIP_LINES)).toEqual([
      "Order by Dec 15 for Christmas delivery",
      "Last days for Christmas shipping: choose fast shipping",
      "Last-minute? Gift cards and digital gifts arrive instantly",
    ]);
  });
});

describe("gift guides: the researched picks (scripts/gift-guide-picks.mjs -> src/content/giftGuidePicks.ts)", () => {
  const all = Object.values(RESEARCHED_PICKS).flat();
  it("are loaded into their guides, in order", () => {
    expect(Object.keys(RESEARCHED_PICKS).length).toBeGreaterThan(20);
    expect(all.length).toBeGreaterThan(500);
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) expect(guideBySlug(slug)?.picks.map((p) => p.href), slug).toEqual(list.map((p) => p.href));
  });
  it("Louisiana-made only for a Louisiana brand (louisianaFit alone is not enough); sponsors get 25 Days sponsor", () => {
    const picks = Object.keys(RESEARCHED_PICKS).flatMap((s) => guideBySlug(s)!.picks);
    for (const p of picks) {
      expect(p.badges?.includes("louisiana-made") ?? false, p.name).toBe(LOUISIANA_MADE_BRANDS.includes(p.brand!));
      expect(p.badges?.includes("sponsor") ?? false, p.name).toBe(SPONSOR_BRANDS.includes(p.brand!));
    }
    const fitNotMade = all.filter((p) => p.louisianaFit && !LOUISIANA_MADE_BRANDS.includes(p.brand));
    expect(fitNotMade.some((p) => p.brand === "YETI")).toBe(true);
    expect(picks.filter((p) => p.badges?.includes("louisiana-made")).length).toBeGreaterThan(50);
    expect(picks.filter((p) => p.badges?.includes("sponsor")).length).toBeGreaterThan(1);
  });
  it("draws the badges on the list, never a price, and every Shop link is sponsored + noopener", () => {
    const { container } = renderAt("/gift-guides/louisiana-made");
    const badges = [...container.querySelectorAll("[data-gift-badge]")].map((b) => b.textContent);
    expect(badges).toContain("Louisiana-made");
    expect(container.querySelector("[data-gift-list]")?.textContent).not.toMatch(/\$\s?\d/);
    const out = [...container.querySelectorAll("[data-gift-list] a")];
    expect(out.length).toBe(25);
    for (const a of out) expect(a.getAttribute("rel")).toBe("sponsored noopener");
  });
  it("holds the budget guides on Picks coming soon until the price-verified list arrives", () => {
    expect(HELD_PICK_GUIDES).toEqual(["under-20", "under-25", "under-50"]);
    const script = readFileSync("scripts/gift-guide-picks.mjs", "utf8");
    expect(script).toContain(`export const HELD = ${JSON.stringify(HELD_PICK_GUIDES).replace(/,/g, ", ")};`);
    for (const slug of HELD_PICK_GUIDES) {
      expect(RESEARCHED_PICKS[slug], slug).toBeUndefined();
      expect(guideBySlug(slug)?.picks, slug).toEqual([]);
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-gift-coming-soon]"), slug).not.toBeNull();
      cleanup();
    }
  });
});
