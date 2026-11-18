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
 * @mutate src/pages/info/giftGuides/giftList.tsx | aria-pressed={saved} | aria-pressed={false}
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | onToggle={() => toggleGuide(g.slug)} | onToggle={() => undefined}
 * @mutate src/pages/info/giftGuides/giftList.tsx |     window.localStorage.setItem(KEY, JSON.stringify(next)); |     window.localStorage.setItem(KEY, "{}");
 * @mutate src/content/giftGuideCatalog.ts |   ...(flags.shipsFast ? (["ships-fast"] as const) : []), |   ...(flags.trending ? (["ships-fast"] as const) : []),
 * @mutate src/content/giftGuideCatalog.ts |     return words.every((w) => hay.includes(w)); |     return words.some((w) => hay.includes(w));
 * @mutate src/content/giftGuideCatalog.ts |     const hay = fold(`${g.title} ${g.lead} ${label.get(g.row) ?? ""}`); |     const hay = fold(`${g.title} ${g.lead}`);
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |       {query.trim() ? ( |       {false ? (
 * @mutate src/content/giftGuideCatalog.ts |   draftOf.set(slug, { ...d, picks: list.map(toPick) }); |   draftOf.set(slug, { ...d });
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SHIP_LINES, shippingLine } from "@/content/giftGuideShipping";
import { RESEARCHED_PICKS } from "@/content/giftGuidePicks";
import { LOUISIANA_MADE_BRANDS, SPONSOR_BRANDS, giftGuides } from "@/content/giftGuides";
import { badgesFor, guideBySlug, searchGuides } from "@/content/giftGuideCatalog";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { resetGiftListForTests } from "@/pages/info/giftGuides/giftList";

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
  it("loads the price-verified budget guides like the others (lead 2026-11-18: the hold is released)", () => {
    for (const slug of ["under-20", "under-25", "under-50", "stocking-stuffers"]) {
      expect(RESEARCHED_PICKS[slug]?.length, slug).toBeGreaterThan(10);
      expect(guideBySlug(slug)?.picks.map((p) => p.href), slug).toEqual(RESEARCHED_PICKS[slug].map((p) => p.href));
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-gift-coming-soon]"), slug).toBeNull();
      expect(container.querySelectorAll("[data-gift-pick]").length, slug).toBe(RESEARCHED_PICKS[slug].length);
      cleanup();
    }
  });
});

describe("gift guides: the sidebar search filters guides by title and group", () => {
  it("matches titles and group names, case- and accent-blind; empty words match nothing", () => {
    expect(searchGuides("")).toEqual([]);
    expect(searchGuides("   ")).toEqual([]);
    expect(searchGuides("MOM").map((g) => g.slug)).toEqual(expect.arrayContaining(["mom", "new-mom"]));
    // By group: "experiences" finds every guide in that row, even ones whose title lacks the word.
    expect(searchGuides("experiences").map((g) => g.slug)).toEqual(expect.arrayContaining(["gift-cards", "spa-days", "date-night"]));
    expect(searchGuides("tractor supply").map((g) => g.slug)).toEqual(["store-tractor-supply"]);
    expect(searchGuides("cafe du monde").length).toBe(0);
    expect(searchGuides("xyzzy")).toEqual([]);
    expect(searchGuides("dillards").length + searchGuides("dillard's").length).toBeGreaterThan(0);
  });
  it("the box sits at the top of the sidebar and typing replaces the groups with the matches", () => {
    const { container } = renderAt("/gift-guides");
    const side = container.querySelector("[data-gift-sidebar]")!;
    const input = screen.getByRole("searchbox", { name: "Search gift guides" });
    expect(input.getAttribute("placeholder")).toBe("Search");
    expect(side.firstElementChild?.contains(input)).toBe(true);
    expect(side.querySelector("label svg")).not.toBeNull();
    fireEvent.change(input, { target: { value: "spa" } });
    const found = [...side.querySelectorAll("a[data-gift-found]")].map((a) => a.getAttribute("data-gift-found"));
    expect(found).toContain("spa-days");
    expect(side.querySelector("details[data-gift-group]")).toBeNull();
    fireEvent.change(input, { target: { value: "xyzzy" } });
    expect(side.textContent).toContain("No guides match");
    fireEvent.change(input, { target: { value: "" } });
    expect(side.querySelectorAll("details[data-gift-group]").length).toBeGreaterThan(5);
  });
});

describe("gift guides: hearts save to My list (aria-pressed, never opening the guide)", () => {
  afterEach(() => {
    window.localStorage.clear();
    resetGiftListForTests();
  });
  it("a cover heart toggles aria-pressed, stays on the page, and counts in the sidebar's My list", () => {
    window.localStorage.clear();
    resetGiftListForTests();
    const { container } = renderAt("/gift-guides");
    const heart = screen.getByRole("button", { name: "Save Mom to My list" });
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    expect(heart.closest("a")).toBeNull();
    const link = container.querySelector("[data-gift-my-list-link]")!;
    expect(link.textContent).toContain("My list (0)");
    fireEvent.click(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-gift-words] h2")?.textContent).toBe("Holiday Gift Guides");
    expect(link.textContent).toContain("My list (1)");
    expect(JSON.parse(window.localStorage.getItem("lh-gift-list")!).guides).toEqual(["mom"]);
    fireEvent.click(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    expect(link.textContent).toContain("My list (0)");
  });
  it("a pick heart saves the pick; My list shows saved guides and picks", () => {
    const g = guideBySlug("mom")!;
    const view = renderAt("/gift-guides/mom");
    const hearts = [...view.container.querySelectorAll("[data-gift-pick] [data-gift-heart]")];
    expect(hearts.length).toBe(g.picks.length);
    for (const h of hearts) expect(h.closest("a")).toBeNull();
    fireEvent.click(hearts[0]);
    expect(hearts[0].getAttribute("aria-pressed")).toBe("true");
    cleanup();
    const mine = renderAt("/gift-guides?list=mine").container;
    expect(mine.querySelector("[data-gift-my-list]")).not.toBeNull();
    expect(mine.querySelectorAll("[data-gift-my-list] [data-gift-pick]").length).toBe(1);
    expect(mine.querySelector("[data-gift-my-list] [data-gift-pick]")?.textContent).toContain(g.picks[0].name);
  });
  it("blocked storage still works for the visit", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderAt("/gift-guides");
    const heart = screen.getByRole("button", { name: "Save Dad to My list" });
    fireEvent.click(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    spy.mockRestore();
  });
});

describe("gift guides: pick badges come from optional fields, never a price", () => {
  it("Trending, Louisiana-made, 25 Days sponsor, Ships fast, Local pickup, in that order", () => {
    expect(badgesFor("TABASCO", { trending: true, shipsFast: true, localPickup: true })).toEqual(["trending", "louisiana-made", "ships-fast", "local-pickup"]);
    expect(badgesFor("Crew Dog")).toEqual(["sponsor"]);
    expect(badgesFor("YETI")).toEqual([]);
    expect(badgesFor(undefined, { localPickup: true })).toEqual(["local-pickup"]);
    expect(Object.values(giftGuides.badges)).toEqual(["Trending", "Louisiana-made", "25 Days sponsor", "Ships fast", "Local pickup"]);
    for (const label of Object.values(giftGuides.badges)) expect(label).not.toMatch(/\$/);
  });
});
