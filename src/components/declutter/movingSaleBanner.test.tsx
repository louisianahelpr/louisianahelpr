/**
 * Board 164, the buyer's view of a moving sale (the banner on the seller's
 * profile): the area and move-out line, each item's price in rust over its
 * title, and "Share sale" sharing the profile where the sale lives. No
 * "Follow sale" (it does not exist), never an address.
 *
 * @mutate src/components/declutter/MovingSaleBanner.tsx | url: `${getPublicOrigin()}/user/${sellerId}` | url: getPublicOrigin()
 * @mutate src/components/declutter/MovingSaleBanner.tsx |   const area = areas.size === 1 ? [...areas][0] : null; |   const area = [...areas][0] ?? null;
 * @mutate src/components/declutter/MovingSaleBanner.tsx | <p className="text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(it.current_price_cents)}</p> | <p className="text-ds-15 font-bold tabular-nums">{formatPrice(it.current_price_cents)}</p>
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const shared: unknown[] = [];
const sale = { moveOutOn: "2026-11-01", more: false, items: [] as Record<string, unknown>[] };
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/lib/authRedirects", () => ({ getPublicOrigin: () => "https://louisianahelpr.com" }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: async (c: unknown) => { shared.push(c); return "shared"; } }));
vi.mock("@/lib/declutter/api", () => ({ fetchPhotos: async () => [], photoPublicUrl: (p: string) => p }));
vi.mock("@/lib/declutter/movingSale", () => ({
  fetchSellerMovingSale: async () => sale,
  louisianaToday: () => "2026-10-20",
  movingSaleLine: () => "Moving out Nov 1. 2 items for sale.",
}));

import { MovingSaleBanner } from "./MovingSaleBanner";

const item = (id: string, title: string, cents: number, area = "Delcambre") => ({ id, title, current_price_cents: cents, area_label: area, category: "furniture", status: "live" });

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MovingSaleBanner sellerId="s1" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  shared.length = 0;
  sale.items = [item("a", "Sofa, 3 seat", 12000), item("b", "Dining table", 9000)];
});

describe("board 164: the moving sale, as a buyer sees it", () => {
  it("area + move-out line, rust prices over titles, Share sale shares the profile, no Follow", async () => {
    renderIt();
    expect(await screen.findByText("Delcambre · Moving out Nov 1. 2 items for sale.")).toBeInTheDocument();
    const price = screen.getByText("$120");
    expect(price.className).toContain("--burnt-sienna");
    expect(price.nextElementSibling?.textContent).toBe("Sofa, 3 seat");
    expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share sale" }));
    await waitFor(() => expect(shared).toEqual([expect.objectContaining({ url: "https://louisianahelpr.com/user/s1" })]));
  });

  it("items in different areas: no area in the line", async () => {
    sale.items = [item("a", "Sofa", 12000, "Delcambre"), item("b", "Table", 9000, "Erath")];
    renderIt();
    expect(await screen.findByText("Moving out Nov 1. 2 items for sale.")).toBeInTheDocument();
  });
});
