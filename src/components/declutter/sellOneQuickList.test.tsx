/**
 * Ease batch (owner-approved 2026-11-20: in 30 days 9 members opened Declutter and only 2 listed): listing ONE item is
 * one screen, from the Sell button to a live listing, for a first-time seller too.
 *
 * Measured on feat/site-polish-1120 before this change (a first-time seller: no saved place, times or settings):
 *   Sell -> chooser (tap One item) -> "Set up selling" (address, a day chip, Save and continue) -> the one screen
 *   (a photo, the tax box, Post it): 3 screens, 7 required actions.
 * After: Sell -> the one screen (a photo, the address, the tax box, Post it): 1 screen, 4 required actions. The times
 * start at every day 5-8 PM, shown with Change; the settings start at the setup screen's own defaults (F124).
 *
 * The walker below presses whatever screen it lands on the way a member would, so the old flow (chooser, setup screen)
 * is counted, not assumed: on the old flow it reads 3 screens and 7 actions and the count assertions fail.
 *
 * @mutate src/lib/declutter/sellChooser.ts | export const SELL_START_PATH = "/declutter/sell"; | export const SELL_START_PATH = "/declutter/sell?mode=choose";
 * @mutate src/pages/declutter/DeclutterSellPage.tsx |         <SellFlow />\n      )} |         <SellerSetupGate><SellFlow /></SellerSetupGate>\n      )}
 * @mutate src/components/declutter/FirstSalePickup.tsx |     setWindows(FIRST_SALE_WINDOWS); |     setWindows([]);
 * @mutate src/components/declutter/SellOneScreen.tsx |         await first.save(); |         void first;
 * @mutate src/components/declutter/FirstSalePickup.tsx |   const failed = saved.failed \|\| windowsQ.isError; |   const failed = false;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const NEW_ID = "0f0e0d0c-0b0a-4908-8706-0504030201aa";
const PLACE = { id: "pl", position: 1, label: "Home", address: "100 Main Street, Baton Rouge, LA 70802", area: "Baton Rouge", lat: 30.45, lng: -91.15, weekdays: [6] };
const ROW = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true, acceptsTrades: false };
const WINDOW = { weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" };

const state = vi.hoisted(() => ({
  places: [] as unknown[],
  savedPlaces: [] as Record<string, unknown>[],
  row: null as unknown,
  rows: [] as unknown[],
  windows: [] as { weekday: number; starts_local: string; ends_local: string }[],
  savedWindows: [] as { weekday: number; starts: string; ends: string }[][],
  windowsFail: false,
  calls: [] as string[],
  photos: [] as { id: string; storage_path: string }[],
}));
const DRAFT = {
  title: "Mid-century walnut dresser", description: "Six drawers, solid walnut, light scratches on top.",
  category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false,
  priceDollars: 45, priceReason: "Solid walnut with light wear, so it should sell fast.",
};

vi.mock("@/lib/declutter/mySetupFee", () => ({ fetchMySetupFee: async () => null }));
vi.mock("@/lib/declutter/photos", async (orig) => ({ ...(await orig<object>()), cleanListingPhoto: async (f: File) => f }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => ({ status: "idle" }), getCachedUserLocation: () => null, deriveFallbackLocation: async () => null }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "exact", lat: 30.45123, lng: -91.15456 }) }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/components/AppPage", () => ({ default: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/bunchSaved", async (orig) => ({ ...(await orig<object>()), savedSellWork: async () => ({ bunch: false, one: false, moving: false }) }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({
  ...(await orig<object>()),
  fetchMyPorchPlaces: async () => state.places,
  saveMyPorchPlace: async (p: Record<string, unknown>) => { state.calls.push("place"); state.savedPlaces.push(p); state.places = [{ ...p, id: "n", position: 1 }]; return "n"; },
}));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<object>()),
  fetchSellerDefaults: async () => state.row,
  saveSellerDefaults: async (_u: string, d: unknown) => { state.calls.push("defaults"); state.rows.push(d); state.row = d; return true; },
}));
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async () => null,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => {
    if (state.windowsFail) throw new Error("network");
    return state.windows;
  },
  setPickupWindows: async (w: { weekday: number; starts: string; ends: string }[]) => {
    state.calls.push("windows");
    state.savedWindows.push(w);
    state.windows = w.map((x) => ({ weekday: x.weekday, starts_local: `${x.starts}:00`, ends_local: `${x.ends}:00` }));
    return w.length;
  },
  fetchPhotos: async () => state.photos,
  fetchHasAgreedSales: async () => false,
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  createDraft: async (_f: unknown, withId?: string) => { state.calls.push("createDraft"); return withId ?? NEW_ID; },
  stageListingPhoto: async (_u: string, id: string, f: File) => `u1/declutter/${id}/${f.name}`,
  dropStagedPhotos: async () => undefined,
  setDropPct: async (_id: string, pct: number) => pct,
  fetchItemDropState: async () => null,
  updateDraft: async () => "ok",
  setPorchOk: async () => true,
  setKeepUp: async () => true,
  setHandovers: async (_id: string, ways: string[]) => ways,
  fetchItemHandovers: async () => null,
  addPhotoSteadily: async (_u: string, _id: string, f: File) => { state.photos.push({ id: `p-${f.name}`, storage_path: f.name }); return "p"; },
  removePhoto: async () => undefined,
  requestAiDraft: async () => ({}),
  requestAiDraftFromPhotos: async () => DRAFT,
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  requestAiCheckWithRetry: async () => ({ checked: true, flagged: false }),
  attestItem: async () => { state.calls.push("attest"); },
  publishItem: async () => { state.calls.push("publish"); return "live"; },
  setOfferRules: async () => undefined,
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { FIRST_SALE_WINDOWS } from "./FirstSalePickup";

function Landed() {
  const loc = useLocation();
  return <p data-testid="landed" data-search={loc.search}>Selling tab</p>;
}

function open(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/declutter/sell" element={<DeclutterSellPage />} />
          <Route path="/declutter" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

type Screen = "chooser" | "setup" | "one" | "live";
/** Which page the member is on, or null while it loads. */
function onScreen(): Screen | null {
  if (screen.queryByTestId("landed")) return "live";
  if (document.querySelector("[data-sell-chooser]")) return "chooser";
  if (document.querySelector("[data-seller-setup]")) return "setup";
  if (document.querySelector("[data-sell-one-screen]") && !(screen.getByRole("button", { name: "Post it" }) as HTMLButtonElement).disabled) return "one";
  return null;
}

