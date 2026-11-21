/**
 * The calm /gift-guides landing (owner 11-20 PM, from her phone: "The gift guide page is still a busy mess") and the
 * affordable Gift of the Day (owner 11-20: "The gift of the day shouldn't be expensive"; it was a ~$750 Dyson Airwrap).
 *
 * Landing: ONE title (the h1) with one short subline carrying the shipping words, no header row above it; the gift
 * finder folded into one "Find a gift in 3 taps" card until tapped (no chips up front), and still a list once all three
 * are picked; ONE grid of photo cards as the way in (By person, For kids, By budget, Louisiana, By store, Deals) with the
 * smaller groups as one line of links, so every group (and so every guide, through its group's page) is one tap away;
 * no chip strip and no sideways guide rows; the Gift of the Day below the grid; the disclosures still last.
 *
 * Gift of the Day: only a pick with a checked, shown price (non-Amazon, fresh) of $50 or less, from a well-known,
 * broadly giftable brand, never aimed at one gender or a kid.
 *
 * @mutate src/pages/info/GiftGuides.tsx | hideHeader={landing}> | hideHeader={false}>
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx |   if (!open) { |   if (open && !open) {
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       <BrowseGrid /> |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | ROWS.filter((r) => !G.entries.some((e) => e.row === r.row) && rowTiles(r.row).length > 0) | ROWS.filter((r) => r.row === "pets")
 * @mutate src/content/giftGuideFun1120.ts | p.price > 0 && p.price <= GOTD_MAX_PRICE && | p.price > 0 &&
 * @mutate src/content/giftGuideFun1120.ts | && pricedToday(p) && | &&
 * @mutate src/content/giftGuideFun1120.ts | && gotdBrandOk(p) && | &&
 */
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, titleActions, hideHeader, children }: { title: string; titleActions?: React.ReactNode; hideHeader?: boolean; children: React.ReactNode }) => (
    <main>{!hideHeader && <div data-test-header-row=""><p>{title}</p>{titleActions}</div>}{children}</main>
  ),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { giftGuides as G } from "@/content/giftGuides";
import { ROWS, guideBySlug, loadGuidePicks, topPicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { GOTD_BRANDS, GOTD_MAX_PRICE, giftOfTheDay, giftOfTheDayPool, louisianaYmd } from "@/content/giftGuideFun1120";
import { showsPrice } from "@/components/giftGuides/PickPrice";
import { GOTD_SOURCE_GUIDE, GiftCountdown } from "@/pages/info/giftGuides/fun/GiftCountdown";
import { rowTiles } from "@/pages/info/giftGuides/GiftGuideLanding";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";

afterEach(cleanup);
await loadGuidePicks(GOTD_SOURCE_GUIDE);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

/** Noon in Louisiana on a day ("2026-11-20"). */
const la = (ymd: string) => new Date(`${ymd}T18:00:00Z`);
const AMAZON = /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co)$/;

