/**
 * S-F2 (whole-app audit 1123, Declutter seller): finishing a saved draft (/declutter/sell?item=, "Finish listing", every
 * Relist and every Sell a bunch draft) asked step 4 "How can buyers get it?" (the ways, the pickup address and the
 * pickup times) again every time. Owner 2026-10-30 (saved-settings rule): setup is one-time, "not asked every time they
 * post". Now a seller with their pickup address and times saved goes photos, details, price, review ("n of 4"), and the
 * draft is saved on step 3's Continue; the review's "How buyers get it" Edit still opens the step. A seller with nothing
 * saved is asked, as before. Mounts the real step form (DeclutterSellView SellSteps) over a stubbed flow state.
 *
 * @mutate src/components/declutter/DeclutterSellView.tsx |   const skipWays = setupSaved && draftHasPickup && !waysOpened; |   const skipWays = false;
 * @mutate src/components/declutter/DeclutterSellView.tsx |     if (step === 4 \|\| (step === 3 && skipWays)) { |     if (step === 4) {
 * @mutate src/components/declutter/DeclutterSellView.tsx |   const setupSaved = first.settled && !first.failed && !!first.needs && !anyNeeded(first.needs); |   const setupSaved = first.settled;
 * @mutate src/components/declutter/DeclutterSellView.tsx | onEdit={() => { setWaysOpened(true); setStep(4); }} | onEdit={() => { setStep(4); }}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  needs: { pickup: false, times: false, defaults: false } as { pickup: boolean; times: boolean; defaults: boolean } | null,
  address: "12 Oak St, Lafayette, LA",
  saveDetails: null as null | ReturnType<typeof vi.fn>,
}));

vi.mock("@/components/declutter/useSellFlowState", () => ({
  useSellFlowState: () => ({
    user: { id: "seller-1" }, underAge: false,
    item: { data: { status: "draft" } }, photos: { data: [] },
    form: { title: "SEED lamp", description: "", category: "home", conditionStars: 4, deliverySize: "small", price: "20", floor: "", drops: false, dropPct: 5, free: false, areaLabel: "Lafayette", pickupAddress: state.address },
    set: vi.fn(), saving: false, uploading: false, held: [], setHeld: vi.fn(), aiAsk: null, ai: { state: { status: "idle" }, run: vi.fn() },
    keepUp: { on: true, set: vi.fn(), busy: false }, savedWays: ["porch"], windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }],
    photoCount: 1, photoTotal: 1, priceCents: 2000, floorCents: null, hintAt: null,
    saveDetails: state.saveDetails, onPublish: vi.fn(), publishing: false, setWindows: vi.fn(),
  }),
}));
vi.mock("@/components/declutter/FirstSalePickup", () => ({
  useFirstSale: () => ({ settled: true, failed: false, needs: state.needs, reload: vi.fn(), timesProblem: null, save: vi.fn() }),
}));
vi.mock("@/components/declutter/sellForm", () => ({ sellStepProblem: () => null }));
vi.mock("@/components/declutter/DeclutterSellPhotos", () => ({ MAX_PHOTOS: 12, SellPhotos: () => null }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/declutter/KeepUpRow", () => ({ KeepUpSwitch: () => null }));
vi.mock("@/components/declutter/AutoFreeRow", () => ({ AutoFreeRow: () => null }));
vi.mock("@/components/declutter/SellOneScreen", () => ({ SellOneScreen: () => null }));
vi.mock("@/components/declutter/SellFormParts", () => ({
  FieldLabel: () => null, SELL_INPUT: "", SellDropsCard: () => null, SellFreeToggle: () => null, SellPriceInput: () => null,
  SellTaxBox: () => null, SellYouGet: () => null,
  SellWaysFields: () => <div data-testid="ways-step">ways, address, times</div>,
}));

import SellFlow from "@/components/declutter/DeclutterSellView";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter/sell?item=draft-1"]}>
        <SellFlow />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function continueTimes(n: number) {
  for (let i = 0; i < n; i++) {
    const button = screen.getAllByRole("button").find((b) => /^(Continue|Save and continue)$/.test(b.textContent ?? ""));
    expect(button, `no Continue on press ${i + 1}`).toBeTruthy();
    await act(async () => { fireEvent.click(button!); });
  }
}
const progress = () => document.querySelector("[data-sell-progress]")?.textContent ?? "";

describe("a saved draft does not re-ask the pickup setup a seller already saved (S-F2)", () => {
  beforeEach(() => {
    state.needs = { pickup: false, times: false, defaults: false };
    state.address = "12 Oak St, Lafayette, LA";
    state.saveDetails = vi.fn(async () => "draft-1");
  });

  it("setup saved: photos, details, price, then the review; 4 steps; the draft saved once, on step 3", async () => {
    mount();
    expect(progress()).toContain("1 of 4");
    await continueTimes(3);
    expect(screen.getByText("Ready to list?")).toBeTruthy();
    expect(screen.queryByTestId("ways-step")).toBeNull();
    expect(progress()).toContain("4 of 4");
    expect(state.saveDetails).toHaveBeenCalledTimes(1);
  });

  it("the review's 'How buyers get it' Edit still opens the ways step", async () => {
    mount();
    await continueTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Edit how buyers get it" }));
    expect(screen.getByTestId("ways-step")).toBeTruthy();
    expect(progress()).toContain("4 of 5");
  });

  it("nothing saved yet (a first sale): step 4 asks, as before", async () => {
    state.needs = { pickup: true, times: true, defaults: true };
    mount();
    expect(progress()).toContain("1 of 5");
    await continueTimes(3);
    expect(screen.getByTestId("ways-step")).toBeTruthy();
    expect(state.saveDetails).not.toHaveBeenCalled();
  });

  it("a draft with no pickup address of its own is asked too", async () => {
    state.address = "";
    mount();
    await continueTimes(3);
    expect(screen.getByTestId("ways-step")).toBeTruthy();
  });
});
