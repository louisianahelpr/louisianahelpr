/**
 * B110 (owner 11-01 1:00 PM): the seller's own meet spots in Declutter settings (20261101194608). A police safe spot
 * is a one-tap suggestion that fills the form with its name, address and point; Save sends the point and the days and
 * times; Cancel sits left of the primary Save (app-wide rule, owner 11-01); a saved spot can be removed. At checkout a
 * seller spot reads "The seller's meet spot", and its own days and times drive the meetup time chips.
 *
 * @mutate src/components/declutter/SellMeetupSpots.tsx |       const point = d.point && d.point.address.trim() === address ? d.point : await place.locate(address); |       const point = await place.locate(address);
 * @mutate src/components/declutter/SellMeetupSpots.tsx |       return saveMyMeetupSpot({ id: null, name: d.name.trim(), address, area: d.area.trim(), lat: point.lat, lng: point.lng, windows: d.windows }); |       return saveMyMeetupSpot({ id: null, name: d.name.trim(), address, area: d.area.trim(), lat: point.lat, lng: point.lng, windows: null });
 * @mutate src/components/declutter/SellMeetupSpots.tsx |   if (q.data === MEETUP_SPOTS_NOT_DEPLOYED) return null; |
 * @mutate src/components/declutter/DeclutterMeetup.tsx |   seller: "The seller's meet spot", |   seller: "Public place",
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | porchPlaces.places.find((p) => p.chosen)?.windows : spotHours.data; | porchPlaces.places.find((p) => p.chosen)?.windows : null;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ rpc: vi.fn(), lookup: vi.fn() }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: h.lookup }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { SellMeetupSpots } from "./SellMeetupSpots";
import { MeetupSpotPicker } from "./DeclutterMeetup";

const SPOT = { id: "m1", name: "Walmart parking lot", address: "1205 E Admiral Doyle Dr, New Iberia, LA", area: "New Iberia", lat: 30.0, lng: -91.8,
  windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }] };
const POLICE = { id: "p1", name: "Iberia Sheriff Safe Zone", address: "300 Iberia St, New Iberia, LA", area: "New Iberia", lat: 30.01, lng: -91.81 };
const state = { mine: [] as unknown[], missing: false };

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  state.mine = [];
  state.missing = false;
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn === "declutter_my_meetup_spots") {
      return state.missing ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_my_meetup_spots" } } : { data: state.mine, error: null };
    }
    if (fn === "declutter_meetup_spot_suggestions") return { data: [POLICE], error: null };
    if (fn === "declutter_save_my_meetup_spot") return { data: "new-id", error: null };
    if (fn === "declutter_remove_my_meetup_spot") return { data: true, error: null };
    return { data: null, error: null };
  });
});

describe("SellMeetupSpots", () => {
  it("lists the seller's spots with their days and times; Remove switches one off", async () => {
    state.mine = [SPOT];
    wrap(<SellMeetupSpots />);
    expect(await screen.findByText("Walmart parking lot")).toBeInTheDocument();
    expect(screen.getByText(SPOT.address)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Walmart parking lot" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_remove_my_meetup_spot", { p_id: "m1" }));
  });

  it("a police spot suggestion fills the form; Save sends its point and the days and times; Cancel sits left of Save", async () => {
    wrap(<SellMeetupSpots />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Iberia Sheriff Safe Zone" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Iberia Sheriff Safe Zone");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const save = screen.getByRole("button", { name: "Save spot" });
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_save_my_meetup_spot", expect.objectContaining({
      p_id: null, p_name: "Iberia Sheriff Safe Zone", p_address: POLICE.address, p_area: "New Iberia", p_lat: POLICE.lat, p_lng: POLICE.lng,
      p_windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }],
    })));
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("stays hidden until the server has the meet spots (PGRST202)", async () => {
    state.missing = true;
    const { container } = wrap(<SellMeetupSpots />);
    await waitFor(() => expect(h.rpc.mock.calls.some((c) => c[0] === "declutter_my_meetup_spots")).toBe(true));
    // The read has answered (above); let its rejection settle, then the section must still be absent.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid=sell-meetup-spots]")).toBeNull();
  });
});

describe("checkout: a seller's spot", () => {
  it("reads as the seller's meet spot, and its own days and times drive the meetup chips", () => {
    wrap(<MeetupSpotPicker sellerId="s1" spots={[{ id: "m1", name: "Walmart parking lot", address: SPOT.address, parish: "New Iberia", kind: "seller", note: null, miles: 3, chosen: true }]} onChosen={() => {}} />);
    expect(screen.getByText(/The seller's meet spot · 1205 E Admiral/)).toBeInTheDocument();
    expect(screen.getByText("Public places to meet. Nobody's home address is shared.")).toBeInTheDocument();
    const src = readFileSync("src/components/declutter/DeclutterTradeViews.tsx", "utf8");
    expect(src).toContain('porchPlaces.places.find((p) => p.chosen)?.windows : spotHours.data;');
  });
});
