/**
 * Porch pickup places, the screens (D-NEW14; server proof: src/test/pglite/declutterPorchPlaces.pglite.mjs). The seller
 * saves a place with its days, the geocoded point going to the server; once there is one, the single porch-day chips
 * step aside. The buyer picks a place before Pay opens, sees no address before paying, and a seller's paid order says
 * which place to put the item out at.
 *
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | ready: (!q.isLoading \|\| waitedOut) && (places.length > 0 ? places.some((p) => p.chosen) : !refused) | ready: true
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | ready: (!q.isLoading \|\| waitedOut) && ( | ready: !q.isLoading && (
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | ready: (!q.isLoading \|\| waitedOut) && (places.length > 0 ? places.some((p) => p.chosen) : !refused) | ready: !q.isLoading \|\| waitedOut
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |             if (needsPlace) void porchPlaces.reread(err);\n |
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |       if (atPlace) void porchPlaces.reread(err);\n |
 * @mutate src/components/declutter/SellFormParts.tsx |     {hasPlaces && <SavedPlacesComeFirst free={form.free} />}\n |
 * @mutate src/components/declutter/SellFormParts.tsx | {hasPlaces\n          ? (form.free | {false\n          ? (form.free
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx |     await qc.cancelQueries({ queryKey: key, exact: true });\n |
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | raceVisibleDeadlineAbortable((s) => fetchSellerPorchPlaces(sellerId, s), PORCH_PLACES_READ_MS, PORCH_PLACES_SLOW, signal) | fetchSellerPorchPlaces(sellerId, signal)
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | places.length > 0 ? places.some((p) => p.chosen) : !refused | places.length === 0 \|\| places.some((p) => p.chosen)
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx |     if (r.isSuccess && (r.data === PORCH_PLACES_NOT_DEPLOYED \|\| r.data.length === 0)) setRefused(false);\n |
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | {free ? "You get the exact address once you confirm." : "You get the exact address after you pay."} | {"You get the exact address after you pay."}
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx |       setRefused(true);\n      // The server has no pick for this cart: the one place is sent again.\n      sent.current = null; |       setRefused(true);
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | places={porchPlaces.places} free refused | places={porchPlaces.places} refused
 * @mutate src/components/declutter/SellHandoverChoices.tsx |       <SellPorchPlaces free={free} helprOnly={!free && !ways.includes("porch")} />\n |
 * @mutate src/components/declutter/SellFormParts.tsx | {hasPlaces ? (form.free ? PICKUP_TIMES_FREE_WITH_PLACES : PICKUP_TIMES_WITH_PLACES) : "Buyers pick one of these times. They apply to all your listings."} | {"Buyers pick one of these times. They apply to all your listings."}
 * @mutate src/components/declutter/SellPorchPlaces.tsx |       {places.length > 0 && <p className="text-ds-13 text-muted-foreground" data-place-days-rule="">{PLACE_DAYS_RULE}</p>}\n |
 * @mutate src/components/declutter/SellPorchPlaces.tsx | export const PLACE_CARD_EDGE = "dark:!border-border"; | export const PLACE_CARD_EDGE = "";
 * @mutate src/components/declutter/SellPorchPlaces.tsx |             <Pencil className="h-[18px] w-[18px]" aria-hidden="true" /> |             Edit
 * @mutate src/components/declutter/SellPorchPlaces.tsx |   "inline-flex min-h-11 min-w-11 items-center | "inline-flex items-center
 * @mutate src/components/declutter/SellPorchPlaces.tsx |       <div className="flex items-start gap-2"> |       <div className="space-y-2">
 * @mutate src/components/declutter/SellHandoverChoices.tsx | on ? "border-[hsl(var(--bark))] dark:!border-[hsl(var(--bark))]" : `border-border ${PLACE_CARD_EDGE}` | on ? "border-[hsl(var(--bark))]" : "border-border"
 * @mutate src/components/declutter/DeclutterHomeView.tsx | Listing defaults, pickup places, pickup times, delivery | Listing defaults, pickup times, delivery
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | {side === "seller" && place.address ? <> ({place.address})</> : null} | {place.address ? <> ({place.address})</> : null}
 * @mutate src/components/declutter/SellPorchPlaces.tsx | lat: point.lat, lng: point.lng | lat: 0, lng: 0
 * @mutate src/components/declutter/SellPorchPlaces.tsx | : places.length < MAX_PORCH_PLACES && ( | : (
 * @mutate src/components/declutter/SellPorchDays.tsx |   if (Array.isArray(places.data) && places.data.length > 0) return null; |
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | (sellerDelivering && !sdReady) \|\| !meetupReady \|\| !placeReady \|\| | (sellerDelivering && !sdReady) \|\| !meetupReady \|\|
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | disabled={confirm.isPending \|\| offered.length === 0 \|\| !placeReady} | disabled={confirm.isPending \|\| offered.length === 0}
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.handover === "porch" && <OrderPorchPlace orderId={order.orderId} side={order.side} />}\n |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  lookup: vi.fn(),
  usual: { data: [], error: null } as { data: unknown; error: unknown },
  toastError: vi.fn(),
}));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
// The usual pickup times (fetchMyPickupWindows): h.usual (none by default, so a new place starts at Sat 9-12).
const usualTimes = { select: () => usualTimes, eq: () => usualTimes, order: () => Promise.resolve(h.usual) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: () => usualTimes } }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: h.lookup }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "seller-1" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: h.toastError, success: vi.fn() }) }));

import { SellPorchPlaces } from "./SellPorchPlaces";
import { ItemPickupPlaces } from "./ItemPickupDisplay";
import { SellWaysFields } from "./SellFormParts";
import type { SellFlow } from "./useSellFlowState";
import { SellPorchDays } from "./SellPorchDays";
import { OrderPorchPlace, PORCH_PLACES_READ_MS, PORCH_PLACES_WAIT_MS, PorchPlacePicker, useSellerPorchPlaces } from "./DeclutterPorchPlaces";
import { SellHandoverChoices } from "./SellHandoverChoices";
import { fetchMyPorchPlaces } from "@/lib/declutter/porchPlaces";

const HOME = { id: "p1", position: 0, label: "Home", address: "12 Home Street, Lafayette", area: "Lafayette", lat: 30.2, lng: -92, weekdays: [6, 0] };
const place = (n: number) => ({ ...HOME, id: `p${n}`, position: n, label: `Place ${n}` });
const SRC = (f: string) => blankComments(readFileSync(join(process.cwd(), "src/components/declutter", f), "utf8"));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
/** `answers`: the RPC name -> its rows. */
function answers(map: Record<string, unknown>) {
  h.rpc.mockImplementation((name: string) => builder(Promise.resolve(name in map ? { data: map[name], error: null } : { data: null, error: { message: `unexpected ${name}` } })));
}
/** What supabase.rpc() returns, as far as these reads use it: awaitable, and can take an abort signal. */
function builder<T>(p: Promise<T>) {
  return Object.assign(p, { abortSignal: () => p });
}

