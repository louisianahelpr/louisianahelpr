/**
 * "Remember my setup" (owner 2026-10-29): a NEW listing starts from the seller's last listing's
 * setup: the ways buyers get it, the area, the private pickup address and the price-drop step. Only
 * blank or default fields are filled, step 4 says "Using your last listing's setup · Change", and a
 * saved draft is never touched. Pickup times are per seller already (loaded as before).
 * The API is stubbed: this checks what the form does with the last setup.
 *
 * @mutate src/components/declutter/useSellFlowState.ts |   const usedLastSetup = useLastListingSetup(urlItemId ? undefined : user?.id, { setForm, setWays, setCoords }); |   const usedLastSetup = useLastListingSetup(undefined, { setForm, setWays, setCoords });
 * @mutate src/components/declutter/SellLastSetup.tsx |     areaLabel: f.areaLabel.trim() ? f.areaLabel : s.areaLabel, |     areaLabel: s.areaLabel,
 * @mutate src/components/declutter/SellLastSetup.tsx |     ...(s.dropPct !== null && !f.drops ? { drops: true, dropPct: s.dropPct } : {}), |
 * @mutate src/components/declutter/SellLastSetup.tsx |     if (s.ways.length > 0) setWays((w) => (w.length === 1 && w[0] === "porch" ? s.ways : w)); |
 * @mutate src/components/declutter/SellOneScreen.tsx |               <LastSetupNote onChange={() => setWaysOpen(true)} /> | <span />
 * The Keep it up card says one line for its current setting (lead 2026-10-30; describe block at the bottom).
 * @mutate src/components/declutter/SellOneScreen.tsx | data-sell-lifetime="">{keepUpSettingLine(keepUpWanted)}</span> | data-sell-lifetime="">{keepUpSettingLine(false)}</span>
 * @mutate src/components/declutter/SellOneScreen.tsx | data-sell-lifetime="">{keepUpSettingLine(keepUpWanted)}</span> | data-sell-lifetime="">{keepUpSettingLine(keepUpWanted)}</span><span className="block text-ds-13 text-muted-foreground">It renews every 30 days until someone buys it.</span>
 * Remembered choices and the ON defaults (owner 2026-10-30; describe block at the bottom).
 * @mutate src/lib/declutter/sellerDefaults.ts | { keepUp: true, drops: true, dropPct: 5, | { keepUp: false, drops: true, dropPct: 5,
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       setWays(() => row.handovers); |       void 0;
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       setForm((f) => ({ ...f, drops: row.drops, dropPct: row.dropPct })); |       setForm((f) => ({ ...f, dropPct: row.dropPct }));
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       floorEdited.current = true;\n |       autoFloor.current = form.floor;\n
 * @mutate src/components/declutter/useSellFlowState.ts |       if (!urlItemId) void prefs.rememberChoices(keepUpWanted, autoFreeWanted);\n |       \n
 * @mutate src/lib/declutter/sellerDefaults.ts | Math.round((p * floorPct) / 100) | Math.round(p)
 * @mutate src/components/declutter/SellOneScreen.tsx | <div className="space-y-3" data-sell-switches=""> | <div className="space-y-3">
 * @mutate src/components/declutter/SellOneScreen.tsx | {!form.free && <div className="space-y-2" data-sell-row="drops"><SellDropsCard s={s} />{problemAt("drops")}</div>}\n              <div className="flex items-center gap-3 | <div className="flex items-center gap-3
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LastSetup } from "@/lib/declutter/lastSetup";
import type { SellerDefaults } from "@/lib/declutter/sellerDefaults";
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
// The seller's remembered choices on the account (owner 2026-10-30): none saved unless a test sets them.
const remembered = { value: null as SellerDefaults | null, saves: [] as SellerDefaults[] };
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()),
  fetchSellerDefaults: async () => remembered.value,
  saveSellerDefaults: async (_uid: string, d: SellerDefaults) => { remembered.saves.push(d); return true; },
}));
// Porch weekday chips (20261029161347) read the seller's picked days; none picked here.
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
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
  requestAiCheckWithRetry: async () => ({ checked: true, flagged: false }),
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

/** The one-screen new listing (owner 2026-10-29): photos, then Claude's listing as a summary card. */
async function addPhotoAndWait() {
  await screen.findByRole("heading", { name: "Show it off" });
  fireEvent.change(document.getElementById("sell-files")!, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(document.querySelector('[data-sell-summary="done"]')).not.toBeNull());
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
    await addPhotoAndWait();
    // The drop step comes along as the seller set it last time; the lowest price is this item's own.
    expect(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "10%" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "30" } });
    // "How buyers get it" is ONE line when the last setup was used, with the note and its Change.
    expect(document.querySelector("[data-ways-summary]")).not.toBeNull();
    expect(screen.getByText("Using your last listing's setup")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Area buyers see")).toHaveValue(LAST.areaLabel);
    expect(screen.getByLabelText("Pickup address")).toHaveValue(LAST.pickup!.address);
    expect(screen.getByRole("checkbox", { name: "Safe meeting spot" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(api.setHandovers).toHaveBeenCalledWith(NEW_ID, ["porch", "meetup"]));
    // The remembered point is used as is: the address is not looked up again.
    expect(geocode).not.toHaveBeenCalled();
    expect(drafts[0]).toMatchObject({ areaLabel: LAST.areaLabel, pickupAddress: LAST.pickup!.address, pickupLat: 30.45, pickupLng: -91.15 });
  });

  it("no earlier listing: the form starts as before, with no note", async () => {
    last.value = null;
    open();
    await addPhotoAndWait();
    // No earlier setup: "How buyers get it" starts open, with no note.
    await screen.findByLabelText("Area buyers see");
    expect(document.querySelector("[data-last-setup]")).toBeNull();
    expect(screen.getByLabelText("Area buyers see")).toHaveValue("");
  });

  it("only blank fields are filled; drops stay off when the last listing had them off", () => {
    const typed = { ...EMPTY, areaLabel: "Garden District", pickupAddress: "1 Elm Street" };
    expect(applyLastSetup(typed, LAST)).toMatchObject({ areaLabel: "Garden District", pickupAddress: "1 Elm Street", drops: true, dropPct: 10 });
    expect(applyLastSetup(EMPTY, { ...LAST, dropPct: null })).toMatchObject({ drops: false, areaLabel: LAST.areaLabel });
  });
});

