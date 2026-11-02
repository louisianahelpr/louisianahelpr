/**
 * Shipping S6 2e, buyer side (lead 11-01): checkout offers "Ship it to me" only when every item has a parcel AND the
 * seller may ship now (declutter_seller_can_ship, 20261102054848: no shipping debt owed). Before, a seller owing a spent
 * label was still offered and only the order trigger refused, after the buyer had bought a quote.
 *
 * @mutate src/lib/declutter/api.ts |   return data === true;\n} |   return true;\n}
 * @mutate src/lib/declutter/api.ts |   const { data, error } = await supabase.rpc("declutter_seller_can_ship", { p_seller_id: sellerId }); |   const { data, error } = { data: true, error: null };
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  items: [] as { id: string; ship_preset: string | null }[],
  rpc: { data: true as unknown, error: null as unknown },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ in: async () => ({ data: state.items, error: null }) }) }),
    rpc: async (name: string, args: unknown) => { state.rpcCalls.push({ name, args }); return state.rpc; },
  },
}));

import { fetchItemsCanShip } from "./api";

beforeEach(() => {
  state.items = [{ id: "i1", ship_preset: "small_box" }, { id: "i2", ship_preset: "envelope" }];
  state.rpc = { data: true, error: null };
  state.rpcCalls = [];
});

describe("fetchItemsCanShip asks whether the seller may ship (S6 2e)", () => {
  it("a seller who owes a shipping debt is not offered", async () => {
    state.rpc = { data: false, error: null };
    expect(await fetchItemsCanShip(["i1", "i2"], "s1")).toBe(false);
    expect(state.rpcCalls).toEqual([{ name: "declutter_seller_can_ship", args: { p_seller_id: "s1" } }]);
  });

  it("every item with a parcel and a seller in good standing is offered", async () => {
    expect(await fetchItemsCanShip(["i1", "i2"], "s1")).toBe(true);
  });

  it("an item without a parcel is never offered, and the seller is not asked", async () => {
    state.items = [{ id: "i1", ship_preset: "small_box" }, { id: "i2", ship_preset: null }];
    expect(await fetchItemsCanShip(["i1", "i2"], "s1")).toBe(false);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("before the read reaches prod (PGRST202 naming it) it is offered; the order trigger still refuses", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_seller_can_ship(p_seller_id)", hint: null } };
    expect(await fetchItemsCanShip(["i1", "i2"], "s1")).toBe(true);
  });

  it("any other error is thrown, never read as yes", async () => {
    state.rpc = { data: null, error: { code: "42501", message: "feature_disabled" } };
    await expect(fetchItemsCanShip(["i1", "i2"], "s1")).rejects.toBeTruthy();
  });
});
