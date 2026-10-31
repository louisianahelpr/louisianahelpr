/**
 * Audit BUY-33: an item in a moving sale said nothing about it on its page, and the profile listed the sale's items
 * twice (the sale, then "Selling now").
 *
 * @mutate src/components/declutter/DeclutterMovingSaleNote.tsx |   if (!on \|\| !inSale.data) return null; |   if (!on) return null;
 * @mutate src/components/declutter/DeclutterMovingSaleNote.tsx | queryFn: () => fetchItemInMovingSale(itemId), enabled: on }); | queryFn: () => fetchItemInMovingSale(itemId) });
 * @mutate src/components/declutter/DeclutterItemView.tsx |           {!isSeller && user && <DeclutterMovingSaleNote itemId={it.id} sellerId={it.seller_id} />}\n |
 * @mutate src/components/declutter/SellingNowRow.tsx |   const rest = (items.data ?? []).filter((i) => !inSale.has(i.id)); |   const rest = items.data ?? [];
 * @mutate src/components/declutter/SellingNowRow.tsx | queryFn: () => fetchSellerMovingSale(sellerId), enabled: on && moving }); | queryFn: () => fetchSellerMovingSale(sellerId), enabled: false });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({
  features: ["declutter", "declutter_moving_out"] as string[],
  inSale: true,
  noteReads: 0,
  saleItems: [] as { id: string }[],
  sellerItems: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => state.features.includes(k) }));
vi.mock("@/lib/declutter/movingSale", () => ({
  fetchItemInMovingSale: async () => { state.noteReads++; return state.inSale; },
  fetchSellerMovingSale: async () => (state.saleItems.length ? { items: state.saleItems } : null),
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchSellerItems: async () => state.sellerItems,
  fetchPhotos: async () => [],
}));

import { DeclutterMovingSaleNote } from "./DeclutterMovingSaleNote";
import { SellingNowRow } from "./SellingNowRow";

function wrap(el: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}>{el}</QueryClientProvider></MemoryRouter>);
}
const item = (id: string) => ({ id, title: `Item ${id}`, category: "furniture", current_price_cents: 1000 });

beforeEach(() => {
  state.features = ["declutter", "declutter_moving_out"];
  state.inSale = true;
  state.noteReads = 0;
  state.saleItems = [];
  state.sellerItems = [];
});

describe("BUY-33: the item page says it's in a moving sale", () => {
  it("in a sale: says so, and links to the seller's profile, where the sale is", async () => {
    wrap(<DeclutterMovingSaleNote itemId="i1" sellerId="s1" />);
    expect(await screen.findByText("Part of a moving sale.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the whole sale" })).toHaveAttribute("href", "/user/s1");
  });

  it("not in a sale: nothing", async () => {
    state.inSale = false;
    const { container } = wrap(<DeclutterMovingSaleNote itemId="i1" sellerId="s1" />);
    await waitFor(() => expect(state.noteReads).toBe(1));
    expect(container.querySelector("[data-item-moving-sale]")).toBeNull();
  });

  it("moving sales off: no read and nothing", async () => {
    state.features = ["declutter"];
    const { container } = wrap(<DeclutterMovingSaleNote itemId="i1" sellerId="s1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.noteReads).toBe(0);
    expect(container.querySelector("[data-item-moving-sale]")).toBeNull();
  });

  it("the page mounts it for signed-in buyers only: guests have no grant on the column", () => {
    const src = readFileSync(resolve(__dirname, "DeclutterItemView.tsx"), "utf8");
    expect(src).toContain("{!isSeller && user && <DeclutterMovingSaleNote ");
  });
});

describe("BUY-33: Selling now doesn't repeat the sale", () => {
  it("lists only what isn't in the sale, and counts only that", async () => {
    state.sellerItems = [item("a"), item("b"), item("c")];
    state.saleItems = [{ id: "a" }, { id: "b" }];
    wrap(<SellingNowRow sellerId="s1" />);
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Selling now · 1"));
    expect(screen.getByText("Item c")).toBeInTheDocument();
    expect(screen.queryByText("Item a")).toBeNull();
  });

  it("everything is in the sale: no second section", async () => {
    state.sellerItems = [item("a")];
    state.saleItems = [{ id: "a" }];
    const { container } = wrap(<SellingNowRow sellerId="s1" />);
    await waitFor(() => expect(screen.queryByRole("heading")).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-testid=selling-now]")).toBeNull();
  });

  it("no sale: everything shows", async () => {
    state.sellerItems = [item("a"), item("b")];
    wrap(<SellingNowRow sellerId="s1" />);
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Selling now · 2"));
  });
});
