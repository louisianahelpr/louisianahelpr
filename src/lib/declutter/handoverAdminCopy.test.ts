/**
 * Q1964: a refused adminDecideDeliveryDamage goes through the admin refusal copy it loads on demand
 * (src/lib/declutter/handover.ts -> loadAdminRpcErrorCopy). DeclutterProblemsCard.test.tsx mocks the handover
 * functions, so this runs the real one against a refused RPC:
 *   - the admin chunk loads: the thrown error carries the admin table's sentence for the code;
 *   - the admin chunk cannot be fetched: the error is still thrown (never swallowed) and carries no admin sentence,
 *     so the card shows its own fallback words.
 *
 * @mutate src/lib/declutter/handover.ts |   return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_decide_delivery_damage", e) ?? null) as unknown as Record<string, unknown>; |   return rpcData(res, () => null) as unknown as Record<string, unknown>;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";

const refused = { data: null, error: { code: "P0001", message: "delivery_not_done", details: null, hint: null } };

async function load(adminChunkFails: boolean) {
  vi.resetModules();
  const rpc = vi.fn().mockResolvedValue(refused);
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
  if (adminChunkFails) {
    vi.doMock("@/components/admin/adminRpcErrorCopy", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
  }
  const mod = await import("./handover");
  return { mod, rpc };
}

afterEach(() => {
  vi.doUnmock("@/integrations/supabase/client");
  vi.doUnmock("@/components/admin/adminRpcErrorCopy");
  vi.resetModules();
});

describe("adminDecideDeliveryDamage refusal copy (Q1964)", () => {
  it("a refused decision throws with the admin table's sentence for the code", async () => {
    const { mod, rpc } = await load(false);
    const err = await mod.adminDecideDeliveryDamage("p1", null).then(() => null, (e: unknown) => e as Error & { userMessage?: string });
    expect(rpc).toHaveBeenCalledWith("declutter_admin_decide_delivery_damage", { p_problem_id: "p1", p_note: null });
    expect(err).not.toBeNull();
    expect(err?.userMessage).toBe(DECLUTTER_ERROR_COPY.delivery_not_done);
  });

  it("with the admin chunk unavailable it still throws, with no admin sentence (the card's own words show)", async () => {
    const { mod } = await load(true);
    const err = await mod.adminDecideDeliveryDamage("p1", null).then(() => null, (e: unknown) => e as Error & { userMessage?: string });
    expect(err).not.toBeNull();
    expect(err?.userMessage).not.toBe(DECLUTTER_ERROR_COPY.delivery_not_done);
  });
});
