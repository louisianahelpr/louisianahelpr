/**
 * "Sell a bunch" starts from what the seller already told us (audit findings 12 and 13, 2026-10-30):
 *   - the area and the pickup address come from their last listing, in boxes still blank, with its saved point so
 *     nothing is looked up again; what the seller already typed stays theirs;
 *   - the photo step says plainly that smaller copies are sent to sort them, instead of "nothing goes up".
 *
 * @mutate src/components/declutter/useBunchStartingPlace.ts |     setAreaLabel((a) => (a.trim() ? a : s.areaLabel)); |     void s.areaLabel;
 * @mutate src/components/declutter/useBunchStartingPlace.ts |     setPickupAddress((a) => (a.trim() ? a : s.pickup!.address)); |     void s.pickup.address;
 * @mutate src/components/declutter/useBunchStartingPlace.ts |     setPickupAddress((a) => (a.trim() ? a : s.pickup!.address)); |     setPickupAddress(s.pickup!.address);
 * @mutate src/components/declutter/useBunchStartingPlace.ts |     setPoint((c) => c ?? { ...s.pickup! }); |     void place;
 * @mutate src/components/declutter/DeclutterBunchView.tsx | Smaller copies, with location data removed, are sent to sort them and write your listings. | Location data is removed before anything is sent, and nothing goes up until you list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LastSetup } from "@/lib/declutter/lastSetup";

const state = vi.hoisted(() => ({ last: null as LastSetup | null, gate: null as Promise<void> | null, geocodes: [] as string[], places: [] as unknown[] }));

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("@/lib/addressLookup", () => ({
  lookUpAddress: async (a: string) => { state.geocodes.push(a); return { status: "exact", lat: 1, lng: 2 }; },
}));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => state.places }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => { await state.gate; return state.last; } }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/components/declutter/BunchFeeGate", () => ({ BunchFeeGate: () => null, useSetupFeeDueCents: () => null }));
vi.mock("@/components/declutter/BunchDraftsSection", () => ({ BunchDraftsSection: () => null }));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<object>()), fetchMyPickupWindows: async () => [] }));

import BunchFlow from "./DeclutterBunchView";

const LAST: LastSetup = {
  itemId: "i0", ways: ["porch"], areaLabel: "Mid-City", dropPct: null,
  pickup: { address: "1 Main St, Baton Rouge", lat: 30.4, lng: -91.1 },
};

function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
}
const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { state.last = null; state.gate = null; state.geocodes = []; });
afterEach(cleanup);

describe("Sell a bunch: where buyers pick up starts from the last listing", () => {
  it("a saved address asks nothing, with its saved point: nothing is looked up, and the steps start at the photos", async () => {
    state.last = LAST;
    renderFlow();
    await screen.findByRole("heading", { name: "1. Add photos" });
    expect(screen.queryByLabelText("Pickup address")).toBeNull();
    expect(screen.queryByLabelText("Area buyers see")).toBeNull();
    await settle();
    expect(state.geocodes).toEqual([]);
  });

  it("what the seller already typed stays theirs", async () => {
    let open: () => void = () => {};
    state.gate = new Promise<void>((r) => { open = r; });
    state.last = LAST;
    renderFlow();
    fireEvent.change(box("Pickup address"), { target: { value: "9 Oak Ave, Lafayette" } });
    open();
    await settle();
    expect(box("Pickup address").value).toBe("9 Oak Ave, Lafayette");
    // The saved point is the old address's, so the one typed is the one looked up.
    fireEvent.blur(box("Pickup address"));
    await waitFor(() => expect(state.geocodes).toEqual(["9 Oak Ave, Lafayette"]));
  });

  it("no last listing: both boxes start blank", async () => {
    renderFlow();
    await settle();
    expect(box("Pickup address").value).toBe("");
  });
});

/**
 * Q2492: Sell a bunch (and moving out, which is Sell a bunch) says which address wins once a seller has saved places.
 * @mutate src/components/declutter/DeclutterBunchView.tsx |         <PlacesComeFirstLine />\n |
 */
describe("Sell a bunch: which address wins", () => {
  it("saved places: says a buyer choosing porch or Helpr delivery gets that address", async () => {
    state.last = null;
    state.places = [{ id: "p1", label: "Home", address: "12 Oak St, Baton Rouge", area: "Mid City", lat: 30.4, lng: -91.1, weekdays: [6] }];
    renderFlow();
    expect((await waitFor(() => { const n = document.querySelector("[data-saved-places-first]"); if (!n) throw new Error("not yet"); return n; })).textContent)
      .toContain("not the one below");
    state.places = [];
  });
  it("no saved places: no line", async () => {
    state.last = null;
    state.places = [];
    renderFlow();
    await screen.findByLabelText("Pickup address");
    await settle();
    expect(document.querySelector("[data-saved-places-first]")).toBeNull();
  });
});

describe("Sell a bunch: the photo step says what is sent", () => {
  it("says copies are sent; never says nothing goes up", () => {
    renderFlow();
    const words = document.querySelector('[aria-labelledby="bunch-photos"]')!.textContent!;
    expect(words).toContain("Smaller copies, with location data removed, are sent to sort them and write your listings.");
    expect(words).toContain("Nothing is saved or shown to buyers until you list.");
    expect(words).not.toMatch(/nothing goes up/i);
  });
});
