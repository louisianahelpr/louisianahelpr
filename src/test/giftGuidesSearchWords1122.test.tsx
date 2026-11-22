/**
 * GUARD (Guides polish audit 1122 #21): the search and sort controls read plainly.
 *  - The empty-result line is "No gifts match that. Try another word." and the box says "Search gifts".
 *  - An item result with a photo shows it as a small contained thumbnail (.gg-search-thumb-item), not cropped.
 *  - Once the sort is anything but Recommended the sort button names the order and carries a dot, so a shopper can
 *    see the list is not in its usual order.
 *
 * @mutate src/content/giftGuides.ts | No gifts match that. Try another word. | Nothing found.
 * @mutate src/content/giftGuides.ts | searchPlaceholder: "Search gifts" | searchPlaceholder: "Search"
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | {order !== "top" && <span className="gg-icon-dot" | {false && <span className="gg-icon-dot"
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | {image && <img className="gg-search-thumb gg-search-thumb-item" | {false && <img className="gg-search-thumb gg-search-thumb-item"
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-search-thumb-item{object-fit:contain} | .gg-search-thumb-item{object-fit:cover}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ITEMS from "@/content/giftGuideSearchIndex.json";
import { loadAllGuidePicks, type SearchItem } from "@/content/giftGuideCatalog";
import { giftGuides as G } from "@/content/giftGuides";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
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

describe("guides polish 1122 #21: search and sort", () => {
  it("says what it searches and what it did not find", () => {
    expect(G.searchNone).toBe("No gifts match that. Try another word.");
    const { container } = renderAt("/gift-guides");
    fireEvent.click(container.querySelector("[data-gift-search-button]")!);
    const input = container.querySelector<HTMLInputElement>("[data-gift-search]")!;
    expect(input.getAttribute("placeholder")).toBe("Search gifts");
    fireEvent.change(input, { target: { value: "xyzzyq" } });
    expect(container.querySelector("[data-gift-search-results]")!.textContent).toContain("No gifts match that. Try another word.");
  });

  it("an item result shows its photo as a contained thumbnail", async () => {
    const items = ITEMS as unknown as SearchItem[];
    const withImage = items.find((r) => typeof r[4] === "string" && r[4]);
    expect(withImage, "the index carries at least one photo").toBeDefined();
    const word = withImage![0].split(/\s+/).sort((a, b) => b.length - a.length)[0];
    const { container } = renderAt("/gift-guides");
    fireEvent.click(container.querySelector("[data-gift-search-button]")!);
    fireEvent.change(container.querySelector<HTMLInputElement>("[data-gift-search]")!, { target: { value: word } });
    await screen.findAllByText((_, el) => el?.hasAttribute("data-gift-found-item") ?? false);
    expect(container.querySelector("a[data-gift-found-item] img.gg-search-thumb-item")).not.toBeNull();
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-search-thumb-item\{object-fit:contain\}/);
  });

  it("a non-default sort is named on the button and marked with a dot", () => {
    const { container } = renderAt("/gift-guides/her");
    const btn = () => container.querySelector("[data-gift-sort-button]")!;
    expect(btn().getAttribute("aria-label")).toBe(G.sortLabel);
    expect(btn().querySelector("[data-gift-sort-on]")).toBeNull();
    fireEvent.click(btn());
    fireEvent.click(within(screen.getByRole("menu", { name: G.sortLabel })).getByText(G.sortHighLow));
    expect(btn().getAttribute("aria-label")).toBe(G.sortLabelActive(G.sortHighLow));
    expect(btn().querySelector("[data-gift-sort-on]")).not.toBeNull();
  });
});
