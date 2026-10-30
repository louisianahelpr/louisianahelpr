/**
 * Q2267 client calls. Owner 2026-10-30 (via the lead): a Wanted is ALWAYS visible to sellers near the poster, so
 * createWanted always sends p_public: true (the "Let sellers near me reply" switch and setWantedPublic are gone);
 * browse is [] before its migration; the reply sends exactly its arguments.
 *
 * @mutate src/lib/declutter/wanted.ts | p_lat: at.lat, p_lng: at.lng, p_public: true, | p_lat: at.lat, p_lng: at.lng,
 * @mutate src/lib/declutter/wanted.ts | p_lat: at.lat, p_lng: at.lng, p_public: true, | p_lat: at.lat, p_lng: at.lng, p_public: false,
 * @mutate src/lib/declutter/wanted.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_wanted_browse")) return []; |
 * @mutate src/lib/declutter/wanted.ts |     replies: parseReplies(w.replies), |     replies: (w.replies ?? []) as WantedReply[],
 * @mutate src/lib/declutter/wanted.ts |     photo_paths: Array.isArray(w.photo_paths) ? w.photo_paths : [], |     photo_paths: w.photo_paths,
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ queue: [] as { data: unknown; error: unknown }[], calls: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (...a: unknown[]) => { h.calls.push(a); return h.queue.shift() ?? { data: null, error: null }; } },
}));

import { createWanted, fetchMyWanted, fetchWantedNear, replyToWanted, type WantedForm } from "./wanted";

const form: WantedForm = { what: "Kids bike", category: "baby_kids", maxPrice: "30", radius: 10 };
const at = { lat: 30, lng: -92 };
const missing = (fn: string) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}(...) in the schema cache`, hint: null } });

beforeEach(() => { h.queue.length = 0; h.calls.length = 0; });

describe("Q2267 Wanted replies (client)", () => {
  it("createWanted: every post is open to sellers near the poster (p_public: true), with exactly the form's fields", async () => {
    h.queue.push({ data: "w1", error: null });
    expect(await createWanted(form, at)).toBe("w1");
    expect(h.calls[0]).toEqual(["declutter_create_wanted", {
      p_what: "Kids bike", p_category: "baby_kids", p_max_price_cents: 3000, p_radius_miles: 10, p_lat: 30, p_lng: -92, p_public: true,
    }]);
  });

  it("fetchWantedNear sends the point and answers [] before the migration", async () => {
    h.queue.push({ data: [{ id: "a" }], error: null });
    expect(await fetchWantedNear(at)).toEqual([{ id: "a" }]);
    expect(h.calls[0]).toEqual(["declutter_wanted_browse", { p_lat: 30, p_lng: -92 }]);
    h.queue.push(missing("declutter_wanted_browse"));
    expect(await fetchWantedNear(at)).toEqual([]);
  });

  // 20261030041359: your posts carry their photos and the sellers' replies; anything malformed is dropped, and a
  // server without the migration (no columns) reads as no photos and no replies.
  it("fetchMyWanted reads photo_paths and replies, dropping malformed replies", async () => {
    const good = { offer_id: "o1", item_id: "i1", item_title: "Red bike", seller_name: "Sam G.", amount_cents: 2500, status: "open", awaiting: "buyer", created_at: "2026-10-30" };
    h.queue.push({ data: [
      { id: "w1", status: "open", matches: [], photo_paths: ["u/wanted/w1/a.jpg"], replies: [good, { offer_id: 7 }, null] },
      { id: "w2", status: "open", matches: [] },
    ], error: null });
    const rows = await fetchMyWanted();
    expect(rows[0].photo_paths).toEqual(["u/wanted/w1/a.jpg"]);
    expect(rows[0].replies).toEqual([good]);
    expect(rows[1].photo_paths).toEqual([]);
    expect(rows[1].replies).toEqual([]);
  });

  it("replyToWanted sends exactly its arguments", async () => {
    h.queue.push({ data: "o1", error: null });
    expect(await replyToWanted("w1", "i1", 2500)).toBe("o1");
    expect(h.calls).toEqual([["declutter_wanted_reply", { p_wanted_id: "w1", p_item_id: "i1", p_amount_cents: 2500 }]]);
  });
});
