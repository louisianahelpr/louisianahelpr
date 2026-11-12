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
 * @mutate src/lib/i18n/enListingParts.ts | Smaller copies, with location data removed, are sent to sort them and write your listings. | Location data is removed before anything is sent, and nothing goes up until you list.
 * @mutate src/lib/i18n/enListingParts.ts | "Add photos of everything. We'll group them and write each listing.", | "Add photos of everything you want to sell. We sort them into items and write each listing. You check them all, then list them together.",
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
import { useSavedPickup } from "./useSavedPickup";

/** As SellerSetupGate: the page mounts once the saved pickup reads have settled. */
function AfterSavedPickup({ children }: { children: React.ReactNode }) {
  return useSavedPickup("u1", () => {}).settled ? <>{children}</> : null;
}

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
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><AfterSavedPickup><BunchFlow /></AfterSavedPickup></MemoryRouter></QueryClientProvider>);
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
 * F342 (whole-app audit 11-10, /declutter/move layout shift; measured B3g 11-12: "Where buyers pick up" drew open,
 * then folded away and every step under it jumped up 246px). Lead 11-12: keep "type before the read answers" and keep
 * the step's place instead of hiding it. So: behind the setup gate (reads settled) the step never draws at all, not
 * even for the one frame before the saved pickup is applied; drawn open before the reads answer, it stays open,
 * filled in, and the photo step under it never moves.
 * @mutate src/components/declutter/bunchWhereFold.ts |   const address = (pickupAddress.trim() ? pickupAddress : saved.address).trim(); |   const address = pickupAddress.trim();
 * @mutate src/components/declutter/bunchWhereFold.ts |   return foldable && !drawnOpen.current; |   return foldable;
 */
describe("F342 bunchWhereNeverFolds: the Where step draws once and never folds away", () => {
  it("behind the gate, with a saved address, the address box is never put on the page, not for one frame", async () => {
    state.last = LAST;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The gate's own wait, then the page: the reads are settled when BunchFlow mounts, as in the app.
    const gate = render(<QueryClientProvider client={qc}><MemoryRouter><AfterSavedPickup><span data-gate-open="" /></AfterSavedPickup></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(document.querySelector("[data-gate-open]")).not.toBeNull());
    const container = document.body.appendChild(document.createElement("div"));
    const records: MutationRecord[] = [];
    const seen = new MutationObserver((rs) => { records.push(...rs); });
    seen.observe(container, { childList: true, subtree: true });
    render(<QueryClientProvider client={qc}><MemoryRouter><AfterSavedPickup><BunchFlow /></AfterSavedPickup></MemoryRouter></QueryClientProvider>, { container });
    await screen.findByRole("heading", { name: "1. Add photos" });
    await settle();
    records.push(...seen.takeRecords());
    seen.disconnect();
    // An added node is read as it is now, so a box drawn and then folded away shows up as a REMOVED node.
    const nodes = (pick: (r: MutationRecord) => NodeList) => records.flatMap((r) => [...pick(r)]).filter((n): n is Element => n instanceof Element);
    const holdsBox = (n: Element) => n.id === "bunch-address" || !!n.querySelector("#bunch-address");
    expect(nodes((r) => r.addedNodes).length).toBeGreaterThan(0);
    expect(nodes((r) => r.removedNodes).some(holdsBox)).toBe(false);
    expect(nodes((r) => r.addedNodes).some(holdsBox)).toBe(false);
    gate.unmount();
  });

  it("drawn open before the reads answer, it stays open, filled in, and the photo step keeps its number", async () => {
    let answer: () => void = () => {};
    state.gate = new Promise<void>((r) => { answer = r; });
    state.last = LAST;
    renderFlow();
    expect(box("Pickup address").value).toBe("");
    expect(screen.getByRole("heading", { name: "2. Add photos" })).toBeTruthy();
    answer();
    await waitFor(() => expect(box("Pickup address").value).toBe("1 Main St, Baton Rouge"));
    await settle();
    expect(screen.getByLabelText("Pickup address")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Add photos" })).toBeTruthy();
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
    // Audit 11-10 F339: the privacy line sits under the Add photos button; the intro is one short line.
    const note = document.querySelector("[data-bunch-privacy]")!;
    const add = screen.getByText("Add photos", { selector: "label" });
    expect(add.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Add photos of everything. We'll group them and write each listing.")).toBeTruthy();
  });
});