function Checkout({ sellerId = "s1" }: { sellerId?: string }) {
  const p = useSellerPorchPlaces(sellerId, 1000);
  return (<>
    <PorchPlacePicker sellerId={sellerId} cartKey={1000} places={p.places} loadError={p.query.error} onRetry={() => void p.query.refetch()} />
    <button type="button" disabled={!p.ready}>Pay</button>
  </>);
}

beforeEach(() => {
  h.rpc.mockReset();
  h.lookup.mockReset();
  h.toastError.mockReset();
  h.usual = { data: [], error: null };
});

describe("the seller's pickup places", () => {
  it("adds a place: the exact point, the city as its area and the days go to the server", async () => {
    answers({ declutter_my_porch_places: [], declutter_save_porch_place: "new-id" });
    h.lookup.mockResolvedValue({ status: "exact", lat: 29.95, lng: -90.07 });
    wrap(<SellPorchPlaces />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a pickup place" }));
    const save = screen.getByRole("button", { name: "Save place" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Camp " } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "99 Camp Road, New Orleans" } });
    // LEAD-PLACE-TIMES: a new place starts from the usual pickup times (none read here: Sat 9-12), set with the hours editor.
    expect(screen.getByRole("group", { name: "Days and hours at this place" })).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_save_porch_place", expect.objectContaining({
      p_place_id: null, p_label: "Camp", p_address: "99 Camp Road, New Orleans", p_area: "New Orleans", p_lat: 29.95, p_lng: -90.07, p_weekdays: [6],
      p_windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }],
    })));
  });

  it("an address the map can't find saves nothing", async () => {
    answers({ declutter_my_porch_places: [] });
    h.lookup.mockResolvedValue({ status: "not_found" });
    wrap(<SellPorchPlaces />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a pickup place" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Camp" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "nowhere at all" } });
    fireEvent.click(screen.getByRole("button", { name: "Save place" }));
    await waitFor(() => expect(h.lookup).toHaveBeenCalled());
    expect(h.rpc).not.toHaveBeenCalledWith("declutter_save_porch_place", expect.anything());
  });

  it("five places: no more can be added", async () => {
    answers({ declutter_my_porch_places: [0, 1, 2, 3, 4].map(place) });
    wrap(<SellPorchPlaces />);
    expect(await screen.findByText("Place 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a pickup place" })).toBeNull();
    expect(await fetchMyPorchPlaces()).toHaveLength(5); // inventory floor: the fixture really holds the cap
  });

  it("Edit and Remove are icon buttons on the right, level with the name, 44 px (LEAD-PLACE-ICONS)", async () => {
    answers({ declutter_my_porch_places: [HOME, place(1)] });
    wrap(<SellPorchPlaces />);
    const edits = [await screen.findByRole("button", { name: "Edit Home" }), screen.getByRole("button", { name: "Edit Place 1" })];
    expect(edits).toHaveLength(2); // inventory floor: one row per saved place
    for (const name of ["Home", "Place 1"]) {
      for (const verb of ["Edit", "Remove"]) {
        const b = screen.getByRole("button", { name: `${verb} ${name}` });
        expect(b.textContent).toBe(""); // icon only, no word
        expect(b.querySelector("svg")).not.toBeNull();
        expect(b.className).toMatch(/\bmin-h-11\b/);
        expect(b.className).toMatch(/\bmin-w-11\b/);
        // Same row as the name, after it (the right side), top-aligned.
        const row = b.closest("[data-place-actions]")!.parentElement!;
        expect(row.className).toMatch(/\bflex\b/);
        expect(row.className).toMatch(/\bitems-start\b/);
        expect(row.firstElementChild!.textContent).toContain(name);
        expect(row.lastElementChild).toBe(b.closest("[data-place-actions]"));
      }
    }
  });

  // Review 2026-10-31 (item 8): the usual times a new place starts from are read first; a failed read is said with a retry.
  // @mutate src/components/declutter/SellPorchPlaces.tsx |         : places.length < MAX_PORCH_PLACES && (usualRead.isError | : places.length < MAX_PORCH_PLACES && (false
  it("a failed read of the usual times says so with a retry, never a silent Sat 9-12", async () => {
    answers({ declutter_my_porch_places: [] });
    h.usual = { data: null, error: { message: "boom" } };
    wrap(<SellPorchPlaces />);
    expect(await screen.findByText("We couldn't load your usual pickup times.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a pickup place" })).toBeNull();
  });

  // Review 2026-10-31 (item 7): an older server takes the days alone; the seller is told the hours were not saved.
  // @mutate src/components/declutter/SellPorchPlaces.tsx |       if (!r.hoursSaved) toast.error(PLACE_HOURS_NOT_SAVED); |
  // @mutate src/lib/declutter/porchPlaces.ts |     return { id, hoursSaved: false }; |     return { id, hoursSaved: true };
  it("an older server saves the days alone: the seller is told the hours were not saved", async () => {
    h.lookup.mockResolvedValue({ status: "exact", lat: 29.95, lng: -90.07 });
    h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => builder(Promise.resolve(
      name === "declutter_my_porch_places" ? { data: [], error: null }
        : name === "declutter_save_porch_place" && "p_windows" in args ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
          : { data: "new-id", error: null })));
    wrap(<SellPorchPlaces />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a pickup place" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Camp" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "99 Camp Road, New Orleans" } });
    fireEvent.click(screen.getByRole("button", { name: "Save place" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Place saved, but not its hours. Update the app, then set its hours again."));
    expect(h.rpc.mock.calls.filter(([n]) => n === "declutter_save_porch_place")).toHaveLength(2);
  });

  // Review 2026-10-31: the item page's places read failing says so with a retry.
  // @mutate src/components/declutter/ItemPickupDisplay.tsx |   if (read.isError) { |   if (false) {
  it("the item page's places: a failed read says so with a retry", async () => {
    answers({});
    wrap(<ItemPickupPlaces itemId="i1" />);
    expect(await screen.findByText("We couldn't load the pickup places.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("removing asks first, then deletes that place", async () => {
    answers({ declutter_my_porch_places: [HOME], declutter_delete_porch_place: "p1" });
    wrap(<SellPorchPlaces />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Home" }));
    expect(h.rpc).not.toHaveBeenCalledWith("declutter_delete_porch_place", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "Remove place" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_delete_porch_place", { p_place_id: "p1" }));
  });

  it("a failed read says so; a server without the feature shows nothing", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_my_porch_places" } });
    const { container } = wrap(<SellPorchPlaces />);
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-porch-places]")).toBeNull();
  });

  it("the single porch-day chips step aside once a place is saved", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const { container, unmount } = wrap(<SellPorchDays pickupDays={[2]} />);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_my_porch_places"));
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector("[data-porch-days]")).toBeNull();
    unmount();
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [] });
    const second = wrap(<SellPorchDays pickupDays={[2]} />);
    await waitFor(() => expect(second.container.querySelector("[data-porch-days]")).not.toBeNull());
  });
});

