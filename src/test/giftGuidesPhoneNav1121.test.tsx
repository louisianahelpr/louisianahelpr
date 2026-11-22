/**
 * The gift guides on a phone (owner 2026-11-21, two iPhone screenshots: the whole grouped menu sat at the very bottom
 * of the page under the affiliate text; "We need a way to organize this on the phones"). Up to 767px the sidebar is not
 * drawn; a sticky chip row right under the header holds Her, Him, Kids (cover dots, the open one filled), Deals,
 * Printables, Make it fun, Louisiana and Menu; Menu (and Make it fun / Louisiana, at their group) opens the shared bottom
 * Sheet with the same grouped menu as the desktop sidebar. The chip row scrolls sideways by itself.
 *
 * @mutate src/pages/info/GiftGuides.tsx |         <GiftGuidesPhoneNav active={guide} myList={myList \|\| shared} page={sidePage} /> |         {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneSheet.tsx | <GiftGuidesMenu active={active} myList={myList} page={page} idPrefix={idPrefix} /> | {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneNav.tsx | onClick={() => setSheet("la")} | onClick={() => setSheet(null)}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-pnav-row{display:flex;gap:8px;list-style:none;margin:0;padding:0 20px;overflow-x:auto; | .gg-pnav-row{display:flex;gap:8px;list-style:none;margin:0;padding:0 20px;
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneNav.tsx | className={chip(open === g.slug)} | className={chip(false)}
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
const chips = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-gift-phone-nav] [data-gift-chip]")];

describe("the phone's gift guides navigation (owner 11-21)", () => {
  it("a chip row right under the header: Her, Him, Kids, Deals, Printables, Make it fun, Louisiana, Menu", () => {
    const { container } = renderAt("/gift-guides/him");
    const nav = container.querySelector("[data-gift-phone-nav]")!;
    expect(nav).not.toBeNull();
    expect(nav.getAttribute("aria-label")).toBe("Gift guides menu");
    // Right after the header row, before the banner and the page.
    expect(container.querySelector("[data-gift-headrow]")!.nextElementSibling).toBe(nav);
    expect(chips(container).map((c) => c.textContent)).toEqual(["Her", "Him", "Kids", "Deals", "Printables", "Make it fun", "Louisiana", "Menu"]);
    expect(chips(container).slice(0, 3).map((c) => c.querySelector(".gg-dot")?.className)).toEqual(["gg-dot gg-oat", "gg-dot gg-green", "gg-dot gg-red"]);
    // The open guide's chip is filled (and current); a relationship view fills its guide's chip.
    const on = (c: HTMLElement) => chips(c).filter((x) => x.classList.contains("is-on")).map((x) => x.getAttribute("data-gift-chip"));
    expect(on(container)).toEqual(["him"]);
    expect(container.querySelector('[data-gift-chip="him"]')?.getAttribute("aria-current")).toBe("page");
    cleanup();
    expect(on(renderAt("/gift-guides/mom").container)).toEqual(["her"]);
    cleanup();
    expect(on(renderAt("/gift-guides").container)).toEqual([]);
  });

  it("Menu opens the shared bottom Sheet with the whole grouped menu; Louisiana opens it at its group; a link closes it", async () => {
    // jsdom applies the chip row's base display:none (it reads no @media), so the chips are pressed by their data hooks.
    const { container } = renderAt("/gift-guides/kids");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(container.querySelector('[data-gift-chip="menu"]')!); });
    // The sheet is its own chunk, loaded on the first tap (off the page's critical path).
    const sheet = await screen.findByRole("dialog");
    expect(sheet.hasAttribute("data-gift-menu-sheet")).toBe(true);
    expect([...sheet.querySelectorAll(".gg-side-h")].map((h) => h.textContent)).toEqual(["Guides", "Deals", "Free printables", "Make it fun", "Louisiana"]);
    // Its own heading ids (no clash with the desktop sidebar's), each list labelled by its heading.
    for (const ul of sheet.querySelectorAll("ul")) expect(sheet.querySelector(`#${ul.getAttribute("aria-labelledby")}`)?.id.startsWith("gg-sheet-")).toBe(true);
    expect(within(sheet).getByRole("link", { name: "Kids" }).getAttribute("aria-current")).toBe("page");
    await act(async () => { fireEvent.click(within(sheet).getByRole("link", { name: "Her" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(container.querySelector('[data-gift-chip="louisiana"]')!); });
    expect(screen.getByRole("dialog").querySelector("#gg-sheet-la")).not.toBeNull();
  });

  it("on a phone the sidebar is not drawn at the page's foot; the chip row is sticky and scrolls sideways by itself, 44px chips", () => {
    expect(GIFT_GUIDES_CSS).toMatch(/@media \(max-width:767px\)\{[^@]*\.gg-side\{display:none\}/);
    expect(GIFT_GUIDES_CSS).toContain(".gg-pnav{display:none}");
    const phone = /@media \(max-width:767px\)\{\n\.gg-pnav\{[^]*?\n\}/.exec(GIFT_GUIDES_CSS)?.[0] ?? "";
    expect(phone).toMatch(/\.gg-pnav\{display:block;position:sticky;/);
    expect(phone).toMatch(/\.gg-pnav-row\{[^}]*overflow-x:auto;overscroll-behavior-x:contain/);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-chip-nav\{[^}]*min-height:44px/);
  });
});
