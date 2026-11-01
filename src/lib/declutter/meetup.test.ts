/**
 * Safe meetup spots (meetup.ts, meetupErrors.ts): what the buyer's and the admin's calls send, and what the screens
 * get back. A "not deployed yet" reads as nothing to show; every other failure throws, in plain words when the code
 * has words. The server's own rules are its tests'; these are the client's half.
 *
 * @mutate src/lib/declutter/meetup.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_meetup_spots_near")) return []; |   if (false) return [];
 * @mutate src/lib/declutter/meetup.ts | miles: r.miles === null ? null : Number(r.miles) | miles: Number(r.miles)
 * @mutate src/lib/declutter/meetup.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (false) e.userMessage = msg;
 * @mutate src/lib/declutter/meetup.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (msg) e.userMessage = msg;
 * @mutate src/lib/declutter/meetup.ts | { p_seller_id: sellerId, p_spot_id: spotId } | { p_seller_id: spotId, p_spot_id: sellerId }
 * @mutate src/lib/declutter/meetup.ts |     .eq("order_id", orderId) |     .eq("order_id", "")
 * @mutate src/lib/declutter/meetup.ts |   if (isNotDeployedYet(result.error)) return null; |   if (false) return null;
 * @mutate src/lib/declutter/meetup.ts |   if (isNotDeployedYet(result.error)) return []; |   if (false) return [];
 * @mutate src/lib/declutter/meetup.ts | .map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) })) | .map((r) => r)
 * @mutate src/lib/declutter/meetup.ts |     p_note: spot.note ?? "", |     p_note: spot.note as string,
 * @mutate src/lib/declutter/meetup.ts | admin?.rpcErrorMessage("admin_declutter_save_meetup_spot", e) ?? null | null
 * @mutate src/lib/declutter/meetup.ts |     .neq("kind", "seller") |     .neq("kind", "")
 * @mutate src/lib/declutter/meetupErrors.ts | new RegExp(`(^\|[^a-z0-9_])${code}($\|[^a-z0-9_])`).test(raw) | raw.includes(code)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  calls: [] as unknown[][],
  result: { data: null as unknown, error: null as unknown },
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {
      then: (resolve: (r: unknown) => void) => resolve(h.result),
    };
    for (const m of ["select", "eq", "neq", "order", "maybeSingle"]) {
      q[m] = (...args: unknown[]) => { h.calls.push([m, ...args]); return q; };
    }
    return q;
  };
  return { supabase: { rpc: h.rpc, from: (t: string) => { h.calls.push(["from", t]); return query(); } } };
});

import { DECLUTTER_ERROR_COPY as DC } from "./errors";
import {
  adminSaveMeetupSpot, chooseMeetupSpot, fetchAllMeetupSpots, fetchMeetupSpotsNear, fetchOrderMeetup, meetupHere, meetupMapUrl,
} from "./meetup";
import { MEETUP_ERROR_COPY, meetupErrorMessage, rpcErrorMessage } from "./meetupErrors";

const NOT_DEPLOYED = { code: "PGRST202", message: "Could not find the function" };

beforeEach(() => {
  h.rpc.mockReset();
  h.calls.length = 0;
  h.result = { data: null, error: null };
});

describe("fetchMeetupSpotsNear", () => {
  it("asks about this seller and turns the server's text miles into numbers, keeping an unknown distance unknown", async () => {
    h.rpc.mockResolvedValue({
      data: [{ id: "s1", miles: "1.5", chosen: false }, { id: "s2", miles: null, chosen: true }],
      error: null,
    });
    const spots = await fetchMeetupSpotsNear("seller1");
    expect(h.rpc).toHaveBeenCalledWith("declutter_meetup_spots_near", { p_seller_id: "seller1" });
    expect(spots.map((s) => s.miles)).toEqual([1.5, null]);
  });

  it("no spots from the server is an empty list", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchMeetupSpotsNear("seller1")).resolves.toEqual([]);
  });

  it("before the migration is deployed the list is empty, not an error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: NOT_DEPLOYED });
    await expect(fetchMeetupSpotsNear("seller1")).resolves.toEqual([]);
  });

  it("the function changing its parameters is a real failure, never read as not deployed", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.declutter_meetup_spots_near(p_seller_id)",
        hint: "Perhaps you meant to call the function public.declutter_meetup_spots_near(p_seller)",
      },
    });
    await expect(fetchMeetupSpotsNear("seller1")).rejects.toThrow("Could not find the function");
  });

  it("a refusal carries its plain words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_authenticated" } });
    await expect(fetchMeetupSpotsNear("seller1")).rejects.toMatchObject({
      message: "not_authenticated",
      userMessage: DC.not_authenticated,
    });
  });
});

describe("chooseMeetupSpot", () => {
  it("sends the seller and the spot in their own places", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await chooseMeetupSpot("seller1", "spot1");
    expect(h.rpc).toHaveBeenCalledWith("declutter_set_meetup_spot", { p_seller_id: "seller1", p_spot_id: "spot1" });
  });

  it("a spot that is gone says so in words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "meetup_spot_unavailable" } });
    await expect(chooseMeetupSpot("seller1", "spot1")).rejects.toMatchObject({
      userMessage: MEETUP_ERROR_COPY.meetup_spot_unavailable,
    });
  });
});

describe("meetupHere", () => {
  it("answers what the server answered, a second tap included", async () => {
    h.rpc.mockResolvedValue({ data: "already_here", error: null });
    await expect(meetupHere("order1")).resolves.toBe("already_here");
    expect(h.rpc).toHaveBeenCalledWith("declutter_meetup_here", { p_order_id: "order1" });
  });

  it("a code with no words throws as it came, with no words made up", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const err = await meetupHere("order1").catch((e: unknown) => e) as Error & { userMessage?: string };
    expect(err.message).toBe("boom");
    expect(err.userMessage).toBeUndefined();
  });

  it("a frozen error is thrown as it is, not replaced by a TypeError from writing the words on it", async () => {
    const frozen = Object.freeze(new Error("too_early_to_check_in"));
    h.rpc.mockResolvedValue({ data: null, error: frozen });
    await expect(meetupHere("order1")).rejects.toBe(frozen);
  });
});

describe("fetchOrderMeetup", () => {
  it("reads this order's frozen spot", async () => {
    const row = { order_id: "order1", spot_name: "Police lot" };
    h.result = { data: row, error: null };
    await expect(fetchOrderMeetup("order1")).resolves.toEqual(row);
    expect(h.calls).toContainEqual(["from", "declutter_order_meetups"]);
    expect(h.calls).toContainEqual(["eq", "order_id", "order1"]);
  });

  it("no row is null", async () => {
    await expect(fetchOrderMeetup("order1")).resolves.toBeNull();
  });

  it("a table not deployed yet is null; any other failure throws", async () => {
    h.result = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    await expect(fetchOrderMeetup("order1")).resolves.toBeNull();
    h.result = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(fetchOrderMeetup("order1")).rejects.toThrow("permission denied");
  });
});

describe("meetupMapUrl", () => {
  it("escapes the spot's name, so an ampersand does not cut the link short", () => {
    expect(meetupMapUrl({ spot_lat: 30.5, spot_lng: -91.1, spot_name: "Tom & Sons" }))
      .toBe("https://maps.apple.com/?ll=30.5,-91.1&q=Tom%20%26%20Sons");
  });
});

describe("fetchAllMeetupSpots", () => {
  it("lists parish then name, with numeric map points", async () => {
    h.result = { data: [{ id: "s1", lat: "30.5", lng: "-91.25" }], error: null };
    const rows = await fetchAllMeetupSpots();
    expect(rows[0]).toMatchObject({ lat: 30.5, lng: -91.25 });
    expect(h.calls.filter((c) => c[0] === "order")).toEqual([["order", "parish"], ["order", "name"]]);
    // B110 (20261101194608): the admin's list is the checked spots only, never a seller's own.
    expect(h.calls).toContainEqual(["neq", "kind", "seller"]);
  });

  it("not deployed yet is an empty list; any other failure throws", async () => {
    h.result = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    await expect(fetchAllMeetupSpots()).resolves.toEqual([]);
    h.result = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(fetchAllMeetupSpots()).rejects.toThrow("permission denied");
  });
});

describe("adminSaveMeetupSpot", () => {
  const spot = {
    id: null, parish: "Lafayette", name: "Police lot", address: "1 Main St", lat: 30.2, lng: -92, kind: "police" as const, note: null, active: true,
  };

  it("a new spot goes with no id, and an empty note as blank", async () => {
    h.rpc.mockResolvedValue({ data: "new-id", error: null });
    await expect(adminSaveMeetupSpot(spot)).resolves.toBe("new-id");
    expect(h.rpc).toHaveBeenCalledWith("admin_declutter_save_meetup_spot", {
      p_id: null, p_parish: "Lafayette", p_name: "Police lot", p_address: "1 Main St", p_lat: 30.2, p_lng: -92, p_kind: "police", p_note: "", p_active: true,
    });
  });

  it("a refusal reads the admin's own words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "meetup_spot_invalid" } });
    await expect(adminSaveMeetupSpot(spot)).rejects.toMatchObject({
      userMessage: MEETUP_ERROR_COPY.meetup_spot_invalid,
    });
  });
});

describe("meetup words", () => {
  it("a code matches as a whole word, inside a longer message too", () => {
    expect(rpcErrorMessage("declutter_meetup_here", "not_booked_yet")).toBe("Book a time to meet first.");
    expect(rpcErrorMessage("declutter_meetup_here", { message: "ERROR: not_a_meetup (P0001)" })).toBe(MEETUP_ERROR_COPY.not_a_meetup);
    expect(rpcErrorMessage("declutter_meetup_here", "was_not_a_meetup_at_all")).toBeNull();
  });

  it("a code another RPC raises has no words here, and nothing to read is null", () => {
    expect(rpcErrorMessage("declutter_meetup_spots_near", "not_a_meetup")).toBeNull();
    expect(rpcErrorMessage("declutter_meetup_here", null)).toBeNull();
    expect(rpcErrorMessage("declutter_meetup_here", { message: 42 })).toBeNull();
  });

  it("the screens' reader takes the words on the error first, then the code's", () => {
    expect(meetupErrorMessage({ userMessage: "Already said", message: "not_a_meetup" })).toBe("Already said");
    expect(meetupErrorMessage(new Error("not_a_meetup"))).toBe(MEETUP_ERROR_COPY.not_a_meetup);
  });
});
