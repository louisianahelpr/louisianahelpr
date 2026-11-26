/**
 * Owner 2026-11-22, the guide sub-pages on a desktop:
 *   - "the box with the guides should fill the space to the edge of the red part above" (Gift tags), "same here"
 *     (Coloring books), "make it wider like the others" (Banners), "needs to fill the space" (Secret Santa), "needs to
 *     be wider like the rest" (Gift planner): the fun pages' and printables' column spans the content column to the
 *     banner's right edge (no 640px cap), and a banner card is a row from 1024px (image left, words and links right);
 *   - "this doesnt need to show on any of the free printable sections"; "remove affiliate link stuff from where it does
 *     not belong": the affiliate line shows only on a page that renders an affiliate link (GuidesDisclosure watches the
 *     page), never on the printables, Secret Santa or the Holiday Hub, and still on every guide and every page with a
 *     shop link (Amazon Associates requires it wherever an Amazon link appears);
 *   - "104 gifts needs to move to the right like the other pages are set up": on a desktop the 25 Days sponsors page is
 *     set up as Her (pill and icons in the header row, the count heading the content column), not one row across the
 *     page above the menu; a phone keeps the guides' one row under the banner.
 *
 * Guide consistency audit 1122 (lead): #2 the Holiday Hub is marked open in the menu and in the top nav's gift link;
 * #12 Small Business Saturday and an empty My Wish List (no affiliate link) show no line; #23 an empty My Wish List
 * starts at the content column's left edge on a desktop.
 *
 * @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | if (!linked) return null; | if (false) return null;
 * @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | const AFFILIATE_LINK = "a[data-gift-out], a[rel~='sponsored']"; | const AFFILIATE_LINK = "a[data-none]";
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun{margin:0;padding:4px 0 24px} | .gg-fun{max-width:640px;margin:0;padding:4px 0 24px}
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | @media (min-width:1024px){.pr-card-wide{flex-direction:row; | @media (min-width:1024px){.pr-card-wide{flex-direction:column;
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <Link to="/holidays" {...current("/holidays")} data-gift-side-holiday-hub=""> | <Link to="/holidays" data-gift-side-holiday-hub="">
 * @mutate src/components/Navbar.tsx | if (under("/gift-guides") \|\| path === "/holidays") return "guides"; | if (under("/gift-guides")) return "guides";
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-soon[data-gift-my-list-empty]{text-align:left; | .gg-soon[data-gift-my-list-empty]{text-align:center;
 * @mutate src/pages/info/GiftGuides.tsx |   const countRow = phone && Boolean(guide) && !deals; |   const countRow = (phone && Boolean(guide) && !deals) \|\| guide?.slug === "25-days-sponsors";
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import Navbar from "@/components/Navbar";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import SecretSanta from "@/pages/info/giftGuides/fun/SecretSanta";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import { FunBody } from "@/pages/info/giftGuides/fun/FunPage";
import { GiftOut } from "@/pages/info/giftGuides/GiftOut";
import { giftGuides as G } from "@/content/giftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { PRINTABLE_PAGES } from "@/content/printables";

await loadAllGuidePicks();

afterEach(() => cleanup());

const disclosures = (c: HTMLElement) => c.querySelectorAll("[data-gift-disclosure]");
const affiliateLinks = (c: HTMLElement) => c.querySelectorAll("a[data-gift-out], a[rel~='sponsored']");
const styles = (c: HTMLElement) => [...c.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");

const guidesAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/gift-guides" element={<GiftGuides />} />
      <Route path="/gift-guides/:slug" element={<GiftGuides />} />
    </Routes>
  </MemoryRouter>,
).container;

describe("the affiliate line shows only where an affiliate link does (owner 2026-11-22)", () => {
  it("no line on the printables, Secret Santa or the Holiday Hub, none of which carries an affiliate link", () => {
    expect(PRINTABLE_PAGES.length).toBeGreaterThan(2); // inventory floor: Gift tags, Coloring books, Banners
    const pages: [string, HTMLElement][] = [
      ...PRINTABLE_PAGES.map((p) => [p.path, render(<MemoryRouter initialEntries={[p.path]}><Printables /></MemoryRouter>).container] as [string, HTMLElement]),
      ["/gift-guides/draw-names", render(<MemoryRouter><SecretSanta /></MemoryRouter>).container],
      ["/holidays", render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>).container],
    ];
    for (const [path, c] of pages) {
      expect(c.querySelector("[data-gift-fun-frame]"), path).not.toBeNull(); // the page drew the guides' frame
      expect(affiliateLinks(c).length, path).toBe(0);
      expect(disclosures(c).length, path).toBe(0);
    }
  });

  it("the line, with Amazon's statement, on every guide page and the landing (they carry Amazon links)", () => {
    for (const url of ["/gift-guides", "/gift-guides/her", "/gift-guides/him", "/gift-guides/kids", "/gift-guides/25-days-sponsors"]) {
      const c = guidesAt(url);
      expect(affiliateLinks(c).length, url).toBeGreaterThan(0);
      expect(disclosures(c).length, url).toBe(1);
      expect(disclosures(c)[0].textContent, url).toBe(G.disclosure);
      expect(c.querySelector("[data-gift-disclosure] > [data-gift-amazon-statement]")?.textContent, url).toBe(G.amazonStatement);
      cleanup();
    }
  });

  it("a fun page shows the line as soon as it renders an affiliate link, and not before", async () => {
    let show: (on: boolean) => void = () => {};
    function Deck() {
      const [on, setOn] = useState(false);
      show = setOn;
      return on ? <GiftOut href="www.amazon.com/dp/B0X?tag=louisianahelpr-20">Shop</GiftOut> : <p>pick who it is for</p>;
    }
    const { container } = render(<MemoryRouter><FunBody title="Swipe" path="/gift-guides/swipe"><Deck /></FunBody></MemoryRouter>);
    expect(disclosures(container).length).toBe(0);
    act(() => show(true));
    await waitFor(() => expect(disclosures(container).length).toBe(1));
    expect(container.querySelector("[data-gift-fun-disclosure] [data-gift-amazon-statement]")?.textContent).toBe(G.amazonStatement);
    act(() => show(false));
    await waitFor(() => expect(disclosures(container).length).toBe(0));
  });
});

describe("the guide sub-pages fill the content column to the banner's edge (owner 2026-11-22)", () => {
  it("the fun pages' and printables' column has no width cap; a banner card is a row from 1024px", () => {
    const c = render(<MemoryRouter initialEntries={["/gift-guides/printables/banners"]}><Printables /></MemoryRouter>).container;
    const css = styles(c);
    const fun = /(?:^|\n)\.gg-fun\{([^}]*)\}/.exec(css)?.[1];
    expect(fun).toBeDefined();
    expect(fun).not.toMatch(/max-width/);
    expect(css).not.toMatch(/\.pr-card-wide\{[^}]*max-width/);
    expect(css).toMatch(/@media \(min-width:1024px\)\{\.pr-card-wide\{flex-direction:row;align-items:center;[^}]*\}\.pr-card-wide \.pr-card-img\{width:50%/);
    expect(c.querySelectorAll("[data-printable-card]").length).toBeGreaterThan(0); // the banners drew
  });

  it("the sponsors page is set up as Her on a desktop, and keeps the one row under the banner on a phone", () => {
    for (const slug of ["her", "25-days-sponsors"]) {
      const desk = guidesAt(`/gift-guides/${slug}`);
      expect(desk.querySelector("[data-gift-countrow]"), slug).toBeNull();
      expect(desk.querySelector("[data-gift-ship]"), slug).toBeNull(); // no "Order by Dec 15" pill (owner 11-24)
      expect(desk.querySelector("[data-gift-headrow] [data-gift-quick] [data-gift-search-button]"), slug).not.toBeNull();
      expect(desk.querySelectorAll(".gg-main [data-gift-item-count]").length, slug).toBe(1);
      cleanup();
    }
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      const phone = guidesAt("/gift-guides/25-days-sponsors");
      const phoneRow = phone.querySelectorAll("[data-gift-countrow]");
      expect(phoneRow.length).toBe(1);
      expect(phoneRow[0].closest(".gg-layout")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});

describe("guide consistency audit 1122 follow-ups", () => {
  it("#12: Small Business Saturday and an empty My Wish List carry no affiliate link, so no line", async () => {
    // Pinned to the day this was written (lander 11-26): the deals days read today's date (embargoed codes, the day's own
    // cards), so an unpinned run changed answer as the calendar moved.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    const sbs = guidesAt("/gift-guides/small-business-saturday");
    await waitFor(() => expect(sbs.querySelector("[data-gift-deal-day-page='small-business-saturday']")).not.toBeNull());
    expect(affiliateLinks(sbs).length).toBe(0);
    expect(disclosures(sbs).length).toBe(0);
    cleanup();
    const mine = guidesAt("/gift-guides/my-list");
    await waitFor(() => expect(mine.querySelector("[data-gift-my-list-empty]")).not.toBeNull());
    expect(disclosures(mine).length).toBe(0);
    cleanup();
    // A deals day with shop links keeps it.
    const bf = guidesAt("/gift-guides/black-friday");
    await waitFor(() => expect(affiliateLinks(bf).length).toBeGreaterThan(0));
    await waitFor(() => expect(disclosures(bf).length).toBe(1));
  });

  it("#2: on the Holiday Hub its menu entry and the top nav's gift guides links are current", () => {
    const hub = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>).container;
    expect(hub.querySelector("[data-gift-sidebar] [data-gift-side-holiday-hub]")?.getAttribute("aria-current")).toBe("page");
    expect(hub.querySelectorAll("[data-gift-sidebar] [aria-current]").length).toBe(1);
    cleanup();
    const nav = render(<MemoryRouter initialEntries={["/holidays"]}><Navbar landing={false} /></MemoryRouter>).container.querySelector('nav[aria-label="Primary"]')!;
    const gifts = [...nav.querySelectorAll('a[href="/gift-guides"]')];
    expect(gifts.length).toBeGreaterThan(0); // inventory floor: the words link and the phone's gift icon
    for (const a of gifts) expect(a.getAttribute("aria-current")).toBe("page");
  });

  it("#23: an empty My Wish List starts at the content column's left edge on a desktop", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (min-width:768px){.gg-soon[data-gift-my-list-empty]{text-align:left;padding-left:0;padding-right:0}.gg-soon[data-gift-my-list-empty] p{margin-left:0}}");
  });
});
