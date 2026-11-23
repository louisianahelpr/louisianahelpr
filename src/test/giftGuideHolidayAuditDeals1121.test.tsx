/**
 * Holiday gift guides audit 1121, the deal-day Highs (Audit-Holiday-Guides-1121.json):
 *   - no deal card stays up for good: one with no known end leaves after Dec 1; one whose store code expires leaves (or
 *     drops its code) when the code does (20 of 28 cards had no end; XTRATUF kept XT25 after the codes box dropped it);
 *   - the after-the-day line never claims the sales are still on;
 *   - the menu's deal entries open each day's own page and mark that day current (they were #anchors on the old
 *     one-page address that never scrolled, with Black Friday always marked).
 *
 * @mutate src/content/giftGuideDeals.mjs |   return codes.find((c) => c.code === deal.code && c.expires && storeKey(c.store) === storeKey(deal.brand))?.expires; |   return undefined;
 * @mutate src/content/giftGuideDeals.mjs |   return expires && expires < today ? undefined : deal.code; |   return deal.code;
 * @mutate src/content/giftGuideDeals.mjs |   return ends ? ends >= today : today <= RETITLE_AFTER; |   return ends ? ends >= today : true;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |     ...(sales.length ? [{ id: "sales" |     ...(false ? [{ id: "sales"
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | data-gift-deal-brand="">{deal.brand}<span className="sr-only"> | data-gift-deal-brand="">{W.shop(deal.brand)}<span className="sr-only">
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <Link to={`/gift-guides/${d.id}`} {...current(d.id)} data-gift-side-deals={d.id}> | <Link to={`/gift-guides/black-friday-cyber-monday#${d.id}`} data-gift-side-deals={d.id}>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DEALS from "@/content/giftGuideDeals.json";
import { DEAL_EVENTS, RETITLE_AFTER, dealCode, dealDay, dealEnds, liveDeals, type Deal } from "@/content/giftGuideDeals.mjs";
import { DEAL_CODES } from "@/content/giftGuidePicks";
import { discountCodes, giftGuides as G } from "@/content/giftGuides";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { GiftGuidesSidebar } from "@/pages/info/giftGuides/GiftGuidesSidebar";

afterEach(cleanup);
const deals = DEALS as Deal[];
const CODES = [...discountCodes, ...DEAL_CODES];
const plus = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

describe("deal cards never outlive their sale (holiday audit 1121, High)", () => {
  it("after Dec 1, every card still shown has a known end on or after that day; by Jan 15 none is left", () => {
    expect(deals.length).toBeGreaterThan(20); // inventory floor: 28 deals on 2026-11-21
    for (let n = 1; n <= 45; n++) {
      const day = plus(RETITLE_AFTER, n);
      const bad = liveDeals(deals, day, CODES).filter((d) => !(dealEnds(d, CODES) && dealEnds(d, CODES)! >= day));
      expect(bad.map((d) => d.brand), day).toEqual([]);
    }
    expect(liveDeals(deals, "2027-01-15", CODES)).toEqual([]);
  });

  it("a card whose store code has an expiry ends with it, and its code chip never outlives the code", async () => {
    const coded = deals.filter((d) => d.code && CODES.some((c) => c.code === d.code && c.expires && c.store.toLowerCase() === d.brand.toLowerCase()));
    expect(coded.map((d) => d.brand)).toContain("XTRATUF"); // XT25, expires 2026-11-29
    for (const d of coded) {
      const expires = CODES.find((c) => c.code === d.code && c.store.toLowerCase() === d.brand.toLowerCase())!.expires!;
      expect(dealEnds(d, CODES)! <= expires || dealEnds(d, CODES) === d.ends, d.brand).toBe(true);
      const day = dealDay(d.event)!;
      for (const [ymd, has] of [[expires, true], [plus(expires, 1), false]] as const) {
        const { container } = render(<MemoryRouter><GiftGuideDeals day={day} now={new Date(`${ymd}T18:00:00Z`)} /></MemoryRouter>);
        // Polish audit 1122 #12: a card has no "Shop" line now; wait for a card (or the all-ended line).
        await waitFor(() => expect(container.querySelector("[data-gift-deal]") ?? screen.queryByText(/These deals have ended/)).toBeTruthy());
        expect(!!container.querySelector(`[data-gift-deal-code="${d.code}"]`), `${d.brand} ${d.code} on ${ymd}`).toBe(has);
        cleanup();
      }
    }
  });

  it("a sale that runs past its code keeps its card but drops the code the day after the code expires", () => {
    const longSale = { brand: "XTRATUF", code: "XT25", ends: "2026-12-10" };
    expect(dealCode(longSale, "2026-11-29", CODES)).toBe("XT25");
    expect(dealCode(longSale, "2026-11-30", CODES)).toBeUndefined();
    expect(liveDeals([longSale], "2026-11-30", CODES)).toEqual([longSale]);
    // A code with no published expiry keeps showing while its card does.
    expect(dealCode({ brand: "BruMate", code: "GIFT25" }, "2026-11-30", CODES)).toBe("GIFT25");
  });

  it("the after-the-day line never says the sales are still on", () => {
    expect(DEAL_EVENTS.filter((e) => /still on/i.test(e.after)).map((e) => e.id)).toEqual([]);
  });
});

describe("deal cards and the codes box read cleanly (holiday audit 1121, Lows)", () => {
  it("no 'On <store>' line, the brand's name is the card's link (polish audit 1122 #12: no Shop line), no campaign names in the text", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("black-friday")!} now={new Date("2026-11-25T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-gift-deal]")).not.toBeNull());
    const cards = [...container.querySelectorAll("[data-gift-deal]")];
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards) {
      expect(c.querySelector("[data-gift-deal-dates]")?.textContent ?? "", c.getAttribute("data-gift-deal")!).not.toMatch(/\bOn /);
      expect(c.querySelector("[data-gift-shop]")).toBeNull();
      const brand = c.querySelector("a[data-gift-deal-brand]")!;
      expect(brand.firstChild?.textContent).toBe(c.getAttribute("data-gift-deal"));
      expect(brand.getAttribute("href")).toBe(c.querySelector("a.gg-deal-photo")?.getAttribute("href"));
    }
    expect(deals.filter((d) => /turkey 12/i.test(d.deal)).map((d) => d.brand)).toEqual([]);
  });
  it("the Sales subsection is there with its store cards whenever there are sales (it once showed a heading over no rows)", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("black-friday")!} now={new Date("2026-11-25T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-gift-deal]")).not.toBeNull());
    const sales = container.querySelector("section[data-gift-deal-sub='sales'] [data-gift-sales]");
    expect(sales).not.toBeNull();
    expect(sales!.querySelectorAll("li[data-gift-sale]").length).toBeGreaterThanOrEqual(3);
  });
});

describe("the menu's deal days open each day's own page (holiday audit 1121, High)", () => {
  it("each entry links /gift-guides/<day>, and only the open day is marked current", () => {
    expect(G.sideDeals.length).toBe(3);
    for (const open of G.sideDeals) {
      const { container } = render(<MemoryRouter><GiftGuidesSidebar active={null} page={open.id} /></MemoryRouter>);
      for (const d of G.sideDeals) {
        const a = container.querySelector(`[data-gift-side-deals="${d.id}"]`)!;
        expect(a.getAttribute("href")).toBe(`/gift-guides/${d.id}`);
        expect(a.getAttribute("aria-current"), `${d.id} on ${open.id}`).toBe(d.id === open.id ? "page" : null);
      }
      cleanup();
    }
  });
});
