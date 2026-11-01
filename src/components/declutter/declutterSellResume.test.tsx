/**
 * Audit AA9 (2026-10-29): the owner had to fill a listing in by hand. Claude
 * drafted only a NEW listing by itself; a resumed draft ("Finish listing",
 * /declutter/sell?item=<id>) only showed a "Write my listing" button. Now a
 * resumed draft with photos and an empty title or details is drafted by
 * itself too, filling ONLY the empty fields (never what the seller typed).
 * Also A1-B1: the tax sentence's label ticks the box (one id, not two), and
 * A1-B3: ticking "I'll deliver" with "I can deliver" off says so on step 4.
 * The API is stubbed: this checks what the screen does with the answers.
 *
 * @mutate src/components/declutter/useSellFlowState.ts | autoFillEmpty: resumedEmpty | autoFillEmpty: false
 * @mutate src/components/declutter/SellAiDraft.tsx |     title: current.title.trim() ? current.title : d.title, |     title: d.title,
 * @mutate src/components/declutter/SellAiDraft.tsx |     description: current.description.trim() ? current.description : d.description, |     description: current.description,
 * @mutate src/components/declutter/SellAiDraft.tsx |     category: current.category === "other" ? d.category : current.category, |     category: d.category,
 * @mutate src/components/declutter/useSellFlowState.ts | photoCount > 0 && (!form.title.trim() \|\| !form.description.trim()) | photoCount > 0
 * @mutate src/components/declutter/SellAiDraft.tsx |     price: !current.price.trim() && typeof d.priceDollars | price: typeof d.priceDollars
 * @mutate src/components/declutter/SellFormParts.tsx | <h3 id="sell-tax-head" | <h3 id="sell-tax"
 * @mutate src/components/declutter/SellDeliveryOffNotice.tsx |   if (!on \|\| !ticked \|\| !mine.data \|\| mine.data.enabled) return null; |   return null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ID = "0f0e0d0c-0b0a-4908-8706-0504030201aa";
const DRAFT = {
  title: "Mid-century walnut dresser", description: "Six drawers, solid walnut, light scratches on top.",
  category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false,
  priceDollars: 45, priceReason: "Solid walnut.",
};
const saved = { title: "Oak rocking chair", description: "", category: "other" };
const delivery = { enabled: false };

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "exact", lat: 30.45, lng: -91.15 }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));
// The Selling tab's own card has its own test (sellerDeliverySettings); here only that it is offered.
vi.mock("./SellerDeliverySettings", () => ({ SellerDeliveryCard: () => <div data-testid="seller-delivery-card" /> }));
vi.mock("@/lib/declutter/sellerDelivery", () => ({ fetchMySellerDelivery: async () => ({ ...delivery }) }));
// Porch weekday chips (20261029161347) read the seller's picked days; none picked here.
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async () => ({
    id: ID, status: "draft", title: saved.title, description: saved.description, category: saved.category,
    condition_stars: 3, delivery_size: "small", price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, porch_ok: true,
  }),
  fetchMyItemPrivate: async () => ({ floor_price_cents: 4000, pickup_address: "100 Main Street, Baton Rouge, LA 70802", pickup_lat: 30.45, pickup_lng: -91.15 }),
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => [{ id: "p1", item_id: ID, storage_path: "u1/a.jpg", position: 0 }],
  fetchHasAgreedSales: async () => false,
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  createDraft: async () => ID,
  setDropPct: async (_id: string, pct: number) => pct,
  fetchItemDropState: async () => null,
  updateDraft: async () => "ok",
  setHandovers: async (_id: string, ways: string[]) => ways,
  fetchItemHandovers: async () => null,
  addPhotoSteadily: async () => "p",
  removePhoto: async () => undefined,
  requestAiDraft: vi.fn(async () => DRAFT),
  requestAiDraftFromPhotos: async () => DRAFT,
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  requestAiCheckWithRetry: async () => ({ checked: true, flagged: false }),
  setPickupWindows: async () => 1,
  attestItem: async () => undefined,
  publishItem: async () => "live",
  // Keep it up until it sells (KeepUpRow, 20261029154323): off on this draft.
  fetchKeepUp: async () => false,
  setKeepUp: async (_id: string, on: boolean) => on,
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import * as api from "@/lib/declutter/api";
import { TAX_TICK_LABEL } from "./declutterUi";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/declutter/sell?item=${ID}`]}>
        <Routes><Route path="/declutter/sell" element={<DeclutterSellPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a resumed draft", () => {
  beforeEach(() => {
    vi.mocked(api.requestAiDraft).mockClear();
    Object.assign(saved, { title: "Oak rocking chair", description: "", category: "other" });
    delivery.enabled = false;
  });

  it("with photos and empty details: Claude drafts it by itself and fills ONLY the empty fields", async () => {
    open();
    // The auto-draft fires only after the draft, its private row and its photos have all loaded and the form has
    // re-rendered (four renders, then the effect). On a loaded CI runner that chain outran findBy's 1 s default
    // (measured: 2 of 2 red under load, 6 of 6 green idle), so wait on the trigger itself, with room.
    await waitFor(() => expect(api.requestAiDraft).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(await screen.findByText("We wrote your listing. Check it before you post")).toBeInTheDocument();
    expect(api.requestAiDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // The seller's own title stays; the empty details and the "Other" category are Claude's.
    expect(await screen.findByLabelText("Title")).toHaveValue("Oak rocking chair");
    expect(screen.getByLabelText(/Anything else/)).toHaveValue(DRAFT.description);
    expect(screen.getByRole("radio", { name: "Furniture" })).toHaveAttribute("aria-checked", "true");
    // The saved price is the seller's: Claude's suggestion never replaces it.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Price")).toHaveValue("40");
  });

  it("a category the seller picked stays theirs while Claude fills the empty details", async () => {
    saved.category = "kitchen";
    open();
    // Same trigger wait as above (CI load).
    await waitFor(() => expect(api.requestAiDraft).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText(/Anything else/)).toHaveValue(DRAFT.description);
    expect(screen.getByRole("radio", { name: "Kitchen" })).toHaveAttribute("aria-checked", "true");
  });

  it("already filled in: nothing runs by itself, the button still offers it", async () => {
    Object.assign(saved, { description: "My grandmother's chair.", category: "furniture" });
    open();
    expect(await screen.findByRole("button", { name: /Write my listing/ })).toBeInTheDocument();
    expect(api.requestAiDraft).not.toHaveBeenCalled();
  });

  it("step 4: ticking \"I'll deliver\" while \"I can deliver\" is off says so and offers the setting there", async () => {
    Object.assign(saved, { description: "My grandmother's chair.", category: "furniture" });
    open();
    await screen.findByRole("button", { name: /Write my listing/ });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "How can buyers get it?" });
    expect(document.querySelector("[data-seller-delivery-off]")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "I'll deliver" }));
    expect(await screen.findByText(/Buyers won't see "I'll deliver" until you turn on "I can deliver"/)).toBeInTheDocument();
    expect(screen.getByTestId("seller-delivery-card")).toBeInTheDocument();
  });

  it("step 4: with \"I can deliver\" on, no warning", async () => {
    Object.assign(saved, { description: "My grandmother's chair.", category: "furniture" });
    delivery.enabled = true;
    open();
    await screen.findByRole("button", { name: /Write my listing/ });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "How can buyers get it?" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I'll deliver" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "I'll deliver" })).toHaveAttribute("aria-checked", "true"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-seller-delivery-off]")).toBeNull();
  });

  it("step 5: the tax sentence names the box and tapping it ticks the box (one id, not two)", async () => {
    Object.assign(saved, { description: "My grandmother's chair.", category: "furniture" });
    open();
    await screen.findByRole("button", { name: /Write my listing/ });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "How can buyers get it?" });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const box = await screen.findByRole("checkbox", { name: TAX_TICK_LABEL });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByText(TAX_TICK_LABEL));
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(document.querySelectorAll("#sell-tax")).toHaveLength(1);
  });
});
