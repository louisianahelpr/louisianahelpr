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
 *   - "104 gifts needs to move to the right like the other pages are set up": on a desktop the 25 Days sponsors' count
 *     row heads the content column, right of the menu, not across the page above it; a phone keeps it under the banner.
 *
 * @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | if (!linked) return null; | if (false) return null;
 * @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | export const AFFILIATE_LINK = "a[data-gift-out], a[rel~='sponsored']"; | export const AFFILIATE_LINK = "a[data-none]";
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun{margin:0;padding:4px 0 24px} | .gg-fun{max-width:640px;margin:0;padding:4px 0 24px}
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | @media (min-width:1024px){.pr-card-wide{flex-direction:row; | @media (min-width:1024px){.pr-card-wide{flex-direction:column;
 * @mutate src/pages/info/GiftGuides.tsx |   const countInMain = countRow && !phone; |   const countInMain = false;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
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

  it("the sponsors' count row heads the content column on a desktop, and sits under the banner on a phone", () => {
    const desk = guidesAt("/gift-guides/25-days-sponsors");
    const row = desk.querySelectorAll("[data-gift-countrow]");
    expect(row.length).toBe(1);
    expect(row[0].parentElement?.classList.contains("gg-main")).toBe(true);
    expect(row[0].parentElement?.firstElementChild).toBe(row[0]);
    expect(row[0].querySelector("[data-gift-item-count]")).not.toBeNull();
    cleanup();
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
