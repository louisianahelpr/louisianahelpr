/**
 * Declutter slice 4 client calls (src/lib/declutter/handover.ts). Every write is
 * a declutter_* RPC with exactly the parameters the SQL takes; a refusal must
 * surface (never be swallowed) carrying its plain words on `userMessage`; every
 * read goes through unwrap(); the handover photo lands only under the one path
 * the SQL accepts, with metadata stripped and an immutable cache header.
 *
 * The Supabase client is a recording fake: each query, rpc and storage call is
 * logged, and results are handed out from a queue.
 *
 * @mutate src/lib/declutter/handover.ts |   if (orderIds.length === 0) return []; |   if (false) return [];
 * @mutate src/lib/declutter/handover.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (false) e.userMessage = msg;
 * @mutate src/lib/declutter/handover.ts |   if (error) throw new Error("photo_not_uploaded"); |   if (false) throw new Error("photo_not_uploaded");
 * @mutate src/lib/declutter/handover.ts |   const path = `${userId}/declutter/handover/${orderId}/${nonce}.jpg`; |   const path = `${userId}/declutter/${orderId}/${nonce}.jpg`;
 * @mutate src/lib/declutter/handover.ts |       .eq("seller_id", userId), |       .eq("buyer_id", userId),
 * @mutate src/lib/declutter/handover.ts |       .eq("status", "open") |       .eq("status", "closed")
 * @mutate src/lib/declutter/handover.ts |   return (rows?.[0] ?? null) as |   return (rows ?? null) as
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: unknown };

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const queries: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const store: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };

  const makeBuilder = (table: string) => {
    const q: { table: string; ops: [string, unknown[]][] } = { table, ops: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "eq"]) {
      b[m] = (...args: unknown[]) => {
        q.ops.push([m, args]);
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
    return b;
  };

  const supabase = {
    from: (table: string) => makeBuilder(table),
    rpc: (name: string, ...args: unknown[]) => {
      rpcs.push([name, ...args]);
      return Promise.resolve(next());
    },
    storage: {
      from: (bucket: string) => ({
        upload: (...a: unknown[]) => {
          store.push(["upload", bucket, ...a]);
          return Promise.resolve(next());
        },
      }),
    },
  };
  return { queue, queries, rpcs, store, supabase, clean: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/declutter/photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: h.clean,
}));

import {
  adminDecideProblem,
  bookPickup,
  confirmHandover,
  fetchItemAddress,
  fetchMyBookings,
  fetchMyHandover,
  fetchMyPayouts,
  fetchOpenProblemsForAdmin,
  leaveReview,
  porchPhoto,
  reportNoShow,
  reportProblem,
  setPorchTime,
  uploadHandoverPhoto,
} from "./handover";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";

const ok = (data: unknown): Result => ({ data, error: null });
const refused = (message: string): Result => ({ data: null, error: { message } });

beforeEach(() => {
  h.queue.length = 0;
  h.queries.length = 0;
  h.rpcs.length = 0;
  h.store.length = 0;
  h.clean.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("reads", () => {
  it("fetchMyBookings asks nothing for no orders, else reads exactly those orders' bookings", async () => {
    expect(await fetchMyBookings([])).toEqual([]);
    expect(h.queries).toHaveLength(0);

    const row = { order_id: "o1", slot_start: null, slot_end: null, porch_mode: null, porch_until: null };
    h.queue.push(ok([row]));
    expect(await fetchMyBookings(["o1", "o2"])).toEqual([row]);
    expect(h.queries[0].table).toBe("declutter_bookings");
    expect(h.queries[0].ops).toContainEqual(["in", ["order_id", ["o1", "o2"]]]);
  });

  it("fetchMyPayouts reads the caller's payouts as SELLER and surfaces a read error", async () => {
    h.queue.push(ok(null));
    expect(await fetchMyPayouts("u1")).toEqual([]);
    expect(h.queries[0].table).toBe("declutter_payouts");
    expect(h.queries[0].ops).toContainEqual(["eq", ["seller_id", "u1"]]);

    h.queue.push(refused("permission denied"));
    await expect(fetchMyPayouts("u1")).rejects.toBeTruthy();
  });

  it("fetchOpenProblemsForAdmin reads open problems oldest first", async () => {
    h.queue.push(ok([{ id: "p1" }]));
    expect(await fetchOpenProblemsForAdmin()).toEqual([{ id: "p1" }]);
    expect(h.queries[0].table).toBe("declutter_problems");
    expect(h.queries[0].ops).toContainEqual(["eq", ["status", "open"]]);
    expect(h.queries[0].ops).toContainEqual(["order", ["created_at", { ascending: true }]]);
  });

  it("fetchItemAddress returns the first row, or null when the caller may not see it", async () => {
    const addr = { pickup_address: "1 Main St", pickup_lat: 30.2, pickup_lng: -92.0 };
    h.queue.push(ok([addr]));
    expect(await fetchItemAddress("i1")).toEqual(addr);
    expect(h.rpcs[0]).toEqual(["declutter_item_address", { p_item_id: "i1" }]);

    h.queue.push(ok([]));
    expect(await fetchItemAddress("i1")).toBeNull();
  });
});

describe("writes send exactly the SQL's parameters", () => {
  it("each RPC", async () => {
    h.queue.push(ok({ result: "booked" }));
    expect(await bookPickup("o1", "2026-10-20T15:00:00Z")).toEqual({ result: "booked" });

    h.queue.push(ok(null));
    await setPorchTime("o1", "until", "2026-10-20T18:00:00Z");

    h.queue.push(ok({ order_id: "o1", side: "buyer", code: "1234" }));
    expect(await fetchMyHandover("o1")).toMatchObject({ code: "1234" });

    h.queue.push(ok({ result: "wrong_code", attempts_left: 2 }));
    expect(await confirmHandover("o1", "code", "9999")).toEqual({ result: "wrong_code", attempts_left: 2 });

    h.queue.push(ok({ result: "picked_up", paid: true }));
    expect(await porchPhoto("o1", "u1/declutter/handover/o1/a.jpg", { lat: 30, lng: -92 })).toEqual({ result: "picked_up", paid: true });

    h.queue.push(ok({ result: "set_out" }));
    await porchPhoto("o1", "u1/declutter/handover/o1/b.jpg", null);

    h.queue.push(ok({ result: "reported" }));
    await reportNoShow("o1");

    h.queue.push(ok("p1"));
    expect(await reportProblem("o1", "damaged", "cracked", ["u1/declutter/handover/o1/c.jpg"])).toBe("p1");

    h.queue.push(ok("r1"));
    expect(await leaveReview("o1", 5, null)).toBe("r1");

    h.queue.push(ok({ refunded: true }));
    expect(await adminDecideProblem("p1", "refund_buyer", "seller", true, null)).toEqual({ refunded: true });

    expect(h.rpcs).toEqual([
      ["declutter_book_pickup", { p_order_id: "o1", p_slot_start: "2026-10-20T15:00:00Z" }],
      ["declutter_set_porch_time", { p_order_id: "o1", p_mode: "until", p_until: "2026-10-20T18:00:00Z" }],
      ["declutter_my_handover", { p_order_id: "o1" }],
      ["declutter_confirm_handover", { p_order_id: "o1", p_method: "code", p_code: "9999" }],
      ["declutter_porch_photo", { p_order_id: "o1", p_photo_path: "u1/declutter/handover/o1/a.jpg", p_lat: 30, p_lng: -92 }],
      ["declutter_porch_photo", { p_order_id: "o1", p_photo_path: "u1/declutter/handover/o1/b.jpg", p_lat: null, p_lng: null }],
      ["declutter_report_no_show", { p_order_id: "o1" }],
      ["declutter_report_problem", { p_order_id: "o1", p_reason: "damaged", p_note: "cracked", p_photo_paths: ["u1/declutter/handover/o1/c.jpg"] }],
      ["declutter_leave_review", { p_order_id: "o1", p_stars: 5, p_comment: null }],
      ["declutter_admin_decide_problem", { p_problem_id: "p1", p_decision: "refund_buyer", p_fault: "seller", p_strike: true, p_note: null }],
    ]);
  });

  it("a refusal is thrown, never swallowed, and carries a userMessage", async () => {
    h.queue.push(refused("not_booked_yet"));
    const err = await confirmHandover("o1", "code", "0000").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(typeof (err as { userMessage?: unknown }).userMessage).toBe("string");
    expect((err as { userMessage: string }).userMessage.length).toBeGreaterThan(0);
  });
});

describe("uploadHandoverPhoto", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "x.heic", { type: "image/heic" });

  it("uploads the cleaned JPEG under <uid>/declutter/handover/<order>/, immutable, never overwriting", async () => {
    h.clean.mockResolvedValue(new File([new Uint8Array([9])], "x.jpg", { type: "image/jpeg" }));
    h.queue.push(ok({ path: "ignored" }));
    const path = await uploadHandoverPhoto("u1", "o1", file);
    expect(path).toMatch(/^u1\/declutter\/handover\/o1\/[^/]+\.jpg$/);
    const [op, bucket, upPath, , opts] = h.store[0] as [string, string, string, unknown, Record<string, unknown>];
    expect([op, bucket, upPath]).toEqual(["upload", "job-photos", path]);
    expect(opts).toEqual({ contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
  });

  it("refuses a file the cleaner could not turn into an upload type, and a failed upload", async () => {
    h.clean.mockResolvedValue(new File([new Uint8Array([9])], "x.gif", { type: "image/gif" }));
    await expect(uploadHandoverPhoto("u1", "o1", file)).rejects.toThrow("photo_not_uploaded");
    expect(h.store).toHaveLength(0);

    h.clean.mockResolvedValue(new File([new Uint8Array([9])], "x.jpg", { type: "image/jpeg" }));
    h.queue.push(refused("storage down"));
    await expect(uploadHandoverPhoto("u1", "o1", file)).rejects.toThrow("photo_not_uploaded");
  });
});
