/**
 * Owner 2026-10-30: "Make them set up location, pick up info and that kind of stuff before listing so it's not asked
 * every time they post." A seller missing something sees only that, once, with the reason; a returning seller never
 * sees it; nothing is guessed: no pickup time is preselected, the area comes from the address, an address with no
 * point is asked again, and a saved place with no exact point sends the seller here.
 *
 * @mutate src/components/declutter/SellerSetup.tsx |   const [windows, setWindows] = useState<PickupWindow[]>([]); |   const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
 * Tester 5, 10-30: setup saved a town-only match as the exact point and called a lookup that was down "not found".
 * @mutate src/components/declutter/SellerSetup.tsx |         const found = await place.locate(address); |         const found = await place.locate(address, { allowApproximate: true });
 * @mutate src/components/declutter/SellerSetup.tsx |             <AddressNeedsExactSpot typedAddress={address} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} /> |
 * @mutate src/components/declutter/SellerSetup.tsx |         address_lookup_unavailable: declutterErrorMessage({ message: "address_lookup_unavailable" }), |         address_lookup_unavailable: "We couldn't find that address. Check the street, city and ZIP.",
 * @mutate src/components/declutter/SellerSetup.tsx |     pickup: !s.hasPickup, |     pickup: false,
 * @mutate src/components/declutter/SellerSetup.tsx |     ways: !s.free && !s.hasWays, |     ways: !s.hasWays,
 * @mutate src/pages/declutter/DeclutterSellPage.tsx |         <SellerSetupGate>\n          <Suspense fallback={<DeclutterSellSkeleton />}>\n            <BunchFlow moving={params.get("mode") === "moving"} />\n          </Suspense>\n        </SellerSetupGate> |         <BunchFlow moving={params.get("mode") === "moving"} />
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  places: [] as unknown[],
  savedPlaces: [] as Record<string, unknown>[],
  row: null as unknown,
  rows: [] as unknown[],
  last: null as unknown,
  windows: [] as unknown[],
  savedWindows: [] as unknown[],
  lookup: { status: "exact", lat: 30.45123, lng: -91.15456 } as unknown,
  here: { lat: 30.5001, lng: -92.1001 } as unknown,
}));

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/components/AppPage", () => ({ default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>) }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => state.lookup }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => state.here }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => state.last }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({
  ...(await orig<object>()),
  fetchMyPorchPlaces: async () => state.places,
  saveMyPorchPlace: async (p: Record<string, unknown>) => { state.savedPlaces.push(p); state.places = [{ ...p, id: "n", position: 1 }]; return "n"; },
}));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<object>()),
  fetchSellerDefaults: async () => state.row,
  saveSellerDefaults: async (_u: string, d: unknown) => { state.rows.push(d); state.row = d; return true; },
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyPickupWindows: async () => state.windows,
  setPickupWindows: async (w: { weekday: number; starts: string; ends: string }[]) => {
    state.savedWindows.push(w);
    state.windows = w.map((x) => ({ weekday: x.weekday, starts_local: `${x.starts}:00`, ends_local: `${x.ends}:00` }));
    return 1;
  },
}));

import { SellerSetupGate, setupNeeds } from "./SellerSetup";

const PLACE = { id: "p", position: 1, label: "Home", address: "1 Main St, Baton Rouge, LA", area: "Mid-City", lat: 30.45, lng: -91.15, weekdays: [6] };
const ROW = { keepUp: true, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
const WINDOW = { weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" };

function open(free = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SellerSetupGate free={free}><p>the posting form</p></SellerSetupGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.assign(state, { places: [], savedPlaces: [], row: null, rows: [], last: null, windows: [], savedWindows: [], lookup: { status: "exact", lat: 30.45123, lng: -91.15456 }, here: { lat: 30.5001, lng: -92.1001 } });
});
afterEach(cleanup);

describe("one-time setup before posting", () => {
  it("a returning seller never sees it", async () => {
    Object.assign(state, { places: [PLACE], row: ROW, windows: [WINDOW] });
    open();
    await screen.findByText("the posting form");
    expect(document.querySelector("[data-seller-setup]")).toBeNull();
  });

  it("a first-timer sets everything once, says why, and nothing is preselected; then the form opens", async () => {
    open();
    await screen.findByRole("heading", { name: "Set up selling" });
    expect(screen.getByText(/Buyers need to know where and when/)).toBeTruthy();
    expect(screen.queryByText("the posting form")).toBeNull();
    // Audit single-free #16: no day chosen for them, and no "Area buyers see" box.
    expect(screen.queryByLabelText("Area buyers see")).toBeNull();
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge, LA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Pick at least one day and time buyers can come.")).toBeTruthy();
    expect(state.savedPlaces).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText("the posting form");
    // The area comes from the address; the point is the lookup's own, exactly.
    expect(state.savedPlaces[0]).toMatchObject({ label: "Home", area: "Baton Rouge", address: "1 Main St, Baton Rouge, LA", lat: 30.45123, lng: -91.15456, weekdays: [6] });
    expect(state.rows).toHaveLength(1);
    expect(state.savedWindows).toHaveLength(1);
  });

  it("a town-only match is never saved as the exact point: the note offers their location, and that point is what's kept", async () => {
    Object.assign(state, { row: ROW, windows: [WINDOW], lookup: { status: "approximate", lat: 30.5, lng: -92.1, precision: "town" } });
    open();
    fireEvent.change(await screen.findByLabelText("Pickup address"), { target: { value: "101 Sample Bayou Rd, Exampleville, LA 70000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const share = await screen.findByRole("button", { name: "I'm at this address, use my location" });
    expect(state.savedPlaces).toHaveLength(0);
    expect(document.querySelector("[data-setup-problem]")).toBeNull();
    fireEvent.click(share);
    await screen.findByText("Got it. We'll use where you are now.");
    expect(screen.queryByRole("button", { name: /use my location/ })).toBeNull();
    expect(state.savedPlaces).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText("the posting form");
    expect(state.savedPlaces[0]).toMatchObject({ address: "101 Sample Bayou Rd, Exampleville, LA 70000", area: "Exampleville", lat: 30.5001, lng: -92.1001 });
  });

  it("a town-only match with times and settings still to save: nothing is written before the address is settled", async () => {
    state.lookup = { status: "approximate", lat: 30.5, lng: -92.1, precision: "town" };
    open();
    fireEvent.change(await screen.findByLabelText("Pickup address"), { target: { value: "101 Sample Bayou Rd, Exampleville, LA 70000" } });
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("button", { name: /use my location/ });
    expect(state.rows).toHaveLength(0);
    expect(state.savedWindows).toHaveLength(0);
  });

  it("the lookup being down is said apart from not found, and nothing is saved", async () => {
    Object.assign(state, { row: ROW, windows: [WINDOW], lookup: { status: "unavailable" } });
    open();
    fireEvent.change(await screen.findByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge, LA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const said = (await screen.findByRole("alert")).textContent ?? "";
    expect(said).toMatch(/can't look up addresses just now/);
    expect(said).not.toMatch(/couldn't find/);
    expect(state.savedPlaces).toHaveLength(0);
  });

  it("an address with no match is asked again and nothing about it is saved; no city in it says so, with no box to fill", async () => {
    Object.assign(state, { row: ROW, windows: [WINDOW], lookup: { status: "not_found" } });
    open();
    fireEvent.change(await screen.findByLabelText("Pickup address"), { target: { value: "nowhere at all" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't find that address/);
    expect(state.savedPlaces).toHaveLength(0);
    state.lookup = { status: "exact", lat: 30.1, lng: -91.1 };
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText(/couldn't tell the city/);
    expect(screen.queryByLabelText("Area buyers see")).toBeNull();
    expect(state.savedPlaces).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge, LA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText("the posting form");
    expect(state.savedPlaces[0]).toMatchObject({ area: "Baton Rouge", lat: 30.1 });
  });

  it("settings saved but the address has no exact point: only the address is asked (the lead's exact-point rule)", async () => {
    Object.assign(state, { row: ROW, windows: [WINDOW], last: { itemId: "i", ways: ["porch"], areaLabel: "Mid-City", pickup: { address: "1 Main St", lat: Number.NaN, lng: Number.NaN }, dropPct: null } });
    open();
    await screen.findByLabelText("Pickup address");
    expect(document.querySelector("[data-setup-times]")).toBeNull();
    expect(document.querySelector("[data-setup-ways]")).toBeNull();
    expect(document.querySelector("[data-setup-choices]")).toBeNull();
  });

  it("Give it away asks only what a giveaway needs", () => {
    expect(setupNeeds({ hasPickup: false, hasWays: false, hasWindows: false, hasSettings: false, free: true })).toEqual({ pickup: true, times: true, ways: false, choices: false });
    expect(setupNeeds({ hasPickup: true, hasWays: true, hasWindows: true, hasSettings: false, free: false })).toEqual({ pickup: false, times: false, ways: false, choices: true });
  });

  it("every posting flow is behind the gate; a saved draft is not", () => {
    const sell = readFileSync(join(process.cwd(), "src/pages/declutter/DeclutterSellPage.tsx"), "utf8");
    expect((sell.match(/<SellerSetupGate/g) ?? []).length).toBe(2);
    expect(sell).toMatch(/params\.get\("item"\) \? \(\s*<SellFlow \/>/);
    // The moving sale is the bunch flow, behind the same gate; /declutter/move only redirects to it.
    expect(sell).toMatch(/<SellerSetupGate>\s*<Suspense[\s\S]{0,60}?<BunchFlow moving=/);
  });
});
