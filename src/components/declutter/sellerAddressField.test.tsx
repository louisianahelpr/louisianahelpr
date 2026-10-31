/**
 * Owner 10-30, on Declutter settings > Pickup places: "I shouldn't have to tell them the area they see. It should just use
 * the city that's typed. It should also be set up like jobs: when I enter the address it should open from the populated
 * list and use that." Driven through the real AddressAutocomplete with a stand-in for Apple's search.
 *
 * @mutate src/components/declutter/SellPorchPlaces.tsx | const point = d.saved && d.saved.address.trim() === address ? d.saved : await place.locate(address); | const point = await place.locate(address);
 * @mutate src/components/declutter/SellerAddressField.tsx |             place.takePicked({ ...point, address });\n |
 * @mutate src/components/declutter/SellerAddressField.tsx | if (st && !/^(la\|louisiana)$/i.test(st)) { | if (false) {
 * @mutate src/components/declutter/SellerAddressField.tsx | onChange(address, city.trim() \|\| areaFromAddress(address)); | onChange(address, street);
 * @mutate src/components/postjob/AddressAutocomplete.tsx | const houseFound = !!sub && !!thor && typeof lat | const houseFound = typeof lat
 * @mutate src/components/postjob/AddressAutocomplete.tsx | if (mapKitStatus !== "ready" && !plainWithoutMapKit) { | if (mapKitStatus !== "ready") {
 * @mutate src/components/declutter/sellForm.ts | return /\d/.test(city) \|\| AREA_ADDRESS_RE.test(city) ? "" : city; | return city;
 * @mutate src/components/declutter/SellPorchPlaces.tsx |       if (!d.area.trim()) throw new Error("no_city_in_address");\n |
 * @mutate src/components/declutter/SellerAddressField.tsx | onFocusCapture={bringUp} |
 * @mutate src/components/declutter/SellerAddressField.tsx |         keepListInView\n |
 * @mutate src/components/declutter/SellerAddressField.tsx |     if (desktop) return;\n |
 * @mutate src/components/postjob/AddressAutocomplete.tsx | if (keepListInView && showList) listRef | if (false) listRef
 * @mutate src/components/postjob/AddressAutocomplete.tsx | {keepListInView ? "scroll-mb-safe-nav" : ""} |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

type FakePlace = Record<string, unknown>;
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  lookup: vi.fn(),
  status: "ready",
  suggestions: [] as { displayLines: string[]; place: Record<string, unknown> }[],
  here: { lat: 30.4601, lng: -91.1601 },
  desktop: false,
}));
// The usual pickup times (fetchMyPickupWindows): none, so a new place starts at Sat 9-12 (LEAD-PLACE-TIMES).
const noUsualTimes = { select: () => noUsualTimes, eq: () => noUsualTimes, order: () => Promise.resolve({ data: [], error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: () => noUsualTimes } }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: h.lookup }));
vi.mock("@/lib/analytics", async (orig) => ({ ...(await orig<object>()), track: vi.fn() }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => h.here }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "seller-1" } }) }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => h.status }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => h.desktop }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { SellPorchPlaces } from "./SellPorchPlaces";
import { areaFromAddress } from "./sellForm";

class FakeSearch {
  autocomplete(_q: string, cb: (e: Error | null, d: { results: unknown[] }) => void) { cb(null, { results: h.suggestions }); }
  search(r: { place: FakePlace }, cb: (e: Error | null, d: { places: FakePlace[] }) => void) { cb(null, { places: [r.place] }); }
}

const HOUSE = {
  displayLines: ["123 Main St", "Baton Rouge, LA"],
  place: { subThoroughfare: "123", thoroughfare: "Main St", locality: "Baton Rouge", administrativeAreaCode: "LA", postCode: "70808", coordinate: { latitude: 30.4512, longitude: -91.1546 } },
};
const TOWN = {
  displayLines: ["Baton Rouge", "LA"],
  place: { locality: "Baton Rouge", administrativeAreaCode: "LA", coordinate: { latitude: 30.45, longitude: -91.15 } },
};
const ELSEWHERE = {
  displayLines: ["9 Elm St", "Dallas, TX"],
  place: { subThoroughfare: "9", thoroughfare: "Elm St", locality: "Dallas", administrativeAreaCode: "TX", postCode: "75201", coordinate: { latitude: 32.78, longitude: -96.8 } },
};
const SAVED = { id: "p1", position: 0, label: "Home", address: "12 Home Street, Lafayette", area: "Mid-City", lat: 30.2, lng: -92, weekdays: [6] };

function answers(places: unknown[] = []) {
  h.rpc.mockImplementation((name: string) => Promise.resolve(name === "declutter_my_porch_places" ? { data: places, error: null } : { data: "new-id", error: null }));
}
function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SellPorchPlaces /></QueryClientProvider>);
}
async function newPlace() {
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Add a pickup place" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Camp" } });
  // LEAD-PLACE-TIMES: the hours editor already holds Sat 9-12 (no usual times), so Saturday is not tapped.
}
const addressBox = () => screen.getByLabelText("Address") as HTMLInputElement;
const type = (v: string) => fireEvent.change(addressBox(), { target: { value: v } });
const saved = () => h.rpc.mock.calls.filter(([n]) => n === "declutter_save_porch_place").map(([, a]) => a);
const pressSave = () => fireEvent.click(screen.getByRole("button", { name: "Save place" }));

afterEach(cleanup);
afterEach(cleanup);
beforeEach(() => {
  h.rpc.mockReset();
  h.lookup.mockReset();
  h.status = "ready";
  h.suggestions = [HOUSE];
  (window as unknown as { mapkit: unknown }).mapkit = {
    Search: FakeSearch,
    Coordinate: class {},
    CoordinateRegion: class {},
    CoordinateSpan: class {},
  };
  answers();
});

describe("a pickup place's address", () => {
  it("there is no area box: typing opens the list, and a pick fills the address, the city and the exact point", async () => {
    await newPlace();
    expect(screen.queryByLabelText("Area buyers see")).toBeNull();
    type("123 Mai");
    fireEvent.click(await screen.findByText("123 Main St"));
    await waitFor(() => expect(addressBox().value).toBe("123 Main St, Baton Rouge, LA 70808"));
    pressSave();
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ p_address: "123 Main St, Baton Rouge, LA 70808", p_area: "Baton Rouge", p_lat: 30.4512, p_lng: -91.1546, p_weekdays: [6] });
    // The pick carried the point, so nothing else was asked.
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("a town-only pick is never the exact point: the note offers their location, and that is what's kept", async () => {
    h.suggestions = [TOWN];
    h.lookup.mockResolvedValue({ status: "approximate", lat: 30.45, lng: -91.15, precision: "town" });
    await newPlace();
    type("Baton");
    fireEvent.click(await screen.findByText("Baton Rouge"));
    await waitFor(() => expect(addressBox().value).toBe("Baton Rouge, LA"));
    const share = await screen.findByRole("button", { name: "I'm at this address, use my location" });
    pressSave();
    await waitFor(() => expect(h.lookup.mock.calls.length).toBeGreaterThan(1));
    expect(saved()).toHaveLength(0);
    fireEvent.click(share);
    await screen.findByText("Got it. We'll use where you are now.");
    pressSave();
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ p_lat: h.here.lat, p_lng: h.here.lng });
  });

  it("a pick with no point and the lookup down says the lookup is down, and saves nothing", async () => {
    h.suggestions = [{ ...HOUSE, place: { ...HOUSE.place, coordinate: undefined } }];
    h.lookup.mockResolvedValue({ status: "unavailable" });
    await newPlace();
    type("123 Mai");
    fireEvent.click(await screen.findByText("123 Main St"));
    await waitFor(() => expect(addressBox().value).toContain("Baton Rouge"));
    pressSave();
    const said = (await screen.findByRole("alert")).textContent ?? "";
    expect(said).toMatch(/can't look up addresses just now/);
    expect(said).not.toMatch(/couldn't find/);
    expect(saved()).toHaveLength(0);
  });

  it("a pick outside Louisiana is refused, as on Post a Job", async () => {
    h.suggestions = [ELSEWHERE];
    await newPlace();
    type("9 Elm");
    fireEvent.click(await screen.findByText("9 Elm St"));
    await screen.findByText("Helpr works in Louisiana only. Pick a Louisiana address.");
    expect(addressBox().value).toBe("");
    expect(screen.getByRole("button", { name: "Save place" })).toBeDisabled();
  });

  it.each(["missing-token", "error", "loading"])("MapKit %s: the same box takes a typed address, and the city typed is the area", async (status) => {
    h.status = status;
    h.lookup.mockResolvedValue({ status: "exact", lat: 29.95, lng: -90.07 });
    await newPlace();
    type("99 Camp Road, New Orleans, LA 70112");
    pressSave();
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ p_area: "New Orleans", p_lat: 29.95, p_lng: -90.07 });
  });

  it("a typed address with no city says so and saves nothing", async () => {
    h.lookup.mockResolvedValue({ status: "exact", lat: 29.95, lng: -90.07 });
    await newPlace();
    type("99 Camp Road");
    pressSave();
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't tell the city/);
    expect(saved()).toHaveLength(0);
  });

  it("a saved place keeps its area and point while its address is unchanged, with no lookup", async () => {
    answers([SAVED]);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
    pressSave();
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ p_place_id: "p1", p_address: SAVED.address, p_area: "Mid-City", p_lat: 30.2, p_lng: -92, p_weekdays: [0, 6] });
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("changing a saved place's address takes the new city and a new point", async () => {
    answers([SAVED]);
    h.lookup.mockResolvedValue({ status: "exact", lat: 29.95, lng: -90.07 });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Home" }));
    type("99 Camp Road, New Orleans");
    pressSave();
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ p_area: "New Orleans", p_lat: 29.95 });
  });
});

describe("a box low on a phone's page", () => {
  const scroll = vi.fn();
  beforeEach(() => {
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    h.desktop = false;
  });

  it("scrolls up on focus, under the page's title, and the open list stays clear of the bottom nav", async () => {
    await newPlace();
    fireEvent.focus(addressBox());
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect((scroll.mock.contexts[0] as HTMLElement).className).toContain("scroll-mt-24");
    scroll.mockClear();
    type("123 Mai");
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest" }));
    expect(list.className).toContain("scroll-mb-safe-nav");
  });

  it("scrolls again as the keyboard opens, once", async () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal("visualViewport", {
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    });
    try {
      await newPlace();
      fireEvent.focus(addressBox());
      scroll.mockClear();
      expect(listeners.size).toBe(1);
      for (const f of [...listeners]) f();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(listeners.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a desktop page doesn't jump", async () => {
    h.desktop = true;
    await newPlace();
    fireEvent.focus(addressBox());
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe("the area is the city, nothing finer", () => {
  it.each([
    ["1 Main St, Baton Rouge, LA 70808", "Baton Rouge"],
    ["1 Main St, Mid City, Baton Rouge", "Baton Rouge"],
    ["1 Main St, Baton Rouge, Apt 4", ""],
    ["1 Main St, 55 Oak Dr", ""],
    ["1 Main St", ""],
    ["1 Main St, 70808", ""],
  ])("%s -> %s", (address, area) => {
    expect(areaFromAddress(address)).toBe(area);
  });
});

describe("every seller address box", () => {
  const FORMS = ["SellPorchPlaces.tsx", "SellerSetup.tsx", "SellFormParts.tsx", "DeclutterBunchView.tsx"];
  it("uses the shared field and has no area box", () => {
    expect(FORMS.length).toBeGreaterThan(3);
    for (const f of FORMS) {
      const src = blankComments(readFileSync(join(process.cwd(), "src/components/declutter", f), "utf8"));
      expect(src, f).toContain("<SellerAddressField");
      expect(src, f).not.toContain("Area buyers see");
    }
  });
});
