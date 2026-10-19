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

import { fetchBrowseListings, fetchMyListings } from "./listings";

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