describe("the buyer's pick", () => {
  const OPTIONS = [
    { id: "p1", label: "Home", area: "Lafayette", weekdays: [6], chosen: false },
    { id: "p2", label: "Camp", area: "New Orleans", weekdays: [0], chosen: false },
  ];

  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |             <span className="block text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.area}</span> |             <span className="block text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.label}</span>
  it("Pay waits for a pick; the pick goes to the server; no address before paying", async () => {
    answers({ declutter_seller_porch_places: OPTIONS, declutter_set_porch_place: "p2" });
    const { container } = wrap(<Checkout />);
    fireEvent.click(await screen.findByRole("radio", { name: /New Orleans/ }));
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_set_porch_place", { p_seller_id: "s1", p_place_id: "p2" }));
    expect(container.textContent).not.toMatch(/Street|Road/);
    // Owner 2026-10-31: the city only, never the place's own label, even from an older server that still sends it.
    expect(container.textContent).not.toMatch(/Home|Camp/);
    answers({ declutter_seller_porch_places: OPTIONS.map((o) => ({ ...o, chosen: o.id === "p2" })) });
  });

  // Lead 10-30: a first-timer's address is one place named "Home"; a buyer had to pick it from a list of one.
  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |     if (!needed \|\| !only \|\| only.chosen \|\| sent.current === only.id) return; |     return;
  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |   const places = only ? [{ ...only, chosen: true }] : read; |   const places = read;
  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |   if (places.length === 1) {\n    const p = places[0]; |   if (false) {\n    const p = places[0];
  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |         <p className="text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.area}</p> |         <p className="text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.label}</p>
  describe("a seller with exactly one place", () => {
    const ONE = [{ id: "p1", label: "Home", area: "Lafayette", weekdays: [6], chosen: false, address: "12 Home Street, Lafayette" }];

    it("a refused checkout sends the one place again; any other error doesn't", async () => {
      answers({ declutter_seller_porch_places: ONE, declutter_set_porch_place: "p1" });
      const picks = () => h.rpc.mock.calls.filter(([n]) => n === "declutter_set_porch_place").length;
      const reads = () => h.rpc.mock.calls.filter(([n]) => n === "declutter_seller_porch_places").length;
      function Refusable() {
        const p = useSellerPorchPlaces("s1", 1000);
        return (<>
          <button type="button" onClick={() => void p.reread({ message: "item_not_available" })}>Other error</button>
          <button type="button" onClick={() => void p.reread({ message: "porch_place_needed" })}>Refused</button>
        </>);
      }
      wrap(<Refusable />);
      await waitFor(() => expect(picks()).toBe(1));
      await waitFor(() => expect(reads()).toBe(2));
      fireEvent.click(screen.getByRole("button", { name: "Other error" }));
      await waitFor(() => expect(reads()).toBe(3));
      expect(picks()).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "Refused" }));
      await waitFor(() => expect(picks()).toBe(2));
    });

    it("it is picked for the buyer, the server gets the pick, Pay is open, and no address or list shows", async () => {
      answers({ declutter_seller_porch_places: ONE, declutter_set_porch_place: "p1" });
      const one = wrap(<Checkout />);
      await screen.findByText("Lafayette");
      expect(one.container.textContent).not.toContain("Home");
      expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(document.body.textContent).toContain("Lafayette");
      expect(document.body.textContent).not.toContain("12 Home Street");
      await waitFor(() => expect(h.rpc.mock.calls.filter(([n]) => n === "declutter_set_porch_place")).toHaveLength(1));
      expect(h.rpc.mock.calls.find(([n]) => n === "declutter_set_porch_place")![1]).toEqual({ p_seller_id: "s1", p_place_id: "p1" });
    });

    it("nothing is sent while no place is needed (the buyer chose another way)", async () => {
      answers({ declutter_seller_porch_places: ONE, declutter_set_porch_place: "p1" });
      function Elsewhere() {
        const p = useSellerPorchPlaces("s1", 1000, false);
        return <p>{p.places.length} place</p>;
      }
      wrap(<Elsewhere />);
      await screen.findByText("1 place");
      await new Promise((r) => setTimeout(r, 20));
      expect(h.rpc.mock.calls.filter(([n]) => n === "declutter_set_porch_place")).toHaveLength(0);
    });

    // @mutate src/components/declutter/DeclutterTradeViews.tsx |             await porchPlaces.whenPicked();\n            const res = await startCheckoutPayment( |             const res = await startCheckoutPayment(
    // @mutate src/components/declutter/DeclutterFreeClaim.tsx |       await porchPlaces.whenPicked();\n |
    it("paid checkout, a delivery price and the free claim wait for that pick before they call the server", () => {
      expect(SRC("DeclutterTradeViews.tsx")).toMatch(/await porchPlaces\.whenPicked\(\);\s+const res = await startCheckoutPayment/);
      expect(SRC("DeclutterTradeViews.tsx")).toMatch(/await porchPlaces\.whenPicked\(\);\s+return fetchDeliveryQuote/);
      expect(SRC("DeclutterFreeClaim.tsx")).toMatch(/await porchPlaces\.whenPicked\(\);\s+return checkoutFree/);
    });
  });

  it("a chosen place opens Pay", async () => {
    answers({ declutter_seller_porch_places: OPTIONS.map((o) => ({ ...o, chosen: o.id === "p1" })) });
    wrap(<Checkout />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled());
  });

  it("a seller with no places: no picker and Pay is open", async () => {
    answers({ declutter_seller_porch_places: [] });
    const { container } = wrap(<Checkout />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled());
    expect(container.querySelector("[data-porch-place-picker]")).toBeNull();
  });

  describe("a slow read", () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });
    /** Answers declutter_seller_porch_places only when `answer` is called; until then the read hangs, as a stalled connection does. */
    function hanging() {
      let answer: (rows: unknown[]) => void = () => undefined;
      h.rpc.mockImplementation(() => builder(new Promise((resolve) => { answer = (rows) => resolve({ data: rows, error: null }); })));
      return (rows: unknown[]) => answer(rows);
    }

    it("holds Pay only for its short wait, however long the read hangs", async () => {
      hanging();
      wrap(<Checkout />);
      const pay = screen.getByRole("button", { name: "Pay" });
      expect(pay).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_WAIT_MS - 100); });
      expect(pay).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(pay).toBeEnabled();
      expect(PORCH_PLACES_WAIT_MS).toBeLessThanOrEqual(5000);
    });

    it("if the late read brings places, Pay waits for the pick again", async () => {
      const answer = hanging();
      const { container } = wrap(<Checkout />);
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_WAIT_MS + 100); });
      expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
      await act(async () => { answer(OPTIONS); await vi.advanceTimersByTimeAsync(10); });
      expect(container.querySelector("[data-porch-place-picker]")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    });
  });

  describe("a read that never answers", () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });
    const NEEDED = { message: "porch_place_needed" };
    function Refusable() {
      const p = useSellerPorchPlaces("s1", 1000);
      return (<>
        <PorchPlacePicker sellerId="s1" cartKey={1000} places={p.places} loadError={p.query.error} refused={p.refused} onRetry={() => void p.reread()} />
        <button type="button" disabled={!p.ready} onClick={() => void p.reread(NEEDED)}>Pay</button>
      </>);
    }
    const stallThenAnswer = (rows: unknown[]) => {
      let calls = 0;
      h.rpc.mockImplementation(() => { calls += 1; return builder(calls === 1 ? new Promise(() => undefined) : Promise.resolve({ data: rows, error: null })); });
      return () => calls;
    };

    it("is given up on, so it says so instead of hanging for good", async () => {
      h.rpc.mockImplementation(() => builder(new Promise(() => undefined)));
      wrap(<Refusable />);
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_READ_MS + 100); });
      expect(screen.getByText("We couldn't load the pickup places.")).toBeInTheDocument();
      expect(screen.getByText(/taking too long/)).toBeInTheDocument();
      expect(PORCH_PLACES_READ_MS).toBeLessThanOrEqual(10_000);
    });

    it("a refused checkout starts a NEW read while the old one still hangs: the picker shows and Pay waits", async () => {
      const calls = stallThenAnswer(OPTIONS);
      const { container } = wrap(<Refusable />);
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_WAIT_MS + 100); });
      const pay = screen.getByRole("button", { name: "Pay" });
      expect(pay).toBeEnabled();
      expect(calls()).toBe(1);
      fireEvent.click(pay);
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(calls()).toBe(2);
      expect(container.querySelector("[data-porch-place-picker]")).not.toBeNull();
      expect(pay).toBeDisabled();
      expect(screen.getByRole("alert").textContent).toBe("Pick which of the seller's pickup places you'll use.");
    });

    it("the refusal stays on screen while the new read is out, and Pay waits", async () => {
      h.rpc.mockImplementation(() => builder(new Promise(() => undefined)));
      wrap(<Refusable />);
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_WAIT_MS + 100); });
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(screen.getByRole("status").textContent).toContain("Pick which of the seller's pickup places you'll use.");
      expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
      // Past the short wait, and past the new read giving up: the server already said no, so Pay stays off, with Try again.
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_WAIT_MS + 100); });
      expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_READ_MS); });
      expect(screen.getByText("We couldn't load the pickup places.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    });

    it("if the new read finds no places after all, Pay opens again", async () => {
      stallThenAnswer([]);
      wrap(<Refusable />);
      await act(async () => { await vi.advanceTimersByTimeAsync(PORCH_PLACES_WAIT_MS + 100); });
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
    });
  });

  it("every refused checkout goes through the new read", () => {
    expect(SRC("DeclutterTradeViews.tsx")).toMatch(/if \(needsPlace\) void porchPlaces\.reread\(err\);/);
    expect(SRC("DeclutterTradeViews.tsx")).toMatch(/toast\.error\(declutterErrorMessage\(err\)\); void porchPlaces\.reread\(err\);/);
    expect(SRC("DeclutterFreeClaim.tsx")).toMatch(/if \(atPlace\) void porchPlaces\.reread\(err\);/);
    for (const f of ["DeclutterTradeViews.tsx", "DeclutterFreeClaim.tsx"]) expect(SRC(f)).not.toMatch(/porchPlaces\.query\.refetch/);
  });

  it("a free claim never talks about paying", async () => {
    answers({});
    const { container, unmount } = wrap(<PorchPlacePicker sellerId="s1" cartKey={0} places={OPTIONS} loadError={null} onRetry={() => undefined} free />);
    expect(container.textContent).toContain("You get the exact address once you confirm.");
    expect(container.textContent).not.toMatch(/pay/i);
    unmount();
    const paid = wrap(<PorchPlacePicker sellerId="s1" cartKey={1000} places={OPTIONS} loadError={null} onRetry={() => undefined} />);
    expect(paid.container.textContent).toContain("You get the exact address after you pay.");
    expect(SRC("DeclutterFreeClaim.tsx")).toMatch(/places=\{porchPlaces\.places\} free refused/);
  });

  // A3-55 (audit 11-01): under Helpr delivery the buyer never goes to the seller, so the picker says where the Helpr
  // picks it up, with no address line and no days.
  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |       {!forDelivery && <p className="text-xs text-muted-foreground">{free ? |       {true && <p className="text-xs text-muted-foreground">{free ?
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |                   forDelivery={h === "delivery"} onRetry |                   onRetry
  it("under Helpr delivery: 'Where the Helpr picks it up', no address line, no days (A3-55)", () => {
    answers({});
    const { container, unmount } = wrap(<PorchPlacePicker sellerId="s1" cartKey={1000} places={OPTIONS} loadError={null} onRetry={() => undefined} forDelivery />);
    expect(container.querySelector("legend")?.textContent).toBe("Where the Helpr picks it up");
    expect(container.textContent).not.toMatch(/exact address|Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    unmount();
    expect(SRC("DeclutterTradeViews.tsx")).toMatch(/forDelivery=\{h === "delivery"\}/);
  });

  it("paid checkout and the free claim both wait on the pick", () => {
    expect(SRC("DeclutterTradeViews.tsx")).toMatch(/!meetupReady \|\| !placeReady \|\| !pickupTimeReady\}/);
    expect(SRC("DeclutterTradeViews.tsx")).toMatch(/address\.trim\(\)\.length < 5 \|\| !placeReady/);
    expect(SRC("DeclutterFreeClaim.tsx")).toMatch(/offered\.length === 0 \|\| !placeReady\}/);
  });
});

describe("the sell form says which address wins", () => {
  const flow = (free: boolean) => ({
    place: { inexact: null, locating: false, shareMyLocation: vi.fn() }, form: { free, areaLabel: "", pickupAddress: "" }, set: vi.fn(), ways: ["porch"], setWays: vi.fn(), sellerDeliveryOpen: false, windows: [], setWindows: vi.fn(),
  }) as unknown as SellFlow;
  const note = (c: HTMLElement) => c.querySelector("[data-sell-address-note]")?.textContent?.trim();

  it("with saved places, a buyer's pick beats the address below, and the address says when it is used", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const { container } = wrap(<SellWaysFields s={flow(false)} />);
    const first = await waitFor(() => { const el = container.querySelector("[data-saved-places-first]"); expect(el).not.toBeNull(); return el!; });
    expect(first.textContent).toBe("You have saved pickup places. A buyer choosing porch pickup or Helpr delivery picks one and gets that address, not the one below.");
    expect(note(container)).toBe("Private. Only used when a buyer gets it another way, or if you remove your saved places.");
    // It sits between the saved places and the address it is about.
    expect(first.compareDocumentPosition(screen.getByLabelText("Pickup address")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[data-porch-places]")!.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a free item has no other way, so the address only matters without places", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const { container } = wrap(<SellWaysFields s={flow(true)} />);
    await waitFor(() => expect(container.querySelector("[data-saved-places-first]")).not.toBeNull());
    expect(container.querySelector("[data-saved-places-first]")!.textContent).toBe("You have saved pickup places, so the person who gets this picks one and gets that address, not the one below.");
    expect(note(container)).toBe("Private. Only used if you remove your saved places.");
  });

  it("with none saved, the form reads as it always did", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [] });
    const { container } = wrap(<SellWaysFields s={flow(false)} />);
    await waitFor(() => expect(container.querySelector("[data-porch-places]")).not.toBeNull());
    expect(container.querySelector("[data-saved-places-first]")).toBeNull();
    expect(note(container)).toBe("Private. Only the buyer who pays sees it.");
  });
});

