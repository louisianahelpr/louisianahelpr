/**
 * The gift guides on a phone (owner 2026-11-21, two iPhone screenshots: the whole grouped menu sat at the very bottom
 * of the page under the affiliate text; "We need a way to organize this on the phones"). Up to 767px the sidebar is not
 * drawn; the same grouped menu opens in the shared bottom Sheet.
 * Owner 2026-11-22 (phone): "Remove ... hers him kids deals. Only thing that will stay is the 3 line with no circle around
 * it and the heart": the sticky chip row is gone and the head row's three-line icon opens the sheet, so the sheet holds
 * every page the chips held (Her, Him, Kids, the deals days, the printables) plus My Wish List.
 *
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx | <GuidesMenuButton active={nav.active} myList={nav.myList} page={nav.page} /> | {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneSheet.tsx | <GiftGuidesMenu active={active} myList={myList} page={page} idPrefix={idPrefix} wishList /> | {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneNav.tsx | onClick={() => setSheet(true)} | onClick={() => setSheet(false)}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |         {wishList && <li> |         {false && <li>
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneSheet.tsx | idPrefix={idPrefix} wishList /> | idPrefix={idPrefix} />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

afterEach(cleanup);
await loadAllGuidePicks();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the phone's gift guides menu (owner 11-21; opened by the head row's three-line icon, owner 11-22)", () => {
  it("no chip row anywhere; the three-line icon is a plain 44px button named \"Guides menu\" that opens a dialog", () => {
    const { container } = renderAt("/gift-guides/him");
    expect(container.querySelector("[data-gift-phone-nav], [data-gift-chip]")).toBeNull();
    const menu = container.querySelector<HTMLButtonElement>("[data-gift-headrow] [data-gift-head-menu]")!;
    expect(menu.tagName).toBe("BUTTON");
    expect(menu.getAttribute("aria-label")).toBe("Guides menu");
    expect(menu.getAttribute("aria-haspopup")).toBe("dialog");
    expect(menu.textContent).toBe("");
    expect(menu.className).toMatch(/\bgg-icon\b/);
    expect(menu.className).toMatch(/\bw-11 h-11\b/);
  });

  it("the icon opens the shared bottom Sheet with the whole grouped menu plus My Wish List; a link closes it", async () => {
    // jsdom reads no @media, so the phone-only button is pressed by its data hook.
    const { container } = renderAt("/gift-guides/kids");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(container.querySelector("[data-gift-head-menu]")!); });
    // The sheet is its own chunk, loaded on the first tap (off the page's critical path).
    const sheet = await screen.findByRole("dialog");
    expect(sheet.hasAttribute("data-gift-menu-sheet")).toBe(true);
    expect([...sheet.querySelectorAll(".gg-side-h")].map((h) => h.textContent)).toEqual(["Guides", "Deals", "Free printables", "Make it fun", "Louisiana"]);
    // Everything the chips held is in the sheet: the guides, the deals days, the printables, and My Wish List.
    const names = within(sheet).getAllByRole("link").map((a) => a.textContent);
    for (const name of ["Her", "Him", "Kids", "My Wish List", "Black Friday", "Small Business Saturday", "Cyber Monday", "Gift tags", "Coloring books", "Banners", "Find a gift"]) {
      expect(names, name).toContain(name);
    }
    expect(within(sheet).getByRole("link", { name: "My Wish List" }).getAttribute("href")).toBe("/gift-guides/my-list");
    // Its own heading ids (no clash with the desktop sidebar's), each list labelled by its heading.
    for (const ul of sheet.querySelectorAll("ul")) expect(sheet.querySelector(`#${ul.getAttribute("aria-labelledby")}`)?.id.startsWith("gg-sheet-")).toBe(true);
    expect(within(sheet).getByRole("link", { name: "Kids" }).getAttribute("aria-current")).toBe("page");
    await act(async () => { fireEvent.click(within(sheet).getByRole("link", { name: "Her" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the desktop sidebar is unchanged (no My Wish List row there); on a phone it is not drawn at the page's foot", () => {
    const { container } = renderAt("/gift-guides/kids");
    expect(container.querySelector("[data-gift-sidebar] [data-gift-side-wish-list]")).toBeNull();
    expect(GIFT_GUIDES_CSS).toMatch(/@media \(max-width:767px\)\{[^@]*\.gg-side\{display:none\}/);
  });
});
