/**
 * Homes listings before the migration is deployed: no error screen, just no
 * listings (PGRST202 missing function / PGRST205 missing table). Any other
 * error still reaches the screen's load-error state.
 *
 * @mutate src/lib/rentals/listings.ts |   return code === "PGRST202" \|\| code === "PGRST205"; |   return false;
 */
import { describe, expect, it, vi } from "vitest";

const state = { rpcError: null as null | { code: string; message: string }, tableError: null as null | { code: string; message: string } };
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["select", "eq", "neq", "or"]) c[k] = () => c;
    c.order = async () => ({ data: state.tableError ? null : [], error: state.tableError });
    c.neq = () => c;
    return c;
  };
  return {
    supabase: {
      rpc: async () => ({ data: state.rpcError ? null : [], error: state.rpcError }),
      from: () => chain(),
      storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: p } }) }) },
    },
  };
});

import { fetchBrowseListings, fetchMyListings, listingRefExpired } from "./listings";

describe("listings before deploy", () => {
  it("a missing function or table reads as no listings", async () => {
    state.rpcError = { code: "PGRST202", message: "Could not find the function" };
    expect(await fetchBrowseListings()).toEqual([]);
    state.tableError = { code: "PGRST205", message: "Could not find the table" };
    expect(await fetchMyListings("u1")).toEqual([]);
  });
  it("any other error still throws", async () => {
    state.rpcError = { code: "42501", message: "feature_disabled" };
    await expect(fetchBrowseListings()).rejects.toBeTruthy();
    state.tableError = { code: "XX000", message: "boom" };
    await expect(fetchMyListings("u1")).rejects.toBeTruthy();
  });
});

describe("photo refs expire (Q2211 review #6: the gallery refetches instead of breaking)", () => {
  const ref = (exp: number) => `11111111-2222-4333-8444-555555555555.m.${exp}.0123456789abcdef0123456789abcdef`;
  it("a ref past (or within a minute of) its expiry is expired; a fresh one and garbage are told apart", () => {
    const now = 1_792_396_800_000;
    expect(listingRefExpired(ref(now / 1000 + 3600), now)).toBe(false);
    expect(listingRefExpired(ref(now / 1000 + 30), now)).toBe(true);
    expect(listingRefExpired(ref(now / 1000 - 10), now)).toBe(true);
    expect(listingRefExpired("garbage", now)).toBe(true);
  });
});
