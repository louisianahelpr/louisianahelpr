/**
 * Q2267 client calls: the opt-in rides p_public only when chosen (and before the migration the post goes up
 * private and says so); browse is [] before the migration; the reply and the toggle send exactly their arguments.
 *
 * @mutate src/lib/declutter/wanted.ts |   let res = await send(f.public ? { ...base, p_public: true } : base); |   let res = await send(base);
 * @mutate src/lib/declutter/wanted.ts |     repliesOn = false; |     repliesOn = true;
 * @mutate src/lib/declutter/wanted.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_wanted_browse")) return []; |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ queue: [] as { data: unknown; error: unknown }[], calls: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (...a: unknown[]) => { h.calls.push(a); return h.queue.shift() ?? { data: null, error: null }; } },
}));

import { createWanted, fetchWantedNear, replyToWanted, setWantedPublic, type WantedForm } from "./wanted";

const form: WantedForm = { what: "Kids bike", category: "baby_kids", maxPrice: "30", radius: 10, public: true };
const at = { lat: 30, lng: -92 };
const missing = (fn: string) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}(...) in the schema cache`, hint: null } });

beforeEach(() => { h.queue.length = 0; h.calls.length = 0; });

describe("Q2267 Wanted replies (client)", () => {
  it("createWanted: p_public only when on; before the migration it posts privately and says so", async () => {
    h.queue.push({ data: "w1", error: null });
    expect(await createWanted(form, at)).toEqual({ id: "w1", repliesOn: true });
    expect((h.calls[0][1] as Record<string, unknown>).p_public).toBe(true);
    h.queue.push({ data: "w2", error: null });
    expect(await createWanted({ ...form, public: false }, at)).toEqual({ id: "w2", repliesOn: false });
    expect(h.calls[1][1]).not.toHaveProperty("p_public");
    h.queue.push(missing("declutter_create_wanted"), { data: "w3", error: null });
    expect(await createWanted(form, at)).toEqual({ id: "w3", repliesOn: false });
    expect(h.calls[3][1]).not.toHaveProperty("p_public");
  });

  it("fetchWantedNear sends the point and answers [] before the migration", async () => {
    h.queue.push({ data: [{ id: "a" }], error: null });
    expect(await fetchWantedNear(at)).toEqual([{ id: "a" }]);
    expect(h.calls[0]).toEqual(["declutter_wanted_browse", { p_lat: 30, p_lng: -92 }]);
    h.queue.push(missing("declutter_wanted_browse"));
    expect(await fetchWantedNear(at)).toEqual([]);
  });

  it("replyToWanted and setWantedPublic send exactly their arguments", async () => {
    h.queue.push({ data: "o1", error: null }, { data: false, error: null });
    expect(await replyToWanted("w1", "i1", 2500)).toBe("o1");
    expect(await setWantedPublic("w1", false)).toBe(false);
    expect(h.calls).toEqual([
      ["declutter_wanted_reply", { p_wanted_id: "w1", p_item_id: "i1", p_amount_cents: 2500 }],
      ["declutter_set_wanted_public", { p_wanted_id: "w1", p_public: false }],
    ]);
  });
});
