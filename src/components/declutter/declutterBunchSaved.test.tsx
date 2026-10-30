/**
 * Sell a bunch audit finding 2: reload, the back link, a killed tab or a crash lost every photo and every word, with no
 * warning. The store is mocked with an in-memory idb-keyval (jsdom has no IndexedDB); the real one is a browser check.
 *
 * @mutate src/components/declutter/useBunchSaved.ts |     window.addEventListener("beforeunload", warn); |     void warn;
 * @mutate src/components/declutter/useBunchSaved.ts |     const t = setTimeout(flush, SAVE_DELAY_MS); |     const t = setTimeout(() => {}, SAVE_DELAY_MS);
 * @mutate src/components/declutter/useBunchSaved.ts |       const keep = s.sorting ? s.photos : s.photos.filter((p) => held.has(p.key)); |       const keep = s.photos;
 * @mutate src/lib/declutter/bunchSaved.ts |   if (saved.userId !== userId \|\| now - saved.savedAt > MAX_AGE_MS) { |   if (false) {
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem } from "@/lib/declutter/bunch";

const h = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  failWrites: false,
  user: "u1",
}));

vi.mock("idb-keyval", () => ({
  get: async (k: string) => h.disk.get(k),
  set: async (k: string, v: unknown) => {
    if (h.failWrites) throw new Error("quota");
    h.disk.set(k, v);
  },
  del: async (k: string) => void h.disk.delete(k),
  delMany: async (ks: string[]) => ks.forEach((k) => h.disk.delete(k)),
  keys: async () => [...h.disk.keys()],
  createStore: () => ({}),
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: h.user }, profile: { onboarding_fee_paid: true }, isAdmin: false, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.4, longitude: -91.1 }) }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<object>()), fetchMyItems: async () => [], fetchMyPickupWindows: async () => [], fetchHasAgreedSales: async () => false }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[]) => ({
      items: [
        { key: "i1", photoKeys: [photos[0].key], title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "" } as BunchItem,
        { key: "i2", photoKeys: [photos[1].key], title: "Floor lamp", description: "", category: "other", deliverySize: "large", conditionStars: 3, flagged: false, price: "" } as BunchItem,
      ],
      failed: [],
    }),
  };
});

import BunchFlow from "./DeclutterBunchView";
import { clearSavedBunch, loadSavedBunch } from "@/lib/declutter/bunchSaved";

function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
}

const META = "lh-bunch-v1";
const savedMeta = () => h.disk.get(META) as { items: BunchItem[]; photos: { key: string }[]; pickupAddress: string } | undefined;
const photoEntries = () => [...h.disk.keys()].filter((k) => k.startsWith("lh-bunch-v1-photo:"));

async function pickTwoPhotos() {
  await new Promise((r) => setTimeout(r, 0));
  const files = ["a", "b"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
  fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
  await screen.findByRole("heading", { name: /^3\. Check each item/ });
}

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
beforeEach(() => {
  h.disk.clear();
  h.failWrites = false;
  h.user = "u1";
});
afterEach(cleanup);

describe("Sell a bunch survives leaving", () => {
  it("photos, the written words, prices and the address come back after the page goes away", async () => {
    const first = renderFlow();
    fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    await pickTwoPhotos();
    const cards = document.querySelectorAll("[data-bunch-item]");
    fireEvent.change(within(cards[0] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "40" } });
    await waitFor(() => expect(savedMeta()?.items[0]?.price).toBe("40"));
    expect(photoEntries()).toHaveLength(2);
    first.unmount();

    renderFlow();
    expect(await screen.findByText(/We kept your work from last time: 2 items/)).toBeTruthy();
    const back = document.querySelectorAll("[data-bunch-item]");
    expect(back).toHaveLength(2);
    expect((within(back[0] as HTMLElement).getByLabelText("Name") as HTMLInputElement).value).toBe("Oak chair");
    expect((within(back[0] as HTMLElement).getByLabelText("Price ($)") as HTMLInputElement).value).toBe("40");
    expect((screen.getByLabelText("Pickup address") as HTMLInputElement).value).toBe("1 Main St, Baton Rouge");
    expect((screen.getByLabelText("Area buyers see") as HTMLInputElement).value).toBe("Mid-City");
    expect(back[0].querySelectorAll("img")).toHaveLength(1);
  });

  it("leaving before the save delay still saves (the back link)", async () => {
    const first = renderFlow();
    await pickTwoPhotos();
    await waitFor(() => expect(savedMeta()?.items).toHaveLength(2));
    const cards = document.querySelectorAll("[data-bunch-item]");
    fireEvent.change(within(cards[1] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "15" } });
    first.unmount();
    await waitFor(() => expect(savedMeta()?.items[1]?.price).toBe("15"));
  });

  it("warns before the tab closes only while there is work to lose", async () => {
    renderFlow();
    await new Promise((r) => setTimeout(r, 0));
    const empty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
    await pickTwoPhotos();
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("a dropped item's photo is removed, so it never comes back", async () => {
    const first = renderFlow();
    await pickTwoPhotos();
    await waitFor(() => expect(photoEntries()).toHaveLength(2));
    fireEvent.click(within(document.querySelectorAll("[data-bunch-item]")[1] as HTMLElement).getByRole("button", { name: "Don't sell this" }));
    await waitFor(() => expect(photoEntries()).toHaveLength(1));
    first.unmount();
    renderFlow();
    await screen.findByText(/We kept your work from last time: 1 item,/);
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(1);
  });

  it("Start over asks first, then removes it from the device", async () => {
    const first = renderFlow();
    await pickTwoPhotos();
    await waitFor(() => expect(photoEntries()).toHaveLength(2));
    first.unmount();
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Start over" }));
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(h.disk.size).toBe(0));
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(0);
  });

  it("says so when it can't save, and the work on screen is untouched", async () => {
    h.failWrites = true;
    renderFlow();
    await pickTwoPhotos();
    expect(await screen.findByText(/We couldn't save your work on this device/)).toBeTruthy();
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2);
  });

  it("another member never gets it, and it is removed", async () => {
    h.disk.set(META, { userId: "someone-else", savedAt: Date.now(), areaLabel: "", pickupAddress: "Their street", coords: null, photos: [], items: [] });
    expect(await loadSavedBunch("u1")).toBeNull();
    expect(h.disk.has(META)).toBe(false);
  });

  it("an old one is removed after 7 days", async () => {
    h.disk.set(META, { userId: "u1", savedAt: 0, areaLabel: "", pickupAddress: "Old", coords: null, photos: [], items: [] });
    expect(await loadSavedBunch("u1", 8 * 24 * 3_600_000)).toBeNull();
    expect(h.disk.has(META)).toBe(false);
  });

  it("sign-out's clear removes every entry", async () => {
    h.disk.set(META, {});
    h.disk.set("lh-bunch-v1-photo:p1", new Blob(["x"]));
    h.disk.set("unrelated", 1);
    await clearSavedBunch();
    expect([...h.disk.keys()]).toEqual(["unrelated"]);
  });
});
