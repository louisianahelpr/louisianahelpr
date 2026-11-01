/**
 * PUSH-REACH (2026-11-01; prod: 2 web push subscriptions, 0 native tokens; 200 Declutter items listed since web push
 * shipped and none of them raised the ask): listing an item, making an offer and Buy now offer the website's push
 * ask once they SUCCEED (offerPushAfterAction; the ask keeps its own 14-day cooldown and never opens over a dialog).
 * A refused call offers nothing.
 *
 * @mutate src/lib/declutter/api.ts |   // PUSH-REACH: a listing that went up is when a seller wants to hear from buyers; the website's push ask.\n  offerPushAfterAction(); |
 * @mutate src/lib/declutter/api.ts |   // PUSH-REACH: the seller's answer is what the buyer waits for; the website's push ask.\n  offerPushAfterAction(); |
 * @mutate src/lib/declutter/api.ts |   // PUSH-REACH: pickup and the seller's messages follow a buy; the website's push ask.\n  offerPushAfterAction(); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const offer = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ offerPushAfterAction: offer }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn(), functions: { invoke: vi.fn() } } }));

const { publishItem, makeOffer, buyNow } = await import("@/lib/declutter/api");

beforeEach(() => {
  offer.mockReset();
  rpc.mockReset();
});

describe("Declutter actions offer the website's push ask after they succeed", () => {
  it.each([
    ["listing an item", () => publishItem("i1"), "live"],
    ["making an offer", () => makeOffer("i1", 1500), "offer-1"],
    ["Buy now", () => buyNow("i1", 2000), "hold-1"],
  ])("%s", async (_w, call, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(call()).resolves.toBe(data);
    expect(offer).toHaveBeenCalledOnce();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "item_not_available", code: "P0001" } });
    await expect(call()).rejects.toBeTruthy();
    expect(offer).toHaveBeenCalledOnce();
  });
});
