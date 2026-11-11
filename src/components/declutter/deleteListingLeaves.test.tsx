/**
 * Audit 11-10 F335: after "Delete listing" the item page kept showing the full dead listing ("Your listing: Taken
 * down", Relist) and the toast said only "Listing deleted." The sheet now takes `onDeleted`: the item page passes a
 * jump to Selling, the toast names the listing and says where it is kept. Mark sold elsewhere never leaves the page.
 *
 * @mutate src/components/declutter/DeclutterManageListing.tsx |     () => { close(); if (view !== "sold") onDeleted?.(); }); |     close);
 * @mutate src/components/declutter/DeclutterManageListing.tsx |     () => { close(); if (view !== "sold") onDeleted?.(); }); |     () => { close(); onDeleted?.(); });
 * @mutate src/components/declutter/DeclutterManageListing.tsx |           onDeleted={onDeleted} |
 * @mutate src/components/declutter/DeclutterItemView.tsx | onDeleted={() => navigate("/declutter?tab=selling")} |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { blankComments } from "@/test/helpers/blankNonCode";

const calls: string[] = [];
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/lib/declutter/trades", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/trades")>()), fetchAcceptsTrades: async () => false }));
vi.mock("@/lib/declutter/api", () => ({
  fetchManageState: async () => ({ floor_price_cents: 3000, drops_stopped: false }),
  withdrawItem: async () => { calls.push("withdraw"); },
  markSoldElsewhere: async () => { calls.push("sold_elsewhere"); },
  fetchAutoFreeDays: async () => null,
  fetchItemDropState: async () => ({ sale_mode: "offers", last_price_drop_on: null, drop_pct: 5 }),
  fetchKeepUp: async () => false,
  fetchMyItemPrivate: async () => ({ floor_price_cents: 3000, pickup_address: "x", pickup_lat: 0, pickup_lng: 0, auto_offers: false }),
  fetchItemHandovers: async () => ["porch"],
  setListingPrice: async () => 0, setListingDrops: async () => 0, pauseListing: async () => "paused", relistListing: async () => "live",
  setAutoFreeDays: async () => 0, setKeepUp: async () => 0, setOfferRules: async () => {}, editListing: async () => "live",
}));
vi.mock("./SellPorchDays", () => ({ SellPorchDays: () => null }));

import { SellerListingPanel } from "./DeclutterManageListing";

const item = {
  id: "i1", seller_id: "me", status: "live", title: "Mid-century lamp", description: "", category: "home_decor",
  condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 3800, area_label: "Delcambre",
  area_lat: 29.9, area_lng: -91.9, created_at: "2026-10-18T00:00:00Z", porch_ok: true,
};

function show(onDeleted: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={qc}><SellerListingPanel item={item as never} coverUrl={null} onDeleted={onDeleted} /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Manage listing" }));
}

describe("F335: Delete listing leaves the item page and names what went", () => {
  it("Delete: the toast names the lamp and where it is kept, and the page's onDeleted runs once", async () => {
    const onDeleted = vi.fn();
    show(onDeleted);
    fireEvent.click(await screen.findByText("Delete listing"));
    fireEvent.click(screen.getByRole("button", { name: "Delete listing" }));
    await waitFor(() => expect(calls).toContain("withdraw"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith("Deleted. Mid-century lamp is gone from buyers; it's kept under Taken down in Selling.");
  });

  it("Mark sold elsewhere stays on the page", async () => {
    const onDeleted = vi.fn();
    show(onDeleted);
    fireEvent.click(await screen.findByText("Mark sold elsewhere"));
    fireEvent.click(screen.getByRole("button", { name: "Mark sold" }));
    await waitFor(() => expect(calls).toContain("sold_elsewhere"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Marked sold elsewhere/)));
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("the item page sends the seller to Selling after a delete", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterItemView.tsx"), "utf8"));
    expect(src).toContain('<SellerListingPanel item={it} coverUrl={urls[0] ?? null} onDeleted={() => navigate("/declutter?tab=selling")} />');
  });
});