describe("the calm landing (owner 11-20 PM)", () => {
  it("has ONE title (the h1) with a short subline holding the shipping words, and no header row above it", () => {
    const { container } = renderAt("/gift-guides");
    expect([...container.querySelectorAll("h1")].map((h) => h.textContent)).toEqual([G.title]);
    expect(container.querySelector("[data-test-header-row]")).toBeNull();
    const sub = container.querySelector("[data-gift-words] [data-gift-sub]")!;
    expect(sub.textContent).toMatch(new RegExp(`^${G.landingSub}`));
    expect(container.querySelector("[data-gift-words] .gg-lead")).toBeNull();
    // A guide's page keeps its header row (back arrow, "Gift guides" and the shipping pill).
    cleanup();
    expect(renderAt("/gift-guides/mom").container.querySelector("[data-test-header-row] [data-gift-ship]")).not.toBeNull();
  });

  it("folds the gift finder into one card: no chips until tapped; a tap opens the three steps, and three picks always give a list", () => {
    const { container } = renderAt("/gift-guides");
    const finder = container.querySelector("[data-gift-finder]")!;
    expect(finder.matches("[data-gift-finder-folded]")).toBe(true);
    expect(container.querySelectorAll("[data-gift-finder-choice], .gg-chip").length).toBe(0);
    const open = finder.querySelector<HTMLButtonElement>("button[data-gift-finder-open]")!;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.textContent).toContain("Find a gift in 3 taps");
    fireEvent.click(open);
    expect(container.querySelectorAll('[data-gift-finder-choice^="who:"]').length).toBeGreaterThan(4);
    fireEvent.click(container.querySelector('[data-gift-finder-choice="who:her"]')!);
    fireEvent.click(container.querySelector('[data-gift-finder-step="budget"] button')!);
    fireEvent.click(container.querySelector('[data-gift-finder-step="vibe"] button')!);
    expect(container.querySelector("[data-gift-finder-results]")).not.toBeNull();
    cleanup();
    // A shared answer link opens it straight away.
    expect(renderAt("/gift-guides?who=her#gift-finder").container.querySelector("[data-gift-finder-folded]")).toBeNull();
  });

  it("has ONE grid of photo cards as the way in, the smaller groups as one line of links; no chip strip, no guide rows", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector("[data-gift-quick-picks], [data-gift-row], a[data-gift-see-all], a[data-gift-tile]")).toBeNull();
    const cards = [...container.querySelectorAll<HTMLAnchorElement>("[data-gift-entries] a[data-gift-entry]")];
    expect(cards.map((a) => a.querySelector(".gg-entry-title")?.textContent)).toEqual([...G.entries.map((e) => e.title), G.dealsEntry.title]);
    for (const a of cards) {
      const img = a.querySelector("img")!;
      expect(img, a.getAttribute("data-gift-entry")!).not.toBeNull();
      expect(existsSync(`public${img.getAttribute("src")}`), img.getAttribute("src")!).toBe(true);
      expect(a.querySelector(".gg-entry-sub")?.textContent).toBeTruthy();
    }
    expect(cards[cards.length - 1].getAttribute("href")).toBe(`/gift-guides/${DEALS_SLUG}`);
    // Every group with guides is reached: by its card or its link; a group of one opens that guide, else its page.
    const links = [...container.querySelectorAll<HTMLAnchorElement>("[data-gift-entries] a[data-gift-entry], [data-gift-more-groups] a")].map((a) => a.getAttribute("href"));
    const groups = ROWS.filter((r) => rowTiles(r.row).length > 0);
    expect(groups.length).toBeGreaterThan(7);
    for (const r of groups) {
      const tiles = rowTiles(r.row);
      const want = tiles.length === 1 ? `/gift-guides/${tiles[0].g.slug}` : `/gift-guides?group=${r.row}`;
      expect(links, r.row).toContain(want);
    }
  });

  it("puts the Gift of the Day below the grid, and the disclosures stay last", () => {
    const { container } = renderAt("/gift-guides");
    const grid = container.querySelector("[data-gift-browse]")!;
    const gotd = container.querySelector("[data-gift-countdown]")!;
    expect(grid.compareDocumentPosition(gotd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const main = container.querySelector(".gg-main")!;
    expect(main.lastElementChild?.matches("footer.gg-disc")).toBe(true);
    expect(main.lastElementChild?.querySelector("[data-gift-disclosure]")).not.toBeNull();
  });
});

