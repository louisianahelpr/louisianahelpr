/**
 * Sell a bunch's listing choices on screen (audit finding 9): the switches start from what the seller saved, both ON
 * with nothing saved; a Free tick takes the price box away and makes the item ready; the choices reach listBunch and
 * are remembered; pickup times already saved are not written over.
 *
 * @mutate src/components/declutter/DeclutterBunchView.tsx |   const ready = bunchListable(items, feeDue != null); |   const ready = bunchListable(items, false);
 * @mutate src/components/declutter/BunchChoices.tsx |     if (row) setChoices({ keepUp: row.keepUp, drops: row.drops, dropPct: row.dropPct, floorPct: row.floorPct, acceptsOffers: row.acceptsOffers, freeAfterDays: row.freeAfterDays }); |     void row;
 * @mutate src/components/declutter/BunchChoices.tsx |     if (ways.length > 0) setWays((w) => (w.length === 1 && w[0] === "porch" ? ways : w)); |     void ways;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       if (!samePickupWindows(windows, savedWindows.data ?? [])) await setPickupWindows(windows); |       await setPickupWindows(windows);
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       if (result.out.some((o) => "status" in o)) void choices.remember(savedWays); |       void result.out;
 * @mutate src/components/declutter/DeclutterBunchView.tsx | undefined, onStep, { ...choices.choices, moveOutOn: moveDate \|\| null }, | undefined, onStep,
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |           {!item.free && (\n            <div> |           {(\n            <div>
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |             <Checkbox aria-label={`Give ${name} away free`} checked={!!item.free} onCheckedChange={(v) => onChange({ free: v === true })} /> |             <Checkbox checked={!!item.free} />
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchChoices, BunchItem } from "@/lib/declutter/bunch";
import type { SellerDefaults } from "@/lib/declutter/sellerDefaults";
import type { MyPorchPlace } from "@/lib/declutter/porchPlaces";

const state = vi.hoisted(() => ({
  saved: null as SellerDefaults | null,
  remembered: [] as SellerDefaults[],
  windows: [] as { weekday: number; starts_local: string; ends_local: string }[],
  windowWrites: 0,
  listed: [] as { ways: string[]; choices: BunchChoices | undefined; items: BunchItem[]; place: unknown }[],
  feeDue: null as number | null,
  places: [] as MyPorchPlace[],

}));

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => <p>fair price hint</p> }));
vi.mock("@/components/declutter/BunchFeeGate", () => ({ BunchFeeGate: () => null, useSetupFeeDueCents: () => state.feeDue }));
vi.mock("@/components/declutter/BunchDraftsSection", () => ({ BunchDraftsSection: () => null }));
vi.mock("@/components/declutter/useBunchSaved", () => ({
  useBunchSaved: () => ({ note: null, restoredCount: 0, dismissRestored: () => {}, applyStep: () => {}, clearSaved: () => {} }),
}));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
const geocodeCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => { geocodeCalls.n++; return { status: "exact", lat: 30.4, lng: -91.1 }; } }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => state.places }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<object>()),
  fetchSellerDefaults: async () => state.saved,
  saveSellerDefaults: async (_u: string, d: SellerDefaults) => { state.remembered.push(d); return true; },
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyPickupWindows: async () => state.windows,
  setPickupWindows: async () => { state.windowWrites++; return 1; },
}));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[], onProgress: (done: number, total: number, made: BunchItem[]) => void) => {
      const items = [{ ...real.blankItem([photos[0].key, photos[1].key]), key: "i1", title: "Oak chair", description: "Solid.", category: "furniture", sizeUnknown: false }];
      onProgress(1, 1, items);
      return { items, failed: [], unusable: [] };
    },
    listBunch: async (_s: string, items: BunchItem[], _p: unknown, place: unknown, ways: string[], _op: unknown, _d: unknown, _st: unknown, choices?: BunchChoices) => {
      state.listed.push({ ways, choices, items, place });
      return items.map((i) => ({ key: i.key, title: i.title, status: "live" as const, keepUpFailed: true }));
    },
  };
});

import BunchFlow from "./DeclutterBunchView";

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
beforeEach(() => { state.saved = null; state.remembered = []; state.windows = []; state.windowWrites = 0; state.listed = []; state.feeDue = null; state.places = []; geocodeCalls.n = 0; });
afterEach(cleanup);

async function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
  const files = ["a", "b"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
  fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
  await screen.findByRole("heading", { name: /^3\. Check each item/ });
  await screen.findByRole("heading", { name: /^\d\. List/ });
}
const openRows = () => document.querySelectorAll<HTMLElement>('[data-bunch-expand][aria-expanded="false"]').forEach((b) => fireEvent.click(b));
const switchOf = (name: RegExp) => screen.getByRole("switch", { name });
const isOn = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";
const DROPS = /Lower the price/;
const KEEP = /Keep it up/;

async function listIt() {
  fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
  fireEvent.click(document.getElementById("bunch-tax")!);
  const list = await screen.findByRole("button", { name: "List 1 item" });
  await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(list);
  await waitFor(() => expect(state.listed).toHaveLength(1));
}

describe("Sell a bunch: listing choices", () => {
  // LEAD-BUNCH-PCT-LABEL (owner 2026-10-31): price drops start OFF until the seller turns them on.
  // @mutate src/components/declutter/BunchChoices.tsx | keepUp: SELLER_DEFAULTS.keepUp, drops: false, | keepUp: SELLER_DEFAULTS.keepUp, drops: SELLER_DEFAULTS.drops,
  it("nothing saved: drops start OFF and Keep it up ON, and they reach the listing and are remembered", async () => {
    await open();
    await waitFor(() => expect(isOn(switchOf(KEEP))).toBe(true));
    expect(isOn(switchOf(DROPS))).toBe(false);
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    await listIt();
    expect(state.listed[0].choices).toEqual({ keepUp: true, drops: false, dropPct: 5, floorPct: 50, moveOutOn: null });
    await waitFor(() => expect(state.remembered).toHaveLength(1));
    expect(state.remembered[0]).toMatchObject({ keepUp: true, drops: false, handovers: ["porch"] });
    expect(await screen.findByText(/didn't turn on for 1 item/)).toBeTruthy();
  });

  // LEAD-OFFERS-CHOICE part (2) (owner 2026-10-31): each item has its own Accept offers, starting from the saved default
  // (no box for the whole bunch); what the seller flips on an item is what that item lists with.
  // @mutate src/components/declutter/DeclutterBunchView.tsx |                   offersDefault={choices.choices.acceptsOffers} | 
  // @mutate src/components/declutter/DeclutterBunchCard.tsx | onCheckedChange={(v) => onChange({ acceptsOffers: v === true })} | onCheckedChange={() => {}}
  it("each item's Accept offers starts from the saved default, and the seller's flip is what that item lists with", async () => {
    state.saved = { keepUp: false, drops: false, dropPct: 15, floorPct: 70, freeAfterDays: null, handovers: ["porch"], acceptsOffers: false };
    await open();
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    openRows();
    const sw = await screen.findByRole("switch", { name: /^Accept offers for / });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    await listIt();
    expect(state.listed[0].choices?.acceptsOffers).toBe(false);
    expect(state.listed[0].items.map((it) => it.acceptsOffers)).toEqual([true]);
  });

  it("saved choices start the switches and the ways, and a switch the seller flips is what lists", async () => {
    state.saved = { keepUp: false, drops: false, dropPct: 15, floorPct: 70, freeAfterDays: 14, handovers: ["meetup"], acceptsOffers: true };
    await open();
    // Saved settings are one line (owner 2026-10-30), saying the price choice; no form, and they reach the listing.
    const line = await waitFor(() => { const el = document.querySelector("[data-bunch-list-saved]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    expect(line.textContent).toContain("Price drops: off.");
    expect(within(line).getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByText(/Tick every way that works for you/)).toBeNull();
    expect(screen.queryByRole("switch", { name: DROPS })).toBeNull();
    // LEAD-BUNCH-PCT-LABEL: the drops choice is findable from that line ("Change"), for this bunch.
    // @mutate src/components/declutter/DeclutterBunchListStep.tsx | {changingDrops && <BunchDropsSwitch c={choices} />} | {null}
    fireEvent.click(within(line).getByRole("button", { name: "Change" }));
    fireEvent.click(switchOf(DROPS));
    expect(line.textContent).toContain("Price drops: on, 15% each evening");
    fireEvent.click(switchOf(DROPS));
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    await listIt();
    // LEAD-OFFERS-CHOICE: the saved Accept offers reaches the run, as each item's starting choice.
    expect(state.listed[0].choices).toEqual({ keepUp: false, drops: false, dropPct: 15, floorPct: 70, acceptsOffers: true, moveOutOn: null, freeAfterDays: 14 }); // the saved "make it free after" reaches the listing (lead 11-01)
    expect(state.listed[0].ways).toEqual(["meetup"]);
    await waitFor(() => expect(state.remembered[0]?.freeAfterDays).toBe(14));
  });

  it("a saved pickup place fills it, one line says which, exact point, and first-timers still get the boxes", async () => {
    state.places = [
      { id: "p2", position: 2, label: "Mom's house", address: "2 Oak St, Baton Rouge, LA", area: "Garden District", lat: 30.2, lng: -91.2, weekdays: [6] },
      { id: "p1", position: 1, label: "Home", address: "1 Main St, Baton Rouge, LA", area: "Mid-City", lat: 30.45123, lng: -91.15456, weekdays: [0] },
    ];
    state.saved = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
    await open();
    const where = await waitFor(() => { const el = document.querySelector("[data-saved-pickup]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    expect(where.textContent).toContain("Pickup at Home, Mom's house. Buyers pick one.");
    expect(screen.queryByRole("heading", { name: /Where buyers pick up/ })).toBeNull();
    expect(screen.queryByLabelText("Pickup address")).toBeNull();
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    fireEvent.click(document.getElementById("bunch-tax")!);
    const list = await screen.findByRole("button", { name: "List 1 item" });
    await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(list);
    await waitFor(() => expect(state.listed).toHaveLength(1));
    // The place's own exact point, not the address looked up again (geocode mock answers 30.4, -91.1).
    expect(state.listed[0].place).toMatchObject({ areaLabel: "Mid-City", pickupAddress: "1 Main St, Baton Rouge, LA", pickupLat: 30.45123, pickupLng: -91.15456 });
    expect(geocodeCalls.n).toBe(0);
  });

  it("nothing saved: the area and address boxes show, with no saved-settings line", async () => {
    await open();
    expect(screen.getByLabelText("Pickup address")).toBeTruthy();
    expect(screen.queryByText("Using your saved settings")).toBeNull();
    expect(document.querySelector("[data-bunch-list-saved]")).toBeNull();
  });

  it("the Free tick takes the price box and hint away, says the rule, and the item is ready", async () => {
    await open();
    openRows();
    const card = document.querySelector("[data-bunch-item]") as HTMLElement;
    expect(within(card).getByText("fair price hint")).toBeTruthy();
    fireEvent.click(within(card).getByRole("checkbox", { name: /away free/ }));
    expect(within(card).queryByLabelText("Price ($)")).toBeNull();
    expect(within(card).queryByText("fair price hint")).toBeNull();
    expect(screen.getByRole("heading", { name: "3. Check each item (1 of 1 ready)" })).toBeTruthy();
    expect(document.querySelector("[data-bunch-free-note]")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: DROPS })).toBeNull();
    await listIt();
    expect(state.listed[0].items[0].free).toBe(true);
  });
});

describe("Sell a bunch while the setup fee is due", () => {
  it("a free item lists together with no fee (the server asks none at price 0); a priced one waits and is named", async () => {
    state.feeDue = 200;
    await open();
    openRows();
    const card = document.querySelector("[data-bunch-item]") as HTMLElement;
    fireEvent.change(within(card).getByLabelText("Price ($)"), { target: { value: "40" } });
    expect(screen.getByRole("heading", { name: "3. Check each item (1 of 1 ready)" })).toBeTruthy();
    expect(document.querySelector("[data-bunch-fee-held]")?.textContent).toContain("1 priced item waits for the setup fee above");
    expect((screen.getByRole("button", { name: "List 0 items" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(card).getByRole("checkbox", { name: /away free/ }));
    expect(document.querySelector("[data-bunch-fee-held]")).toBeNull();
    await listIt();
    expect(state.listed[0].items.map((i) => i.free)).toEqual([true]);
  });
});

describe("Sell a bunch: saved pickup times", () => {
  it("are not written again when the seller changed nothing", async () => {
    state.windows = [{ weekday: 2, starts_local: "17:00:00", ends_local: "19:00:00" }];
    await open();
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    await listIt();
    expect(state.windowWrites).toBe(0);
  });

  it("a seller with none saved gets the times on screen saved", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    await listIt();
    expect(state.windowWrites).toBe(1);
  });
});
