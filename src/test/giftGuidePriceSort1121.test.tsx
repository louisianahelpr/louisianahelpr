/**
 * Her, Him and Kids sort by price (owner 2026-11-21: "the guides should be able to be sorted by price"). Each pick in
 * the three chunks carries `priceRank`, its place in the cheapest-first order (scripts/giftGuidePriceRank1121.mjs); a
 * pick with no usable price gets null and stays last in both orders (src/content/giftGuidePriceSort.ts). The page shows
 * "Price: low to high" (the imported order, the default) and "Price: high to low" above the list, on the three guides
 * and on their relationship views (/gift-guides/mom). The rank is a position, never a price: an Amazon row still shows
 * no price in either order (Associates rule).
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const picks = sortable ? sortByPrice(inBudget, order) : inBudget; | const picks = inBudget;
 * @mutate src/content/giftGuidePriceSort.ts | return [...known, ...unknown]; | return [...unknown, ...known];
 * @mutate scripts/giftGuidePriceRank1121.mjs | priceRank: known ? ++rank : null | priceRank: ++rank
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | <PickPrice pick={pick} /></small> | <PickPrice pick={pick} />{pick.priceRank}</small>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { giftGuides as G } from "@/content/giftGuides";
import { sortByPrice } from "@/content/giftGuidePriceSort";
import { rankByPrice } from "../../scripts/giftGuidePriceRank1121.mjs";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Row = { name: string; href: string; store?: string; price?: number; priceRank?: number | null; rels?: string[] };
const CHUNKS: Record<string, Row[]> = { her: her.picks as Row[], him: him.picks as Row[], kids: kids.picks as Row[] };
const isAmazon = (href: string) => /(^|\.)amazon\.com$/.test(new URL(href).hostname);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );
/** The names of the rows on screen, top to bottom. */
const shownNames = (c: HTMLElement) => [...c.querySelectorAll("[data-gift-pick] .gg-nm-name")].map((n) => n.textContent);

describe("the price sort key in the three chunks (owner 11-21)", () => {
  it("every pick has an integer priceRank, 1..n in the list's cheapest-first order", () => {
    for (const [slug, rows] of Object.entries(CHUNKS)) {
      expect(rows.length, slug).toBeGreaterThan(30); // her 36, him 39, kids 40 measured 2026-11-21
      expect(rows.map((r) => r.priceRank), slug).toEqual(rows.map((_, i) => i + 1));
    }
  });

  it("the import puts an unknown price after every known one, with no rank, and orders the rest cheapest first", () => {
    const out = rankByPrice([
      { name: "b", sortPrice: 20 }, { name: "x" }, { name: "a", sortPrice: 5 }, { name: "y", sortPrice: Number.NaN }, { name: "c", sortPrice: 20 }, { name: "z", sortPrice: 0 },
    ]);
    expect(out.map((o) => o.row.name)).toEqual(["a", "b", "c", "x", "y", "z"]);
    expect(out.map((o) => o.priceRank)).toEqual([1, 2, 3, null, null, null]);
  });

  it("the page sort keeps unknown prices last in both orders", () => {
    const rows = [{ n: "u1", priceRank: null }, { n: "r2", priceRank: 2 }, { n: "u2" }, { n: "r1", priceRank: 1 }, { n: "r3", priceRank: 3 }];
    expect(sortByPrice(rows, "low").map((r) => r.n)).toEqual(["r1", "r2", "r3", "u1", "u2"]);
    expect(sortByPrice(rows, "high").map((r) => r.n)).toEqual(["r3", "r2", "r1", "u1", "u2"]);
    expect(rows.map((r) => r.n)).toEqual(["u1", "r2", "u2", "r1", "r3"]); // input untouched
  });
});

describe("the sort control on the page (owner 11-21)", () => {
  it.each(["her", "him", "kids", "mom", "dad"])("/gift-guides/%s opens low to high and flips to high to low", async (slug) => {
    await act(async () => { await loadGuidePicks(slug); });
    const { container } = renderAt(`/gift-guides/${slug}`);
    const group = screen.getByRole("radiogroup", { name: G.sortLabel });
    const low = within(group).getByRole("radio", { name: G.sortLowHigh });
    const high = within(group).getByRole("radio", { name: G.sortHighLow });
    expect(low.getAttribute("aria-checked")).toBe("true");
    const base = slug === "mom" ? "her" : slug === "dad" ? "him" : slug;
    const expected = CHUNKS[base].filter((r) => base === slug || r.rels?.includes(slug)).map((r) => r.name);
    expect(expected.length, slug).toBeGreaterThan(5);
    expect(shownNames(container)).toEqual(expected);
    fireEvent.click(high);
    expect(high.getAttribute("aria-checked")).toBe("true");
    expect(shownNames(container)).toEqual([...expected].reverse());
    fireEvent.click(low);
    expect(shownNames(container)).toEqual(expected);
  });

  it("no Amazon row shows a price in either order, while the checked non-Amazon prices still show", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    await act(async () => { await loadGuidePicks("her"); });
    const { container } = renderAt("/gift-guides/her");
    for (const name of [G.sortLowHigh, G.sortHighLow]) {
      fireEvent.click(screen.getByRole("radio", { name }));
      const rows = [...container.querySelectorAll<HTMLElement>("[data-gift-pick]")];
      expect(rows.length).toBe(CHUNKS.her.length);
      let amazon = 0;
      let priced = 0;
      for (const li of rows) {
        const href = li.querySelector<HTMLAnchorElement>("a[data-gift-out]")!.href;
        const meta = li.querySelector(".gg-nm-meta")!.textContent ?? "";
        if (isAmazon(href)) {
          amazon += 1;
          expect(li.querySelector("[data-gift-price]"), href).toBeNull();
          expect(meta, href).toBe(G.onStore("Amazon"));
          expect(li.textContent, href).not.toMatch(/\$/);
        } else if (li.querySelector("[data-gift-price]")) priced += 1;
      }
      expect(amazon).toBeGreaterThan(15); // 22 Amazon rows on Her, 2026-11-21
      expect(priced).toBeGreaterThan(10); // 14 checked ShopMy prices on Her, 2026-11-21
    }
  });
});