/**
 * From the Sell button to a live listing, pressing only what the page requires, as a first-time seller would.
 * Returns the screens seen and every required action (a tap, a typed field, a photo picked).
 */
async function sellOneItem(): Promise<{ screens: Screen[]; actions: string[] }> {
  open(sectionByKey("declutter").add.path);
  const screens: Screen[] = [];
  const actions: string[] = [];
  for (let guard = 0; guard < 6; guard++) {
    let here: Screen | null = null;
    await waitFor(() => {
      here = onScreen();
      expect(here).not.toBeNull();
      expect(screens[screens.length - 1]).not.toBe(here);
    });
    const now = here as unknown as Screen;
    if (now === "live") return { screens, actions };
    screens.push(now);
    if (now === "chooser") {
      fireEvent.click(screen.getByText("One item"));
      actions.push("tap One item");
    } else if (now === "setup") {
      fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge, LA" } });
      actions.push("type the address");
      fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
      actions.push("tap a day");
      fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
      actions.push("tap Save and continue");
    } else {
      fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg")] } });
      actions.push("pick a photo");
      await screen.findByText("We wrote your listing. Check it before you post");
      const address = document.getElementById("first-sale-address") as HTMLInputElement | null;
      if (address) {
        fireEvent.change(address, { target: { value: "1 Main St, Baton Rouge, LA" } });
        actions.push("type the address");
      }
      fireEvent.click(document.getElementById("sell-tax")!);
      actions.push("tick the tax box");
      fireEvent.click(screen.getByRole("button", { name: "Post it" }));
      actions.push("tap Post it");
      await waitFor(() => expect(screen.queryByTestId("landed")).not.toBeNull(), { timeout: 3000 });
    }
  }
  throw new Error(`never reached a live listing: ${screens.join(" > ")}`);
}

