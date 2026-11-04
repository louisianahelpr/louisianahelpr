/**
 * Q2711 PUSH-REACH, remaining ask moments (Builder 99, 2026-11-04; prod 11-03: 1 native token, 5 web subscriptions).
 * The website's push ask (offerPushAfterAction; its own 14-day cooldown, never over a dialog) already follows a sent
 * message, a job post, an application, and Declutter list / offer / Buy now. These are the other moments where the
 * member is now waiting on someone else: a question to a seller, asking for a free item (with or without a picked
 * time), posting a Wanted, and saving a search (its alerts are the point). Each offers the ask once it SUCCEEDS; a
 * refused call offers nothing.
 *
 * @mutate src/lib/declutter/api.ts |   // PUSH-REACH: the seller's answer to a question is what the asker waits for; the website's push ask.\n  offerPushAfterAction(); |
 * @mutate src/lib/declutter/api.ts |   // PUSH-REACH: being picked for a free item starts a 48-hour pickup clock; the website's push ask.\n  offerPushAfterAction(); |
 * @mutate src/lib/declutter/api.ts |   // PUSH-REACH: the giver's pick (with the time already chosen) is what the asker waits for; the website's push ask.\n  offerPushAfterAction(); |
 * @mutate src/lib/declutter/wanted.ts |   // PUSH-REACH: a Wanted exists so sellers reply, and a reply is what the poster waits for; the website's push ask.\n  offerPushAfterAction(); |
 * @mutate src/lib/savedSearches.ts |   // PUSH-REACH: a saved search exists to alert on new matches, so a push alert is the point; the website's push ask.\n  offerPushAfterAction(); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const offer = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const insertResult = vi.hoisted(() => ({ value: { data: [{ id: "s1" }], error: null } as unknown }));
const from = vi.hoisted(() => vi.fn(() => ({ insert: () => ({ select: () => Promise.resolve(insertResult.value) }) })));
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ offerPushAfterAction: offer }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from, functions: { invoke: vi.fn() } } }));

const { askQuestion, requestFree, requestFreeAt } = await import("@/lib/declutter/api");
const { createWanted } = await import("@/lib/declutter/wanted");
const { createSavedSearch } = await import("@/lib/savedSearches");

beforeEach(() => {
  offer.mockReset();
  rpc.mockReset();
});

const refusal = { data: null, error: { message: "item_not_available", code: "P0001" } };

describe("the other waiting moments offer the website's push ask after they succeed", () => {
  it.each([
    ["a question to the seller", () => askQuestion("i1", "Still there?"), "q-1"],
    ["asking for a free item", () => requestFree("i1"), "r-1"],
    ["asking for a free item at a picked time", () => requestFreeAt("i1", "2026-11-05T15:00:00Z"), "r-2"],
    [
      "posting a Wanted",
      () => createWanted({ what: "crib", category: "baby", maxPrice: "50", radius: 10 } as never, { lat: 30.2, lng: -92 }),
      "w-1",
    ],
  ])("%s", async (_w, call, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(call()).resolves.toBe(data);
    expect(offer).toHaveBeenCalledOnce();
    rpc.mockResolvedValueOnce(refusal);
    await expect(call()).rejects.toBeTruthy();
    expect(offer).toHaveBeenCalledOnce();
  });

  it("saving a search", async () => {
    const draft = { section: "jobs", query: "lawn", category: null, minDollars: null, maxDollars: null, radiusMiles: null } as never;
    insertResult.value = { data: [{ id: "s1" }], error: null };
    await expect(createSavedSearch("u1", draft, false)).resolves.toBe("s1");
    expect(offer).toHaveBeenCalledOnce();
    insertResult.value = { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
    await expect(createSavedSearch("u1", draft, false)).rejects.toBeTruthy();
    expect(offer).toHaveBeenCalledOnce();
  });
});