describe("the places editor follows the server's rule, not the porch tick", () => {
  const choices = (ways: string[], free: boolean) => <SellHandoverChoices ways={ways as never} setWays={() => undefined} free={free} sellerDeliveryOpen={false} pickupDays={[6]} />;

  it("porch unticked on a paid item: Helpr delivery still uses places, so it stays, in Helpr words", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const { container } = wrap(choices(["meetup"], false));
    const block = await waitFor(() => { const el = container.querySelector("[data-porch-places]"); expect(el).not.toBeNull(); return el!; });
    expect(block.textContent).toContain("A buyer choosing Helpr delivery picks one of these");
    expect(block.textContent).not.toContain("after paying");
    expect(container.querySelector("[data-porch-days]")).toBeNull();
  });

  it("porch ticked reads as it did; a free item says no paying", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const paid = wrap(choices(["porch"], false));
    await waitFor(() => expect(paid.container.querySelector("[data-porch-places]")?.textContent).toContain("Buyers pick one of these. They only get its address after paying."));
    paid.unmount();
    const free = wrap(choices(["porch"], true));
    await waitFor(() => expect(free.container.querySelector("[data-porch-places]")?.textContent).toContain("sees its address once they confirm"));
    expect(free.container.querySelector("[data-porch-places]")?.textContent).not.toMatch(/paying/);
  });
});