beforeEach(() => {
  Object.assign(state, { places: [], savedPlaces: [], row: null, rows: [], windows: [], savedWindows: [], windowsFail: false, calls: [], photos: [] });
  vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID as ReturnType<typeof crypto.randomUUID>);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("listing one item is one screen (ease batch 11-20)", () => {
  it("a first-time seller: Sell -> one screen -> live, in 4 required actions (was 3 screens and 7)", async () => {
    const { screens, actions } = await sellOneItem();
    expect(screens).toEqual(["one"]);
    expect(actions).toEqual(["pick a photo", "type the address", "tick the tax box", "tap Post it"]);
    expect(actions).toHaveLength(4);
    // What the setup screen saved is saved here, before the listing: the address with its exact point, the times
    // shown on screen, and the setup screen's defaults (F124). Then the listing goes up as before.
    expect(state.savedPlaces[0]).toMatchObject({ label: "Home", area: "Baton Rouge", address: "1 Main St, Baton Rouge, LA", lat: 30.45123, lng: -91.15456, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(state.savedWindows).toEqual([FIRST_SALE_WINDOWS]);
    expect(state.rows[0]).toEqual(ROW);
    expect(state.calls.indexOf("defaults")).toBeLessThan(state.calls.indexOf("createDraft"));
    expect(state.calls.indexOf("windows")).toBeLessThan(state.calls.indexOf("publish"));
    expect(state.calls.indexOf("place")).toBeLessThan(state.calls.indexOf("createDraft"));
    expect(state.calls.filter((c) => c === "publish")).toHaveLength(1);
  });

  it("a returning seller (place, times and settings saved): 1 screen, 3 actions, and nothing is saved again", async () => {
    Object.assign(state, { places: [PLACE], windows: [WINDOW], row: ROW });
    const { screens, actions } = await sellOneItem();
    expect(screens).toEqual(["one"]);
    expect(actions).toEqual(["pick a photo", "tick the tax box", "tap Post it"]);
    expect(document.querySelector("[data-first-sale]")).toBeNull();
    expect(state.savedWindows).toEqual([]);
    expect(state.savedPlaces).toEqual([]);
    // (Post still remembers the listing choices, as before: that is useSellerDefaultsPrefill's rememberChoices, not the setup.)
  });

  it("the starting times are on screen before Post, and Change opens the editor (audit single-free #16: never a hidden promise)", async () => {
    open("/declutter/sell");
    await screen.findByRole("heading", { name: "Pickup" });
    expect(document.querySelector("[data-first-sale-times-line]")!.textContent).toBe("Every day 5:00 PM–8:00 PM");
    expect(document.querySelector("[data-first-sale-defaults]")!.textContent).toContain("porch pickup");
    expect(document.querySelector("[data-pickup-times]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(document.querySelector("[data-pickup-times]")).not.toBeNull();
    // A seller who takes every day off cannot post: the box says so.
    for (const d of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) fireEvent.click(screen.getByRole("button", { name: d }));
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg")] } });
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.change(document.getElementById("first-sale-address")!, { target: { value: "1 Main St, Baton Rouge, LA" } });
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    const problem = await screen.findByText("Pick at least one day and time buyers can come.");
    expect(problem.closest('[data-sell-row="pickup"]')).not.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("Give it away (?free=1) has no setup screen in front of it either", async () => {
    open("/declutter/sell?free=1");
    await screen.findByRole("heading", { name: "Pickup" });
    expect(document.querySelector("[data-seller-setup]")).toBeNull();
    expect(document.querySelector("[data-sell-one-screen]")).not.toBeNull();
  });

  it("a failed read of the saved times offers a retry, never a fresh setup over what is saved", async () => {
    Object.assign(state, { places: [PLACE], row: ROW, windowsFail: true });
    open("/declutter/sell");
    expect(await screen.findByText("We couldn't load your selling settings.")).toBeTruthy();
    expect(document.querySelector("[data-first-sale]")).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("the other ways to sell are one tap away on the screen", async () => {
    open("/declutter/sell");
    await screen.findByRole("heading", { name: "Show it off" });
    expect(document.querySelector("[data-sell-more-ways]")!.getAttribute("href")).toBe("/declutter/sell?mode=choose");
  });
});
