/**
 * D-NEW11: the real onMyWay call, not the mock the card's test uses. A wrong helper name here passed every card test and
 * threw at the tap (found by typecheck on 2026-10-30).
 *
 * @mutate src/lib/declutter/handover.ts | (e) => rpcErrorMessage("declutter_on_my_way", e)) as | () => null) as
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as unknown[][], result: { data: "on_way" as string | null, error: null as { message: string } | null } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (...args: unknown[]) => { state.calls.push(args); return state.result; } },
}));

import { onMyWay } from "./handover";

beforeEach(() => {
  state.calls = [];
  state.result = { data: "on_way", error: null };
});

describe("onMyWay", () => {
  it("calls the server for that order and returns its answer", async () => {
    await expect(onMyWay("o1")).resolves.toBe("on_way");
    expect(state.calls).toEqual([["declutter_on_my_way", { p_order_id: "o1" }]]);
  });
  it("says the server's refusal in plain words", async () => {
    state.result = { data: null, error: { message: "not_pickup_day" } };
    await expect(onMyWay("o1")).rejects.toMatchObject({ userMessage: "You can tell the seller on the day of your pickup." });
  });
});
