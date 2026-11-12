/**
 * S009 (Shops audit 11-12): a seller adds and removes photos on a LIVE item. The editor shows the photo section for a
 * draft or a live item (never one waiting for an admin), re-runs the photo check on the live item after each change
 * (a flag says the item is off the shop), and a live item cannot drop under 3 photos. Server side:
 * 20261112204756_shops_live_item_photos.sql, proven by src/test/pglite/shopsLiveItemPhotos.pglite.mjs.
 *
 * @mutate src/components/shops/ShopItemEditor.tsx |   const photosEditable = draft \|\| status === "live"; |   const photosEditable = draft;
 * @mutate src/components/shops/ShopItemEditor.tsx |     if (status !== "live" \|\| !id) return; |     return;
 * @mutate src/components/shops/ShopItemPhotosSection.tsx |                 disabled={busy \|\| (!draft && photos.length <= 3)} |                 disabled={busy}
 */
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopItem } from "@/lib/shops/items";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({
  fetchCottageStatus: vi.fn(),
  fetchMyItemReview: vi.fn(),
  removeShopItemPhoto: vi.fn(),
  addShopItemPhoto: vi.fn(),
  requestShopItemAiCheck: vi.fn(),
}));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...api, itemPhotoUrl: (p: string) => `https://cdn/${p}` }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), fetchItemOptions: vi.fn(async () => new Map()) }));

import ShopItemEditor from "./ShopItemEditor";

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, storage_path: `u1/shop-items/it1/p${i}.jpg`, position: i }));
const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  id: "it1", kind: "made", subtype: "candles", status: "live", title: "Fig candle", description: "Soy wax.",
  price_cents: 1800, lead_time_days: 2, stock_count: null, home_kitchen: false, photos: photos(4), ...over,
} as ShopItem);
function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  api.fetchCottageStatus.mockResolvedValue(null);
  api.fetchMyItemReview.mockResolvedValue(null);
});

describe("S009: photos on a live item", () => {
  it("a live item shows its photos with Add and Remove, and no suggestions", () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item()} onCreated={() => {}} onDone={() => {}} />);
    expect(screen.getByText("Photos (3 to 12)")).toBeTruthy();
    expect(screen.getByText("Add a photo", { selector: "span[aria-hidden]" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })).toHaveLength(4);
    // S2-012: each Remove names its photo, so a screen reader does not hear "Remove, Remove, Remove".
    expect(screen.getByRole("button", { name: "Remove photo 4" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suggest details from my photos" })).toBeNull();
    expect(screen.getByText(/New photos get our quick photo check/)).toBeTruthy();
  });

  it("removing a photo re-runs the check on the live item; a flag says it is off the shop", async () => {
    api.removeShopItemPhoto.mockResolvedValue(undefined);
    api.requestShopItemAiCheck.mockResolvedValue({ checked: true, flagged: true });
    renderWith(<ShopItemEditor ownerId="u1" item={item()} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })[0]);
    await waitFor(() => expect(api.requestShopItemAiCheck).toHaveBeenCalledWith("it1"));
    expect(api.removeShopItemPhoto).toHaveBeenCalledWith("p0");
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Our checks flagged a photo. The item is off your shop until our team looks at it."));
  });

  it("a check that does not answer leaves it quiet (the item stays live)", async () => {
    api.removeShopItemPhoto.mockResolvedValue(undefined);
    api.requestShopItemAiCheck.mockRejectedValue(new Error("ai_unavailable"));
    renderWith(<ShopItemEditor ownerId="u1" item={item()} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })[0]);
    await waitFor(() => expect(api.requestShopItemAiCheck).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a live item with 3 photos cannot drop one", () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ photos: photos(3) } as Partial<ShopItem>)} onCreated={() => {}} onDone={() => {}} />);
    for (const b of screen.getAllByRole("button", { name: /^Remove photo \d+$/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("an item waiting for an admin shows no photo section", () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "pending_review" })} onCreated={() => {}} onDone={() => {}} />);
    expect(screen.queryByText("Photos (3 to 12)")).toBeNull();
  });

  it("a draft's photo change runs no check (Publish does)", async () => {
    api.removeShopItemPhoto.mockResolvedValue(undefined);
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft", photos: photos(2) } as Partial<ShopItem>)} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })[0]);
    await waitFor(() => expect(api.removeShopItemPhoto).toHaveBeenCalled());
    expect(api.requestShopItemAiCheck).not.toHaveBeenCalled();
  });
});