describe("the Gift of the Day is affordable and priced (owner 11-20)", () => {
  const budget = guideBySlug(GOTD_SOURCE_GUIDE)!.picks;
  const pool = [...budget, ...topPicks()];
  // The day the newest price was checked: every price shown on that day is fresh.
  const newest = pool.map((p) => p.priceAt ?? "").sort().slice(-1)[0];
  const pricedOn = (ymd: string) => (p: CatalogPick) => showsPrice(p, ymd);

  it("draws only checked, shown prices of $50 or less, from a known brand, on every day of a month", () => {
    const fits = giftOfTheDayPool(pool, pricedOn(newest));
    expect(fits.length).toBeGreaterThan(4);
    const seen = new Set<string>();
    for (let d = 0; d < 31; d += 1) {
      const day = new Date(la(newest).getTime() + d * 86400000);
      // Prices are re-checked daily; hold today's check fresh for each day of the month.
      const g = giftOfTheDay(pool, day, pricedOn(newest))!;
      expect(g, louisianaYmd(day)).not.toBeNull();
      expect(typeof g.price).toBe("number");
      expect(g.price!).toBeLessThanOrEqual(GOTD_MAX_PRICE);
      expect(showsPrice(g, newest), g.name).toBe(true);
      expect(AMAZON.test(new URL(g.href).hostname), g.name).toBe(false);
      expect(GOTD_BRANDS.some((b) => (g.brand ?? "").toLowerCase() === b.toLowerCase() || g.name.toLowerCase().startsWith(`${b.toLowerCase()} `)), g.name).toBe(true);
      expect(g.name).not.toMatch(/\b(?:wo)?men'?s\b/i);
      seen.add(g.href);
    }
    // It rotates.
    expect(seen.size).toBeGreaterThan(4);
    // The Top 10's Dyson (owner's pick, still on Mom's guide) is never the Gift of the Day.
    expect([...seen].some((h) => pool.find((p) => p.href === h)?.name.includes("Dyson"))).toBe(false);
  });

  it("never draws a pick over $50, an unpriced or stale price, an Amazon pick, an unknown brand or a one-gender pick", () => {
    const base = { store: "store-x", priceAt: "2026-11-20", href: "" } as const;
    const synthetic: CatalogPick[] = [
      { ...base, name: "Stanley Big Cooler", brand: "Stanley", price: 60, href: "https://example.com/a" },
      { ...base, name: "Stanley Mug", brand: "Stanley", href: "https://example.com/b" },
      { ...base, name: "Stanley Old Price Mug", brand: "Stanley", price: 20, priceAt: "2026-10-01", href: "https://example.com/c" },
      { ...base, name: "Stanley Amazon Mug", brand: "Stanley", price: 20, store: "store-amazon", href: "https://www.amazon.com/dp/X" },
      { ...base, name: "Dyson Airwrap", brand: "Dyson", price: 40, href: "https://example.com/d" },
      { ...base, name: "XTRATUF Women's Ankle Boot", brand: "XTRATUF", price: 45, href: "https://example.com/e" },
      { ...base, name: "YETI Rambler Mug", brand: "YETI", price: 30, href: "https://example.com/ok" },
    ];
    for (let d = 0; d < 30; d += 1) {
      const g = giftOfTheDay(synthetic, new Date(la("2026-11-20").getTime() + d * 86400000), pricedOn("2026-11-20"));
      expect(g?.href).toBe("https://example.com/ok");
    }
    expect(giftOfTheDay(synthetic.slice(0, 6), la("2026-11-20"), pricedOn("2026-11-20"))).toBeNull();
  });

  it("the card shows the day's affordable gift with its price, its whole name and no splurge", async () => {
    const { container, findByText } = render(<MemoryRouter><GiftCountdown now={la(newest)} /></MemoryRouter>);
    const g = giftOfTheDay(pool, la(newest), pricedOn(newest))!;
    await findByText((_, el) => el?.classList.contains("gg-today-name") === true && el.textContent?.startsWith(g.name.replace(/\s*\([^()]*\)\s*$/, "")) === true);
    const price = container.querySelector("[data-gift-of-the-day] [data-gift-price]")?.textContent ?? "";
    expect(Number(price.replace(/[^\d]/g, ""))).toBeLessThanOrEqual(GOTD_MAX_PRICE);
    expect(container.querySelector("[data-gift-of-the-day]")?.getAttribute("data-gift-of-the-day")).toBe(g.href);
  });
});
