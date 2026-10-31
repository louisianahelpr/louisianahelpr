/**
 * "Go online" says what it needs BEFORE the press, and gets it as part of the press (Declutter deep audit #39,
 * re-seen in audit 3 as helpr_go_online 400 location_needed, shot a3-41-helpr-online-p1-390): a Helpr with no
 * area saved in their profile, who had not shared a position on the screen, flipped the switch and only then was
 * refused. Now the card says "going online asks for your location once", and the press asks the device for it and
 * sends it. A Helpr with an area saved is never asked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  profile: undefined as undefined | { latitude: number | null; longitude: number | null },
  calls: [] as unknown[][],
  asked: 0,
  refuse: false,
  origin: { status: "none", zipOnFile: false } as Record<string, unknown>,
  toasts: { success: [] as string[], error: [] as string[] },
}));

vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => state.toasts.success.push(m), { error: (m: string) => state.toasts.error.push(m) }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: state.profile }) }));
// The profile -> area chain the rest of Declutter uses (deriveFallbackLocation); audit DD D3 makes Go online read it.
vi.mock("./useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: state.origin }) }));
vi.mock("@/lib/declutter/position", () => ({
  currentPosition: async () => {
    state.asked++;
    if (state.refuse) throw new Error("location_required");
    return { lat: 30.4512, lng: -91.1512 };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async (name: string, args: unknown) => {
      state.calls.push([name, args]);
      return { data: null, error: null };
    },
  },
}));

import { GoOnlineCard } from "./GoOnlineCard";

function show(where: { lat: number; lng: number } | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GoOnlineCard userId="u1" where={where} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function press() {
  const sw = await screen.findByRole("switch", { name: "Online for deliveries" });
  await waitFor(() => expect(sw).not.toBeDisabled());
  fireEvent.click(sw);
}

beforeEach(() => {
  state.profile = { latitude: null, longitude: null };
  state.calls = [];
  state.asked = 0;
  state.refuse = false;
  state.origin = { status: "none", zipOnFile: false };
  state.toasts = { success: [], error: [] };
});

describe("Go online: the location it needs is said first and asked for on the press (deep audit #39)", () => {
  // @mutate src/components/declutter/GoOnlineCard.tsx |       const point = where ?? (hasArea ? null : derived ?? await currentPosition()); |       const point = where;
  it("no area and nothing shared: the card says so, and the press sends the device's position", async () => {
    show();
    expect(await screen.findByText(/No area in your profile yet, so going online asks for your location once\./)).toBeInTheDocument();
    await press();
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.asked).toBe(1);
    expect(state.calls[0]).toEqual(["helpr_go_online", { p_on: true, p_hours: 4, p_lat: 30.4512, p_lng: -91.1512, p_radius_miles: 15 }]);
    await waitFor(() => expect(state.toasts.success).toContain("You're online. New deliveries near you are sent to you."));
  });

  // @mutate src/components/declutter/GoOnlineCard.tsx |   const hasArea = profile?.latitude != null && profile?.longitude != null; |   const hasArea = false;
  it("an area saved in the profile: never asks, and the server uses the saved area", async () => {
    state.profile = { latitude: 30.45, longitude: -91.15 };
    show();
    expect(await screen.findByText(/Near the area in your profile\./)).toBeInTheDocument();
    await press();
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.asked).toBe(0);
    expect(state.calls[0]).toEqual(["helpr_go_online", { p_on: true, p_hours: 4, p_lat: null, p_lng: null, p_radius_miles: 15 }]);
  });

  // Audit DD D3 (shot dd-d1-deliver-tab-p2-375wk): a ZIP on the profile but no saved point said "No area in your
  // profile yet" while the rest of Declutter placed the member by that ZIP. Now the card names the ZIP's area and the
  // press sends that point, asking the device nothing.
  // @mutate src/components/declutter/GoOnlineCard.tsx |   const derived = !hasArea && origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null; |   const derived = hasArea ? { lat: 0, lng: 0 } : null;
  it("a ZIP on the profile but no saved point: the ZIP's area, never 'No area', and no device prompt", async () => {
    state.profile = { latitude: null, longitude: null };
    state.origin = { status: "ready", lat: 30.4415, lng: -91.1301, source: "zip", approximate: true };
    show();
    expect(await screen.findByText(/Near your ZIP code's area\./)).toBeInTheDocument();
    expect(screen.queryByText(/No area in your profile/)).toBeNull();
    await press();
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.asked).toBe(0);
    expect(state.calls[0]).toEqual(["helpr_go_online", { p_on: true, p_hours: 4, p_lat: 30.4415, p_lng: -91.1301, p_radius_miles: 15 }]);
  });

  // @mutate src/components/declutter/GoOnlineCard.tsx |         ? "Turn on location, or add your area in your profile, to go online." |         ? "Turn on location so we can confirm you're at the pickup address."
  it("location refused: nothing is sent, and the words say both ways to fix it", async () => {
    state.refuse = true;
    show();
    await press();
    await waitFor(() => expect(state.toasts.error).toEqual(["Turn on location, or add your area in your profile, to go online."]));
    expect(state.calls).toEqual([]);
  });
});
