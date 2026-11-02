/**
 * Manager mode: manageForSeller is the one client call a manager acts through (declutter_manage). It sends the seller,
 * the action and its args unchanged, answers the seller RPC's own result, and a refusal reaches the screen in the
 * shared RPC_ERROR_COPY words (userMessage), never the raw code.
 * @mutate src/lib/declutter/managerMode.ts |     (e) => rpcErrorMessage("declutter_manage", e)) | (e) => null)
 *
 * @mutate src/lib/declutter/managerMode.ts | { p_seller: sellerId, p_action: action, p_args: args as Json } | { p_seller: sellerId, p_action: action, p_args: {} as Json }
 * @mutate src/lib/declutter/managerMode.ts |   return out?.result ?? null; |   return null;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({ calls: [] as unknown[], reply: { data: null as unknown, error: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      st.calls.push([fn, args]);
      return st.reply;
    },
  },
}));
import { manageForSeller } from "./managerMode";

const SELLER = "aaaaaaaa-0000-4000-8000-000000000001";

beforeEach(() => {
  st.calls.length = 0;
  st.reply = { data: null, error: null };
});

describe("manageForSeller (declutter_manage)", () => {
  it("sends the seller, the action and its args unchanged, and answers the seller RPC's own result", async () => {
    st.reply = { data: { result: { item_id: "i1" } }, error: null };
    const out = await manageForSeller(SELLER, "set_listing_price", { p_item_id: "i1", p_price_cents: 1200 });
    expect(st.calls).toEqual([
      ["declutter_manage", { p_seller: SELLER, p_action: "set_listing_price", p_args: { p_item_id: "i1", p_price_cents: 1200 } }],
    ]);
    expect(out).toEqual({ item_id: "i1" });
  });

  it("a refusal throws the shared words, not the raw code", async () => {
    st.reply = { data: null, error: { message: "act_as_seller_failed", code: "P0001" } };
    // The words ride on the thrown error (rpcData sets userMessage), as every Declutter RPC's do.
    const thrown = await manageForSeller(SELLER, "pause_listing", { p_item_id: "i1" }).catch((e: unknown) => e);
    expect((thrown as { userMessage?: string }).userMessage).toMatch(/nothing was changed/);
    expect(st.calls.length).toBeGreaterThan(0);
  });
});
