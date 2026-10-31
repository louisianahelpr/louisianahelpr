/**
 * LEAD-DELIVER-OFF-ALL (owner 2026-10-31): unticking "I'll deliver" in Declutter settings also stops delivery on the
 * seller's listings already up (declutter_stop_my_seller_delivery, 20261031180550; PGlite proof
 * src/test/pglite/declutterDeliverOffStopsLiveListings.pglite.mjs). The card says so before Save, with "orders already
 * placed are kept". Ticking it again only saves the default for new listings (no call).
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       return { done, stopped: done && deliverOff ? await stopMySellerDelivery() : null }; |       return { done, stopped: null };
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |         {deliverOff && <p role="note" | {false && <p role="note"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import type { SellerDefaults } from "@/lib/declutter/sellerDefaults";

const h = vi.hoisted(() => ({ saved: null as unknown, stops: 0, defaults: null as unknown, toasts: [] as string[] }));
vi.mock("sonner", () => ({ toast: Object.assign((m: string) => { h.toasts.push(m); }, { success: vi.fn(), error: (m: string) => { h.toasts.push(`error:${m}`); } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<object>()),
  fetchSellerDefaults: async () => h.defaults,
  saveSellerDefaults: async (_u: string, d: unknown) => { h.saved = d; return true; },
}));
// The delivery price and times under a ticked "I'll deliver" (LEAD-DELIVER-TWICE) have their own tests.
vi.mock("./SellerDeliverySettings", async (orig) => ({ ...(await orig<object>()), SellerDeliveryDetails: () => null }));
vi.mock("@/lib/declutter/stopSellerDelivery", () => ({ stopMySellerDelivery: async () => { h.stops += 1; return 2; } }));

import { ListingDefaultsCard } from "./DeclutterListingDefaults";

const BASE: SellerDefaults = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch", "seller_delivery"] };
const NOTE = "Off. Your listings stop offering delivery; orders already placed are kept.";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ListingDefaultsCard userId="u1" /></QueryClientProvider>);
}
const tile = () => screen.getByRole("checkbox", { name: /I'll deliver/ });

describe("LEAD-DELIVER-OFF-ALL: I'll deliver off stops it on live listings", () => {
  beforeEach(() => { h.saved = null; h.stops = 0; h.toasts = []; });

  it("unticked: the card says so, and Save stops it on the live listings", async () => {
    h.defaults = BASE;
    show();
    await waitFor(() => expect(tile()).toBeChecked());
    expect(screen.queryByText(NOTE)).toBeNull();
    fireEvent.click(tile());
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.stops).toBe(1));
    expect((h.saved as SellerDefaults).handovers).toEqual(["porch"]);
    expect(h.toasts).toEqual(["Listing defaults saved. 2 listings no longer offer your delivery."]);
  });

  it("ticked again: only the default for new listings is saved", async () => {
    h.defaults = { ...BASE, handovers: ["porch"] };
    show();
    await waitFor(() => expect(tile()).not.toBeChecked());
    fireEvent.click(tile());
    expect(screen.queryByText(NOTE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.saved).not.toBeNull());
    expect(h.stops).toBe(0);
    expect(h.toasts).toEqual(["Listing defaults saved."]);
  });

  it("the card still holds the call (inventory floor)", () => {
    const src = readFileSync("src/components/declutter/DeclutterListingDefaults.tsx", "utf8");
    expect(src.split("stopMySellerDelivery()").length - 1).toBeGreaterThan(0);
  });
});
