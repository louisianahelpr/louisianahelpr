/**
 * Saved homes (src/lib/rentals/savedHomes.ts): the heart on a Homes card and
 * the Saved list. Before db-deploy has created the table and RPCs, PostgREST
 * answers PGRST205 / PGRST202 and that reads as "nothing saved"; any other
 * error surfaces (never an empty list that hides a real failure).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown; status?: number }[] = [];
  const calls: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const supabase = {
    from: (table: string) => ({
      select: (cols: string) => {
        calls.push(["from", table, cols]);
        return Promise.resolve(next());
      },
    }),
    rpc: (name: string, args?: unknown) => {
      calls.push(["rpc", name, args]);
      return Promise.resolve(next());
    },
  };
  return { queue, calls, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import { fetchSavedHomeIds, fetchSavedListings, setSavedHome } from "./savedHomes";
import { RentalsCopyError } from "./copy";

beforeEach(() => {
  h.queue.length = 0;
  h.calls.length = 0;
});

describe("saved homes", () => {
  it("fetchSavedHomeIds reads the member's own listing ids", async () => {
    h.queue.push({ data: [{ listing_id: "l1" }, { listing_id: "l2" }], error: null });
    await expect(fetchSavedHomeIds()).resolves.toEqual(new Set(["l1", "l2"]));
    expect(h.calls).toEqual([["from", "saved_homes", "listing_id"]]);
  });

  it("fetchSavedHomeIds reads 'nothing saved' only while the table is not deployed (PGRST205)", async () => {
    h.queue.push({ data: null, error: { code: "PGRST205", message: "no table" } });
    await expect(fetchSavedHomeIds()).resolves.toEqual(new Set());
    h.queue.push({ data: null, error: { code: "42501", message: "permission denied" }, status: 403 });
    await expect(fetchSavedHomeIds()).rejects.toBeTruthy();
  });

  it("setSavedHome sends the listing and the wanted state, and reports what the server settled", async () => {
    h.queue.push({ data: true, error: null });
    await expect(setSavedHome("l1", true)).resolves.toBe(true);
    expect(h.calls).toEqual([["rpc", "rentals_set_saved_home", { p_listing_id: "l1", p_saved: true }]]);
    h.queue.push({ data: false, error: null });
    await expect(setSavedHome("l1", false)).resolves.toBe(false);
    h.queue.push({ data: null, error: null });
    await expect(setSavedHome("l1", true)).resolves.toBe(false);
  });

  it("setSavedHome surfaces a refusal as a RentalsCopyError", async () => {
    h.queue.push({ data: null, error: { code: "P0001", message: "listing_not_found" } });
    await expect(setSavedHome("l1", true)).rejects.toBeInstanceOf(RentalsCopyError);
  });

  it("fetchSavedListings returns the list, [] only for the not-deployed RPC, and throws on anything else", async () => {
    const rows = [{ listing_id: "l1" }];
    h.queue.push({ data: rows, error: null });
    await expect(fetchSavedListings()).resolves.toEqual(rows);
    expect(h.calls).toEqual([["rpc", "rentals_saved_listings", undefined]]);
    h.queue.push({ data: null, error: null });
    await expect(fetchSavedListings()).resolves.toEqual([]);
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.rentals_saved_listings", hint: null } });
    await expect(fetchSavedListings()).resolves.toEqual([]);
    h.queue.push({ data: null, error: { code: "57014", message: "statement timeout" }, status: 500 });
    await expect(fetchSavedListings()).rejects.toBeTruthy();
  });
});
