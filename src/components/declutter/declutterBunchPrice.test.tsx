/**
 * Sell a bunch audit finding 4: the photo tool's suggested price was thrown away, so every price was typed, and no
 * point was sent, so it could not be held to our own sold prices.
 *
 * @mutate src/lib/declutter/bunch.ts |     const price = suggestedPrice(it.priceDollars); |     const price = "";
 * @mutate src/lib/declutter/bunch.ts |   const theirs = it.price.trim() !== "" && it.price !== it.aiPrice; |   const theirs = false;
 * @mutate src/lib/declutter/bunch.ts | invokeAiBody(at ? { mode: "group", photos, at } : { mode: "group", photos }, GROUP_TIMEOUT_MS) | invokeAiBody({ mode: "group", photos }, GROUP_TIMEOUT_MS)
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       }, async (cleaned) => askGroup(cleaned, await at), undefined | }, async (cleaned) => askGroup(cleaned, null), undefined
 * @mutate src/components/declutter/DeclutterBunchView.tsx | .filter(Boolean), point), { delays: [4_000] }); | .filter(Boolean)), { delays: [4_000] });
 * @mutate src/components/declutter/DeclutterBunchView.tsx | flagged: d.flagged !== false, ...rewrittenPrice(x, d.priceDollars) } | flagged: d.flagged !== false }
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  draft: vi.fn(),
  geocode: vi.fn(),
}));

// LEAD-BUNCH-34-SLOW: no early photo uploads here (they would reach prod storage); declutterBunchEarlyUpload.test.ts pins them.
vi.mock("@/lib/declutter/bunchStage", () => ({
  BunchStager: class {
    idFor() { return undefined; }
    path() { return Promise.resolve(null); }
    used() {}
    sync() { return new Map(); }
  },
}));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, del: async () => {}, delMany: async () => {}, keys: async () => [], createStore: () => ({}) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { onboarding_fee_paid: true }, isAdmin: false, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: h.geocode }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  cleanListingPhoto: async (f: File) => f,
  blobToBase64: async () => "b64",
}));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  invokeAiBody: h.invoke,
  requestAiDraftFromPhotos: h.draft,
  fetchMyItems: async () => [],
  fetchMyPickupWindows: async () => [],
  fetchHasAgreedSales: async () => false,
}));

import BunchFlow from "./DeclutterBunchView";
import { itemsFromAnswer, rewrittenPrice } from "@/lib/declutter/bunch";

const drafted = (photos: number[], priceDollars?: unknown) => ({
  photos, title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, priceDollars,
});

async function pickPhoto() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
  return { qc };
}
const addPhoto = () => fireEvent.change(document.getElementById("bunch-files")!, { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" })] } });
const card = async () => {
  await screen.findByRole("heading", { name: /^3\. Check each item/ });
  const row = document.querySelector("[data-bunch-item]") as HTMLElement;
  const closed = row.querySelector('[data-bunch-expand][aria-expanded="false"]');
  if (closed) fireEvent.click(closed);
  return row;
};
const priceOf = (c: HTMLElement) => within(c).getByLabelText("Price ($)") as HTMLInputElement;

beforeAll(() => {
  URL.createObjectURL = () => "blob:test/1";
  URL.revokeObjectURL = () => {};
});
beforeEach(() => {
  h.invoke.mockReset();
  h.draft.mockReset();
  h.geocode.mockReset();
  h.geocode.mockImplementation(async () => ({ status: "exact", lat: 30.45, lng: -91.15 }));
  h.invoke.mockImplementation(async () => ({ items: [drafted([0], 40)], leftover: [] }));
});
afterEach(cleanup);

describe("the suggested price is used", () => {
  it("fills the price, says it's a suggestion, and the item is ready without typing", async () => {
    await pickPhoto();
    addPhoto();
    const c = await card();
    expect(priceOf(c).value).toBe("40");
    expect(within(c).getByText("Our suggestion. Change it if you like.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3. Check each item (1 of 1 ready)" })).toBeTruthy();
    fireEvent.change(priceOf(c), { target: { value: "55" } });
    expect(within(c).queryByText("Our suggestion. Change it if you like.")).toBeNull();
  });

  it.each([[null], [undefined], [0], [1001], ["40"], [NaN]])("an unusable suggestion (%s) leaves the price blank", (bad) => {
    const [it0] = itemsFromAnswer({ items: [drafted([0], bad) as never], leftover: [] }, [{ key: "a", file: new File(["a"], "a") }]);
    expect(it0.price).toBe("");
    expect(it0.aiPrice).toBeUndefined();
  });

  it("sends the located address with each batch", async () => {
    await pickPhoto();
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    addPhoto();
    await card();
    expect(h.invoke.mock.calls[0][0]).toMatchObject({ mode: "group", at: { lat: 30.45, lng: -91.15 } });
  });

  it("no address yet, or a failed lookup: the photos are still sorted, with no point", async () => {
    await pickPhoto();
    addPhoto();
    await card();
    expect(h.invoke.mock.calls[0][0]).not.toHaveProperty("at");
    expect(h.geocode).not.toHaveBeenCalled();
    cleanup();

    h.invoke.mockClear();
    h.geocode.mockResolvedValue({ status: "unavailable" });
    await pickPhoto();
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    addPhoto();
    await card();
    expect(h.invoke.mock.calls[0][0]).not.toHaveProperty("at");
  });

  it("Write it again sends the point and refreshes a suggested price, but never one the seller typed", async () => {
    h.draft.mockResolvedValue({ title: "Oak rocker", description: "", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, priceDollars: 60 });
    await pickPhoto();
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    addPhoto();
    const c = await card();
    fireEvent.click(within(c).getByRole("button", { name: /^Write it again/ }));
    await waitFor(() => expect(priceOf(c).value).toBe("60"));
    expect(h.draft.mock.calls[0][1]).toEqual({ lat: 30.45, lng: -91.15 });

    fireEvent.change(priceOf(c), { target: { value: "25" } });
    h.draft.mockResolvedValue({ title: "Oak rocker", description: "", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, priceDollars: 90 });
    fireEvent.click(within(c).getByRole("button", { name: /^Write it again/ }));
    await waitFor(() => expect(h.draft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(c).getByRole("button", { name: /^Write it again/ }).hasAttribute("disabled")).toBe(false));
    expect(priceOf(c).value).toBe("25");
  });

  it("rewrittenPrice: a blank takes it, no new suggestion keeps what's there", () => {
    expect(rewrittenPrice({ price: "" }, 30)).toEqual({ price: "30", aiPrice: "30" });
    expect(rewrittenPrice({ price: "40", aiPrice: "40" }, null)).toEqual({ price: "40", aiPrice: "40" });
    expect(rewrittenPrice({ price: "12", aiPrice: "40" }, 30)).toEqual({ price: "12", aiPrice: "40" });
  });
});