// Lead 2026-10-30 (~/.lh-shots/b69-free-tab/after2-sell-375.png): the new listing's "Keep it up until it sells" card
// said "It renews every 30 days until someone buys it" AND "it goes back up by itself up to 3 more times (about 4
// months)" at once. It shows one line, for the setting it is on now.
describe("the new listing's Keep it up card", () => {
  beforeEach(() => {
    last.value = null;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("says one thing, and it follows the switch", async () => {
    open();
    await addPhotoAndWait();
    const card = document.querySelector("[data-keep-up]")!;
    const lines = () => [...card.querySelectorAll(".text-muted-foreground")].map((e) => e.textContent);
    // ON by default (owner 2026-10-30).
    await waitFor(() => expect(card.getAttribute("data-keep-up")).toBe("on"));
    expect(lines()).toEqual(["On. It renews every 30 days until someone buys it, with no reminders."]);
    fireEvent.click(screen.getByRole("switch", { name: "Keep it up until it sells" }));
    await waitFor(() => expect(card.getAttribute("data-keep-up")).toBe("off"));
    expect(lines()).toEqual(["Off. It's up for 30 days at a time, up to 4 times (about 4 months). We'll remind you before each round ends."]);
  });
});

// Owner 2026-10-30 (via the lead): "Keep it up until it sells" and "Lower the price" are ON by default, with a
// lowest price of half the asking price so it is valid without typing; the seller's choices are remembered on the
// account (declutter_seller_defaults) and pre-fill the next listing; the two switches sit together.
describe("a new listing starts from the seller's remembered choices", () => {
  beforeEach(() => {
    drafts.length = 0;
    last.value = null;
    remembered.value = null;
    remembered.saves.length = 0;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("nothing saved yet: keep it up ON, drops ON at 5%, lowest price half the asking price, and Post remembers it", async () => {
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: "Keep it up until it sells" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "5%" })).toHaveAttribute("aria-checked", "true");
    // The draft's price is $45: half, to a whole dollar.
    await waitFor(() => expect(screen.getByLabelText("Lowest you'll take")).toHaveValue("23"));
    // The two switches are one group, Lower the price first.
    const group = document.querySelector("[data-sell-switches]")!;
    expect([...group.querySelectorAll('[role="switch"]')].map((e) => e.getAttribute("aria-labelledby") ?? e.id)).toEqual(["sell-drops", "sell-keep-up"]);
    fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "100 Main Street, Baton Rouge" } });
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(remembered.saves).toHaveLength(1));
    expect(remembered.saves[0]).toEqual({ keepUp: true, drops: true, dropPct: 5, floorPct: 51, freeAfterDays: null, handovers: ["porch"] });
  });

  it("a saved row pre-fills the switches, the step, the lowest price's share, free-after and the ways", async () => {
    remembered.value = { keepUp: false, drops: true, dropPct: 15, floorPct: 60, freeAfterDays: 14, handovers: ["porch", "meetup"] };
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Keep it up until it sells" })).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("radio", { name: "15%" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByLabelText("Lowest you'll take")).toHaveValue("27"));
    expect(document.querySelector("[data-auto-free]")?.getAttribute("data-auto-free")).toBe("14");
    expect(screen.getByRole("checkbox", { name: "Safe meeting spot" })).toHaveAttribute("aria-checked", "true");
  });

  it("drops saved off stay off, and a lowest price the seller types is theirs", async () => {
    remembered.value = { keepUp: true, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"] };
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ })).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ }));
    await waitFor(() => expect(screen.getByLabelText("Lowest you'll take")).toHaveValue("23"));
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "30" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByLabelText("Lowest you'll take")).toHaveValue("30");
  });
});
