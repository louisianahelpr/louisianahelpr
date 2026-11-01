/**
 * "Remember my setup" (owner 2026-10-29): a NEW listing starts from the seller's last listing's
 * setup: the ways buyers get it, the area, the private pickup address and the price-drop step. Only
 * blank or default fields are filled, and a saved draft is never touched. Pickup times are per seller already (loaded as before).
 * The API is stubbed: this checks what the form does with the last setup.
 *
 * @mutate src/components/declutter/useSellFlowState.ts |   const usedLastSetup = useLastListingSetup(prefillFor, { setForm, setWays, setCoords }); |   const usedLastSetup = useLastListingSetup(undefined, { setForm, setWays, setCoords });
 * @mutate src/components/declutter/SellLastSetup.tsx |     areaLabel: f.areaLabel.trim() ? f.areaLabel : s.areaLabel, |     areaLabel: s.areaLabel,
 * @mutate src/components/declutter/SellLastSetup.tsx |     ...(s.dropPct !== null && !f.drops ? { drops: true, dropPct: s.dropPct } : {}), |
 * @mutate src/components/declutter/SellLastSetup.tsx |     if (s.ways.length > 0) setWays((w) => (w.length === 1 && w[0] === "porch" ? s.ways : w)); |
 * Remembered choices and the ON defaults (owner 2026-10-30; describe block at the bottom).
 * @mutate src/lib/declutter/sellerDefaults.ts | { keepUp: true, drops: true, dropPct: 5, | { keepUp: false, drops: true, dropPct: 5,
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       setWays(() => row.handovers); |       void 0;
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       setWays(() => row.handovers);\n    } else { |       setWays(() => row.handovers);\n      setForm((f) => ({ ...f, drops: true }));\n    } else {
 * A $1 listing: drops don't apply, no error, nothing remembered as off (lead 2026-10-30).
 * @mutate src/components/declutter/sellForm.ts |   const dropsApply = f.drops && !priceTooLowForDrops(f.price); |   const dropsApply = f.drops;
 * @mutate src/components/declutter/sellForm.ts |   if (!f.drops \|\| priceTooLowForDrops(f.price)) return { floorCents: price, dropPct: 0 }; |   if (!f.drops) return { floorCents: price, dropPct: 0 };
 * @mutate src/components/declutter/SellFormParts.tsx |   const on = form.drops && !tooLow; |   const on = form.drops;
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       drops: form.drops, |       drops: form.drops && Number(form.price) > 1,
 * @mutate src/lib/declutter/sellerDefaults.ts | Math.min(Math.ceil(p) - 1, | Math.min(Math.floor(p) - 1,
 * @mutate src/components/declutter/useSellFlowState.ts |       if (!urlItemId) void prefs.rememberChoices(keepUpWanted, autoFreeWanted);\n |       \n
 * @mutate src/lib/declutter/sellerDefaults.ts | Math.round((p * floorPct) / 100) | Math.round(p)
 * The sell chooser's "Give it away free" (?free=1, owner 2026-10-30) starts a new listing as Free (describe block at the bottom).
 * @mutate src/components/declutter/useSellFlowState.ts | useState<FormState>(() => (!urlItemId && startsFree(params) ? { ...EMPTY, free: true } : EMPTY)) | useState<FormState>(EMPTY)
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LastSetup } from "@/lib/declutter/lastSetup";
import { floorFromPct, type SellerDefaults } from "@/lib/declutter/sellerDefaults";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY } from "./sellForm";
import { SellDropsCard } from "./SellFormParts";

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
const PLACE = { id: "p1", position: 1, label: "Home", address: "100 Main Street, Baton Rouge", area: "Mid-City", lat: 30.4, lng: -91.1, weekdays: [6] };

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
const places = vi.hoisted(() => ({ value: [] as unknown[] }));
// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => places.value, fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
// Whether a photo can be prepared is a browser matter (jsdom has no canvas): "bad*" can't.
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  cleanListingPhoto: async (f: File) => {
    if (f.name.startsWith("bad")) throw new (await import("@/lib/declutter/errors")).ListingPhotoError("We couldn't prepare this photo.");
    return f;
  },
}));
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
const geocode = vi.fn(async (): Promise<unknown> => ({ status: "exact", lat: 1, lng: 1 }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: () => geocode() }));
const here = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: here.fn }));
const analyticsTrack = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ track: analyticsTrack }));
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
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  createDraft: async (f: Record<string, unknown>) => { drafts.push(f); return NEW_ID; },
  setDropPct: async (_id: string, pct: number) => pct,
  fetchItemDropState: async () => null,
  updateDraft: async () => "ok",
  setHandovers: vi.fn(async (_id: string, ways: string[]) => ways),
  fetchItemHandovers: async () => null,
  addPhotoSteadily: async () => "p",
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

function open(url = "/declutter/sell") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
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


describe("posting says what the settings will do, and asks nothing (owner 2026-10-30)", () => {
  beforeEach(() => {
    drafts.length = 0;
    geocode.mockClear();
    places.value = [];
    last.value = LAST;
    remembered.value = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
  });
  afterEach(() => {
    places.value = [];
    last.value = LAST;
    remembered.value = null;
  });

  it("no switches or address boxes; what will happen is said before Post, with a link to Settings; the tax box stays", async () => {
    open();
    await addPhotoAndWait();
    expect(screen.queryByRole("switch", { name: /Lower the price over time/ })).toBeNull();
    expect(screen.queryByLabelText("Pickup address")).toBeNull();
    expect(document.querySelector("[data-auto-free]")).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: on, 5% each evening, never below $23."));
    expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Make it free: never.");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/declutter/settings");
    expect(document.getElementById("sell-tax")).not.toBeNull();
  });

  it("drops saved off: the line before Post says off", async () => {
    remembered.value = { keepUp: true, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toMatch(/Price drops: off\. It stays at \$\d+/));
  });

  it("a saved place beats the last listing's address, says which, and its exact point is sent", async () => {
    places.value = [{ id: "p1", position: 1, label: "Home", address: "9 Saved Pl, Baton Rouge, LA", area: "Mid-City", lat: 30.45123, lng: -91.15456, weekdays: [6] }];
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(document.querySelector("[data-saved-pickup]")?.textContent).toBe("Pickup at Home"));
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(drafts).toHaveLength(1));
    expect(drafts[0]).toMatchObject({ areaLabel: "Mid-City", pickupAddress: "9 Saved Pl, Baton Rouge, LA", pickupLat: 30.45123, pickupLng: -91.15456 });
    expect(geocode).not.toHaveBeenCalled();
  });
});

describe("a new listing remembers the last listing's setup", () => {
  beforeEach(() => {
    drafts.length = 0;
    last.value = LAST;
    geocode.mockClear();
    geocode.mockResolvedValue({ status: "exact", lat: 1, lng: 1 });
    vi.mocked(api.setHandovers).mockClear();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("fills the ways, area, pickup address and drop step, says so, and saves them", async () => {
    open();
    await addPhotoAndWait();
    // The drop step comes along as the seller set it last time.
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("10% each evening"));
    expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain(LAST.areaLabel);
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(api.setHandovers).toHaveBeenCalledWith(NEW_ID, ["porch", "meetup"]));
    // The remembered point is used as is: the address is not looked up again.
    expect(geocode).not.toHaveBeenCalled();
    expect(drafts[0]).toMatchObject({ areaLabel: LAST.areaLabel, pickupAddress: LAST.pickup!.address, pickupLat: 30.45, pickupLng: -91.15 });
  });

  it("only blank fields are filled; drops stay off when the last listing had them off", () => {
    const typed = { ...EMPTY, areaLabel: "Garden District", pickupAddress: "1 Elm Street" };
    expect(applyLastSetup(typed, LAST)).toMatchObject({ areaLabel: "Garden District", pickupAddress: "1 Elm Street", drops: true, dropPct: 10 });
    expect(applyLastSetup(EMPTY, { ...LAST, dropPct: null })).toMatchObject({ drops: false, areaLabel: LAST.areaLabel });
  });
});

// Owner 2026-10-30 (via the lead): "Keep it up until it sells" and "Lower the price" are ON by default, with a
// lowest price of half the asking price so it is valid without typing; the seller's choices are remembered on the
// account (declutter_seller_defaults) and pre-fill the next listing; the two switches sit together.
describe("a new listing starts from the seller's remembered choices", () => {
  beforeEach(() => {
    drafts.length = 0;
    last.value = null;
    places.value = [];
    remembered.value = null;
    remembered.saves.length = 0;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("nothing saved yet: keep it up ON, drops ON at 5%, lowest price half the asking price, and Post remembers it", async () => {
    places.value = [PLACE];
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: on, 5% each evening, never below $23."));
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(remembered.saves).toHaveLength(1));
    expect(remembered.saves[0]).toEqual({ keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true });
    expect(drafts[0]).toMatchObject({ priceCents: 4500, floorPriceCents: 2300 });
  });

  it("a saved row sets the step, the lowest price's share, free-after and the ways", async () => {
    places.value = [PLACE];
    remembered.value = { keepUp: false, drops: true, dropPct: 15, floorPct: 60, freeAfterDays: 14, handovers: ["porch", "meetup"], acceptsOffers: true };
    open();
    await addPhotoAndWait();
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: on, 15% each evening, never below $27."));
    expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Make it free: after 14 days");
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(api.setHandovers).toHaveBeenCalledWith(NEW_ID, ["porch", "meetup"]));
  });

  it("a $1 listing posts without an error: drops off for it, and the seller's choice stays remembered as on", async () => {
    places.value = [PLACE];
    open();
    await addPhotoAndWait();
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "1" } });
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: off."));
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(remembered.saves).toHaveLength(1));
    expect(drafts[0]).toMatchObject({ priceCents: 100, floorPriceCents: 100 });
    expect(remembered.saves[0]).toMatchObject({ drops: true, floorPct: 50 });
  });

  it("a saved draft's drops card at $1: off, can't be turned on, and says why", () => {
    const s = { form: { ...EMPTY, price: "1", drops: true }, setForm: () => {}, set: () => {}, priceCents: 100, floorCents: null } as unknown as Parameters<typeof SellDropsCard>[0]["s"];
    render(<SellDropsCard s={s} />);
    const sw = screen.getByRole("switch", { name: /Lower the price over time/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toBeDisabled();
    expect(screen.getByText(/nothing lower to drop to/)).toBeInTheDocument();
  });

  it("the filled-in lowest price is always at least $1 and below the price", () => {
    expect(floorFromPct("1", 50)).toBe("");
    expect(floorFromPct("1.50", 50)).toBe("1");
    expect(floorFromPct("2", 50)).toBe("1");
    expect(floorFromPct("3", 95)).toBe("2");
    expect(floorFromPct("45", 50)).toBe("23");
  });

});

// The sell chooser's "Give it away free" (owner 2026-10-30): /declutter/sell?free=1 is the same one screen with Free
// already on, and Post lists it at price 0. Without the param a new listing is priced as before (the tests above).
describe("Give it away free (?free=1)", () => {
  beforeEach(() => {
    drafts.length = 0;
    last.value = LAST;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("starts with Free on and posts at price 0, even after Claude suggests a price", async () => {
    open("/declutter/sell?free=1");
    await addPhotoAndWait();
    expect(document.querySelector("[data-sell-free-note]")).not.toBeNull();
    // Nothing is sold, so the box says so (audit single-free #14; the server keeps the same record).
    const box = document.querySelector("[data-tax-statements]")!;
    expect(box.textContent).toBe("I own this, it's from my own household, I don't do this as a business, and I'll keep it until it's picked up.");
    expect(document.querySelector("[data-sell-tax]")!.textContent).not.toMatch(/\b(sale|sell|selling|buyer)\b/i);
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(drafts).toHaveLength(1));
    expect(drafts[0]).toMatchObject({ priceCents: 0 });
  });

  // LEAD-FREE-MOVE (owner 2026-10-31): free is picked on the chooser's first screen, never ticked on the Price row.
  // @mutate src/components/declutter/SellOneScreen.tsx | priceExtras={form.free ? <div className="pt-1"><SellFreeNote /></div> : <div className="pt-1"><SellOffersToggle s={s} /></div>} | priceExtras={<div className="pt-1" data-sell-free="">Give it away free</div>}
  it("the one screen has no Give it away free tick; a free listing can still go back to a price", async () => {
    open("/declutter/sell");
    await addPhotoAndWait();
    expect(document.querySelector("[data-sell-free]")).toBeNull();
    expect(screen.queryByText("Give it away free")).toBeNull();
    cleanup();
    open("/declutter/sell?free=1");
    await addPhotoAndWait();
    expect(document.querySelector("[data-sell-free]")).toBeNull();
    expect(screen.getByRole("button", { name: "Charge for it" })).toBeTruthy();
  });

  it("a saved draft (?item=) is never switched to Free by the param", () => {
    const src = readFileSync(join(process.cwd(), "src/components/declutter/useSellFlowState.ts"), "utf8");
    expect(src).toMatch(/!urlItemId && startsFree\(params\)/);
  });
});
