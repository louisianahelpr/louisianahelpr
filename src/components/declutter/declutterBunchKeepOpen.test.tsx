/**
 * Sell a bunch audit finding 3: the page said "a few seconds each" while 50 items take over 8 minutes, a locked phone
 * failed the later steps, and an item whose upload failed left the list, so its photos were gone.
 *
 * @mutate src/components/declutter/DeclutterBunchView.tsx |   useScreenAwake(!!sorting \|\| !!listing \|\| listingDrafts); |   useScreenAwake(false);
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       const gone = new Set(out.filter((o) => "status" in o \|\| !o.stays).map((o) => o.key)); |       const gone = new Set(out.map((o) => o.key));
 * @mutate src/lib/declutter/bunch.ts |       out.set(it.key, { key: it.key, title: it.title, error, draftId: id, stays: true }); |       out.set(it.key, { key: it.key, title: it.title, error, draftId: id });
 * @mutate src/hooks/useScreenAwake.ts |       if (document.visibilityState === "visible") void take(); |       void 0;
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem, BunchOutcome, ListDeps } from "@/lib/declutter/bunch";

const h = vi.hoisted(() => ({
  request: vi.fn(),
  release: vi.fn(async () => {}),
  listResult: null as null | (() => Promise<BunchOutcome[]>),
}));

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, del: async () => {}, delMany: async () => {}, keys: async () => [], createStore: () => ({}) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { onboarding_fee_paid: true }, isAdmin: false, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.4, longitude: -91.1 }) }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => [],
  fetchMyPickupWindows: async () => [],
  fetchHasAgreedSales: async () => false,
  setPickupWindows: async () => 1,
}));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[]) => ({
      items: photos.map((p, i) => ({ key: `i${i}`, photoKeys: [p.key], title: `Thing ${i}`, description: "", category: "other", deliverySize: "large", conditionStars: 3, flagged: false, price: "40" } as BunchItem)),
      failed: [],
    }),
    listBunch: () => h.listResult!(),
  };
});

import BunchFlow from "./DeclutterBunchView";

async function reachListing() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
  fireEvent.change(document.getElementById("bunch-files")!, { target: { files: ["a", "b"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" })) } });
  await screen.findByRole("heading", { name: /^3\. Check each item/ });
  fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City" } });
  fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
  for (let i = 0; i < 4; i++) fireEvent.click(document.getElementById(`bunch-tax-${i}`)!);
  const list = await screen.findByRole("button", { name: "List 2 items" });
  await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
  return list;
}

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
beforeEach(() => {
  h.release.mockClear();
  h.request.mockReset();
  h.request.mockImplementation(async () => ({ release: h.release }));
  Object.defineProperty(navigator, "wakeLock", { value: { request: h.request }, configurable: true });
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
});

describe("a long run is honest and keeps going", () => {
  it("says how long it really takes, before it starts", async () => {
    await reachListing();
    const copy = screen.getByText(/Listing takes about 15 seconds each/).textContent ?? "";
    expect(copy).toContain("about 1 minute for these");
    expect(copy).toContain("Keep this page open and your phone unlocked");
    expect(document.body.textContent).not.toContain("a few seconds each");
  });

  it("keeps the screen on during the run, takes it again after the page was hidden, and lets go at the end", async () => {
    const list = await reachListing();
    h.request.mockClear();
    let finish!: (o: BunchOutcome[]) => void;
    h.listResult = () => new Promise((res) => { finish = res; });
    fireEvent.click(list);
    await waitFor(() => expect(h.request).toHaveBeenCalledWith("screen"));
    await waitFor(() => expect(finish).toBeTruthy());

    h.request.mockClear();
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));

    h.release.mockClear();
    await act(async () => { finish([]); });
    await waitFor(() => expect(h.release).toHaveBeenCalled());
  });

  it("a browser without it still lists", async () => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    const list = await reachListing();
    h.listResult = async () => [{ key: "i0", title: "Thing 0", status: "live" }, { key: "i1", title: "Thing 1", status: "live" }];
    fireEvent.click(list);
    expect((await screen.findByText(/2 for sale/)).textContent).toContain("2 for sale");
  });

  it("an item whose upload failed stays with its photos; one refused at publish is finished under Selling", async () => {
    const list = await reachListing();
    h.listResult = async () => [
      { key: "i0", title: "Thing 0", error: new Error("photo_not_uploaded"), draftId: "d0", stays: true },
      { key: "i1", title: "Thing 1", error: new Error("attestation_required"), draftId: "d1" },
    ];
    fireEvent.click(list);
    const failed = await screen.findByText(/Thing 0/, { selector: "[data-bunch-failed] span" });
    expect(failed.closest("li")?.textContent).toContain("still above, to fix and list again");
    expect(screen.getByText("Thing 1", { selector: "[data-bunch-failed] span" }).closest("li")?.textContent).toContain("saved as a draft under Selling");
    const cards = document.querySelectorAll("[data-bunch-item]");
    expect(cards).toHaveLength(1);
    expect(within(cards[0] as HTMLElement).getAllByRole("img")).toHaveLength(1);
  });
});

describe("listBunch marks what stays", () => {
  const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
  const item = (key: string, photoKeys: string[]): BunchItem => ({ key, photoKeys, title: "Oak chair", description: "", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "40" });

  it("a failed upload stays; a refused publish does not", async () => {
    const real = await vi.importActual<typeof import("@/lib/declutter/bunch")>("@/lib/declutter/bunch");
    const files = new Map(["a", "b"].map((k) => [k, new File([k], k)]));
    let n = 0;
    const deps: ListDeps = {
      createDraft: vi.fn(async () => `d${++n}`),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async (_s, id) => {
        if (id === "d1") throw new Error("photo_not_uploaded");
        return "ph";
      }),
      setHandovers: vi.fn(async (_id, w) => w),
      publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, error: new Error("attestation_required") }))),
    };
    const out = await real.listBunch("seller", [item("up", ["a"]), item("pub", ["b"])], files, place, ["porch"], () => {}, deps);
    expect(out.map((o) => ["stays" in o ? o.stays : false, o.key])).toEqual([[true, "up"], [false, "pub"]]);
  });

  it("the estimate rounds up: 50 items is 13 minutes, never a few seconds each", async () => {
    const real = await vi.importActual<typeof import("@/lib/declutter/bunch")>("@/lib/declutter/bunch");
    expect(real.bunchListingMinutes(50)).toBe(13);
    expect(real.bunchListingMinutes(1)).toBe(1);
  });
});
