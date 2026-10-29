/**
 * "Remember my setup" (owner 2026-10-29): a NEW listing starts from the seller's last listing's
 * setup: the ways buyers get it, the area, the private pickup address and the price-drop step. Only
 * blank or default fields are filled, step 4 says "Using your last listing's setup · Change", and a
 * saved draft is never touched. Pickup times are per seller already (loaded as before).
 * The API is stubbed: this checks what the form does with the last setup.
 *
 * @mutate src/components/declutter/DeclutterSellView.tsx |   const usedLastSetup = useLastListingSetup(itemId ? undefined : user?.id, { setForm, setWays, setCoords }); |   const usedLastSetup = false;
 * @mutate src/components/declutter/SellLastSetup.tsx |     areaLabel: f.areaLabel.trim() ? f.areaLabel : s.areaLabel, |     areaLabel: s.areaLabel,
 * @mutate src/components/declutter/SellLastSetup.tsx |     ...(s.dropPct !== null && !f.drops ? { drops: true, dropPct: s.dropPct } : {}), |
 * @mutate src/components/declutter/SellLastSetup.tsx |     if (s.ways.length > 0) setWays((w) => (w.length === 1 && w[0] === "porch" ? s.ways : w)); |
 * @mutate src/components/declutter/DeclutterSellView.tsx |           {usedLastSetup && <LastSetupNote />} |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LastSetup } from "@/lib/declutter/lastSetup";
import { EMPTY } from "./sellForm";

const NEW_ID = "0f0e0d0c-0b0a-4908-8706-0504030201bb";
const drafts: Record<string, unknown>[] = [];
const DRAFT = {
  title: "Mid-century walnut dresser", description: "Six drawers.", category: "furniture", deliverySize: "large",
  conditionStars: 4, flagged: false, priceDollars: 45, priceReason: "Solid walnut.",
};
const LAST: LastSetup = {
  itemId: "last-1", ways: ["porch", "meetup"], areaLabel: "Mid-City, Baton Rouge",
  pickup: { address: "100 Main Street, Baton Rouge, LA 70802", lat: 30.45, lng: -91.15 }, dropPct: 10,
};
const last = { value: LAST as LastSetup | null };

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
const geocode = vi.fn(async () => ({ latitude: 1, longitude: 1 }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: () => geocode() }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => last.value }));
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async () => null,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => [],
  fetchHasAgreedSales: async () => false,
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  createDraft: async (f: Record<string, unknown>) => { drafts.push(f); return NEW_ID; },
  setDropPct: async (_id: string, pct: number) => pct,
  fetchItemDropState: async () => null,
  updateDraft: async () => "ok",
  setHandovers: vi.fn(async (_id: string, ways: string[]) => ways),
  fetchItemHandovers: async () => null,
  addPhoto: async () => "p",
  removePhoto: async () => undefined,
  requestAiDraft: async () => DRAFT,
  requestAiDraftFromPhotos: async () => DRAFT,
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  setPickupWindows: async () => 1,
  attestItem: async () => undefined,
  publishItem: async () => "live",
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import * as api from "@/lib/declutter/api";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { applyLastSetup } from "./SellLastSetup";

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter/sell"]}>
        <Routes><Route path="/declutter/sell" element={<DeclutterSellPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function toStep4() {
  await screen.findByRole("heading", { name: "Show it off" });
  fireEvent.change(document.getElementById("sell-files")!, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await screen.findByText("Claude wrote your listing");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Title");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Price");
}

describe("a new listing remembers the last listing's setup", () => {
  beforeEach(() => {
    drafts.length = 0;
    last.value = LAST;
    geocode.mockClear();
    vi.mocked(api.setHandovers).mockClear();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("fills the ways, area, pickup address and drop step, says so, and saves them", async () => {
    open();
    await toStep4();
    // The drop step comes along as the seller set it last time; the lowest price is this item's own.
    expect(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "10%" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "How can buyers get it?" });
    expect(screen.getByText("Using your last listing's setup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByLabelText("Area buyers see")).toHaveValue(LAST.areaLabel);
    expect(screen.getByLabelText("Pickup address")).toHaveValue(LAST.pickup!.address);
    expect(screen.getByRole("checkbox", { name: "Safe meeting spot" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(api.setHandovers).toHaveBeenCalledWith(NEW_ID, ["porch", "meetup"]));
    // The remembered point is used as is: the address is not looked up again.
    expect(geocode).not.toHaveBeenCalled();
    expect(drafts[0]).toMatchObject({ areaLabel: LAST.areaLabel, pickupAddress: LAST.pickup!.address, pickupLat: 30.45, pickupLng: -91.15 });
  });

  it("no earlier listing: the form starts as before, with no note", async () => {
    last.value = null;
    open();
    await toStep4();
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "How can buyers get it?" });
    expect(document.querySelector("[data-last-setup]")).toBeNull();
    expect(screen.getByLabelText("Area buyers see")).toHaveValue("");
  });

  it("only blank fields are filled; drops stay off when the last listing had them off", () => {
    const typed = { ...EMPTY, areaLabel: "Garden District", pickupAddress: "1 Elm Street" };
    expect(applyLastSetup(typed, LAST)).toMatchObject({ areaLabel: "Garden District", pickupAddress: "1 Elm Street", drops: true, dropPct: 10 });
    expect(applyLastSetup(EMPTY, { ...LAST, dropPct: null })).toMatchObject({ drops: false, areaLabel: LAST.areaLabel });
  });
});