describe("a place's days and the usual pickup times say which is which", () => {
  const flow = { place: { inexact: null, locating: false, shareMyLocation: vi.fn() }, form: { free: false, areaLabel: "", pickupAddress: "" }, set: vi.fn(), ways: ["porch"], setWays: vi.fn(), sellerDeliveryOpen: false, windows: [], setWindows: vi.fn() } as unknown as SellFlow;

  it("with places: porch uses the place's days, the times are for the other ways", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const { container } = wrap(<SellWaysFields s={flow} />);
    await waitFor(() => expect(container.querySelector("[data-place-days-rule]")?.textContent).toBe("Buyers come on each place's own days and hours."));
    expect(container.textContent).toContain("Safe meeting spots and Helpr delivery pickups use these times.");
    expect(container.textContent).not.toContain("Buyers pick one of these times.");
  });

  it("with none: the times read as before and there is no rule line", async () => {
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [] });
    const { container } = wrap(<SellWaysFields s={flow} />);
    await waitFor(() => expect(container.querySelector("[data-porch-places]")).not.toBeNull());
    expect(container.querySelector("[data-place-days-rule]")).toBeNull();
    expect(container.textContent).toContain("Buyers pick one of these times.");
  });
});

describe("finding places, and their edges in dark", () => {
  const PAGE = () => blankComments(readFileSync(join(process.cwd(), "src/pages/declutter/DeclutterSettingsPage.tsx"), "utf8"));

  it("the Selling row names them and they come first in settings", () => {
    expect(SRC("DeclutterHomeView.tsx")).toContain("Listing defaults, pickup places, pickup times, delivery, bundle discount, notifications");
    expect(PAGE().indexOf("<SellPorchPlaces card />")).toBeGreaterThan(0);
    expect(PAGE().indexOf("<SellPorchPlaces card />")).toBeLessThan(PAGE().indexOf("<ListingDefaultsCard"));
  });

  it("place rows, the place form and way tiles force their edge in dark, over the !important in index.css T2", async () => {
    // T2 makes every .bg-card border transparent with !important and dark drops its shadow, so a plain border class paints nothing.
    expect(readFileSync(join(process.cwd(), "src/index.css"), "utf8")).toMatch(/:where\(\.bg-card\),[\s\S]{0,60}border-color: transparent !important/);
    answers({ declutter_my_porch_days: null, declutter_my_porch_places: [HOME] });
    const { container } = wrap(<SellHandoverChoices ways={["porch"]} setWays={() => undefined} free={false} sellerDeliveryOpen={false} pickupDays={[6]} />);
    const row = await waitFor(() => { const el = container.querySelector("[data-porch-place]"); expect(el).not.toBeNull(); return el!; });
    expect(row.className).toContain("dark:!border-border");
    expect(container.querySelector('[data-handover-tile="porch"]')!.className).toContain("dark:!border-[hsl(var(--bark))]");
    expect(container.querySelector('[data-handover-tile="meetup"]')!.className).toContain("dark:!border-border");
    fireEvent.click(screen.getByRole("button", { name: "Add a pickup place" }));
    expect(container.querySelector("[data-porch-place-form]")!.className).toContain("dark:!border-border");
  });
});

describe("the paid order", () => {
  const FROZEN = { label: "Camp", area: "New Orleans", address: "99 Camp Road, New Orleans", lat: 29.95, lng: -90.07, weekdays: [0] };

  it("tells the seller where to put it out", async () => {
    answers({ declutter_order_place: [FROZEN] });
    wrap(<OrderPorchPlace orderId="o1" side="seller" />);
    expect((await screen.findByText("Camp")).parentElement?.textContent).toContain("99 Camp Road");
  });

  // @mutate src/components/declutter/DeclutterPorchPlaces.tsx |   const name = side === "seller" ? place.label ?? place.area : place.area; |   const name = place.label ?? place.area;
  it("names the place's city for the buyer (never its label), whose address line is PickupAddresses", async () => {
    // The server sends the buyer no label (20261101054401); an older server's label still never shows.
    answers({ declutter_order_place: [FROZEN] });
    const { container } = wrap(<OrderPorchPlace orderId="o1" side="buyer" />);
    await screen.findByText("New Orleans");
    expect(container.textContent).not.toContain("99 Camp Road");
    expect(container.textContent).not.toContain("Camp");
  });

  it("an order with no place shows nothing", async () => {
    answers({ declutter_order_place: [] });
    const { container } = wrap(<OrderPorchPlace orderId="o1" side="seller" />);
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-order-porch-place]")).toBeNull();
  });

  it("the order card mounts it for a porch pickup", () => {
    expect(SRC("DeclutterHandoverViews.tsx")).toMatch(/order\.handover === "porch" && <OrderPorchPlace orderId=\{order\.orderId\} side=\{order\.side\} \/>/);
  });
});
