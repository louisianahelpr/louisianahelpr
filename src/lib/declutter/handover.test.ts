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
 * @mutate src/lib/declutter/handover.ts | select(`${cols}, attempts`).eq("seller_id", userId); | select(`${cols}, attempts`).eq("buyer_id", userId);
 * @mutate src/lib/declutter/handover.ts |   if (res.error && res.error.code === "42501" && /attempts\|permission denied/i.test(res.error.message ?? "")) { |   if (false) {
 * @mutate src/lib/declutter/handover.ts |       .eq("status", "open")\n      .order( |       .eq("status", "closed")\n      .order(
 * @mutate src/lib/declutter/handover.ts |   return (rows?.[0] ?? null) as |   return (rows ?? null) as
 * @mutate src/lib/declutter/handover.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_porch_note")) return "not_deployed"; |
 * @mutate src/lib/declutter/handover.ts | send(tags.length ? { ...base, p_tags: [...tags] } : base) | send(base)
 * @mutate src/lib/declutter/handover.ts |     res = await send(base); |
 * @mutate src/lib/declutter/handover.ts |   if (res.error) await discardRefusedHandoverPhoto(photoPath);\n  return rpcData(res, (e) => rpcErrorMessage("declutter_seller_picked_up", e)) | return rpcData(res, (e) => rpcErrorMessage("declutter_seller_picked_up", e))
 * @mutate src/lib/declutter/sellerDelivery.ts |   if (res.error) await discardRefusedHandoverPhoto(photoPath);\n  data(res, | data(res,
 * @mutate src/lib/declutter/handover.ts |   if (!isStorageObjectPath(path)) return; |
 * @mutate src/lib/declutter/handover.ts |     if (error) console.warn("[declutter] refused handover photo not removed", error.message); |
 * @mutate src/lib/declutter/handover.ts |     // Best effort: the member sees the RPC's refusal, never this cleanup's failure.\n | throw e;\n
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: unknown };

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const queries: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const store: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const removeResult: { error: unknown; throws: boolean } = { error: null, throws: false };

  const makeBuilder = (table: string) => {
    const q: { table: string; ops: [string, unknown[]][] } = { table, ops: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "eq", "limit"]) {
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
        // Audit 1a #10: the refused-photo cleanup. Its result never comes from the shared queue.
        remove: (...a: unknown[]) => {
          store.push(["remove", bucket, ...a]);
          return removeResult.throws ? Promise.reject(new Error("network down")) : Promise.resolve({ data: [], error: removeResult.error });
        },
      }),
    },
    // D2-7: the problem photo goes into the signed-in member's own folder (read from the local session).
    auth: { getSession: () => Promise.resolve({ data: { session: session.uid ? { user: { id: session.uid } } : null } }) },
  };
  const session = { uid: "u1" as string | null };
  return { queue, queries, rpcs, store, supabase, removeResult, session, clean: vi.fn() };
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
  sellerPickedUp,
  fetchItemAddress,
  fetchMyBookings,
  fetchMyPayouts,
  fetchOpenProblems,
  fetchOpenProblemsForAdmin,
  fetchOrderProblem,
  leaveReview,
  porchNote,
  porchPhoto,
  reportNoShow,
  reportProblem,
  setPorchTime,
  uploadHandoverPhoto,
  uploadProblemPhoto,
} from "./handover";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { markDelivered } from "./sellerDelivery";

const ok = (data: unknown): Result => ({ data, error: null });
const refused = (message: string): Result => ({ data: null, error: { message } });

beforeEach(() => {
  h.queue.length = 0;
  h.queries.length = 0;
  h.rpcs.length = 0;
  h.store.length = 0;
  h.removeResult.error = null;
  h.removeResult.throws = false;
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

  it("soldstates-4: fetchMyPayouts reads attempts, and reads as before while that column is refused (42501)", async () => {
    h.queue.push(ok([{ order_id: "o1", status: "failed", attempts: 12 }]));
    expect(await fetchMyPayouts("u1")).toEqual([{ order_id: "o1", status: "failed", attempts: 12 }]);
    h.queue.length = 0;
    h.queries.length = 0;
    h.queue.push({ data: null, error: { message: "permission denied for table declutter_payouts", code: "42501" } } as unknown as Result);
    h.queue.push(ok([{ order_id: "o1", status: "failed" }]));
    expect(await fetchMyPayouts("u1")).toEqual([{ order_id: "o1", status: "failed" }]);
    expect(h.queries.length).toBe(2);
    expect(h.queries[1].ops).toContainEqual(["eq", ["seller_id", "u1"]]);
  });

  it("fetchOpenProblemsForAdmin reads open problems oldest first", async () => {
    h.queue.push(ok([{ id: "p1" }]));
    expect(await fetchOpenProblemsForAdmin()).toEqual([{ id: "p1" }]);
    expect(h.queries[0].table).toBe("declutter_problems");
    expect(h.queries[0].ops).toContainEqual(["eq", ["status", "open"]]);
    expect(h.queries[0].ops).toContainEqual(["order", ["created_at", { ascending: true }]]);
  });

  // Audit 1b D2-2: both order cards read the order's OPEN problem (RLS lets the two sides read their own orders').
  // @mutate src/lib/declutter/handover.ts | rows = unwrap(await q.in("order_id", orderIds).eq("status", "open")); | rows = unwrap(await q.in("order_id", orderIds));
  // @mutate src/lib/declutter/handover.ts |   if (!orderIds.length) return []; |
  // @mutate src/lib/declutter/handover.ts | const rows = unwrap(await q.in("order_id", orderIds).eq("status", "open")); | const rows = (await q.in("order_id", orderIds).eq("status", "open")).data;
  it("fetchOpenProblems reads only open problems on these orders, skips an empty list, and surfaces a read error", async () => {
    expect(await fetchOpenProblems([])).toEqual([]);
    expect(h.queries).toHaveLength(0);
    h.queue.push(ok([{ id: "p1", order_id: "o1", reporter_side: "buyer", reason: "damaged" }]));
    expect(await fetchOpenProblems(["o1", "o2"])).toEqual([{ id: "p1", order_id: "o1", reporter_side: "buyer", reason: "damaged" }]);
    expect(h.queries[0].table).toBe("declutter_problems");
    expect(h.queries[0].ops).toContainEqual(["in", ["order_id", ["o1", "o2"]]]);
    expect(h.queries[0].ops).toContainEqual(["eq", ["status", "open"]]);
    h.queue.push(refused("permission denied"));
    await expect(fetchOpenProblems(["o1"])).rejects.toBeTruthy();
  });

  // Audit 1030 DB-1: the order card's problem read. select("*") was refused 42501 for every member on prod
  // (authenticated's column grant has no other_side_* or decided_by), so it goes through the party-scoped read
  // declutter_order_problem (20261030044444; PGlite proof src/test/pglite/declutterOrderProblemRead.pglite.mjs).
  // @mutate src/lib/declutter/handover.ts |   const res = await supabase.rpc("declutter_order_problem", { p_order_id: orderId }); |   const res = { data: null, error: { code: "PGRST202", message: "x", hint: null } };
  // @mutate src/lib/declutter/handover.ts | .select("id, reporter_side, reason, note, photo_paths, status, created_at") | .select("*")
  // @mutate src/lib/declutter/handover.ts |   return (rpcData(res, (e) => rpcErrorMessage("declutter_order_problem", e)) ?? null) as unknown as OrderProblem \| null; |   return (res.data ?? null) as unknown as OrderProblem \| null;
  it("fetchOrderProblem reads through declutter_order_problem, falls back to granted columns before deploy, and surfaces a refusal", async () => {
    const p = { id: "p1", reporter_side: "buyer", reason: "damaged", note: "x", photo_paths: [], status: "open", other_side_note: "y", other_side_photo_paths: [] };
    h.queue.push(ok(p));
    expect(await fetchOrderProblem("o1")).toEqual(p);
    expect(h.rpcs[0]).toEqual(["declutter_order_problem", { p_order_id: "o1" }]);
    expect(h.queries).toHaveLength(0);

    h.queue.push(ok(null));
    expect(await fetchOrderProblem("o2")).toBeNull();

    // Not deployed yet: the granted columns only, never "*" (which prod refuses).
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_order_problem(p_order_id)", hint: null } });
    h.queue.push(ok([{ id: "p2", status: "open" }]));
    expect(await fetchOrderProblem("o3")).toEqual({ id: "p2", status: "open" });
    expect(h.queries[0].table).toBe("declutter_problems");
    const sel = String(h.queries[0].ops.find(([m]) => m === "select")?.[1][0]);
    expect(sel).not.toMatch(/\*|other_side|decided_by|admin_note/);
    expect(h.queries[0].ops).toContainEqual(["eq", ["order_id", "o3"]]);

    h.queue.push(refused("problem_not_found"));
    await expect(fetchOrderProblem("o4")).rejects.toBeTruthy();
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

    h.queue.push(ok({ result: "handed_over", payout_id: "p9", by: "buyer" }));
    expect(await confirmHandover("o1")).toEqual({ result: "handed_over", payout_id: "p9", by: "buyer" });

    h.queue.push(ok({ result: "handed_over", payout_id: "p8", by: "seller" }));
    expect(await sellerPickedUp("o1", null)).toEqual({ result: "handed_over", payout_id: "p8", by: "seller" });

    h.queue.push(ok({ result: "picked_up", paid: true }));
    expect(await porchPhoto("o1", "u1/declutter/handover/o1/a.jpg", { lat: 30, lng: -92 })).toEqual({ result: "picked_up", paid: true });

    h.queue.push(ok({ result: "set_out" }));
    await porchPhoto("o1", "u1/declutter/handover/o1/b.jpg", null);

    h.queue.push(ok({ result: "reported" }));
    await reportNoShow("o1");

    h.queue.push(ok("p1"));
    expect(await reportProblem("o1", "damaged", "cracked", ["u1/declutter/handover/o1/c.jpg"])).toBe("p1");

    h.queue.push(ok("r1"));
    expect(await leaveReview("o1", 5, null)).toEqual({ id: "r1", tagsDropped: false });

    h.queue.push(ok({ refunded: true }));
    expect(await adminDecideProblem("p1", "refund_buyer", "seller", true, null)).toEqual({ refunded: true });
    // AL-5: "the report was false" adds p_false_report; without it the call is the five old arguments.
    h.queue.push(ok({ refunded: true }));
    expect(await adminDecideProblem("p2", "pay_seller", "buyer", false, null, true)).toEqual({ refunded: true });

    expect(h.rpcs).toEqual([
      ["declutter_book_pickup", { p_order_id: "o1", p_slot_start: "2026-10-20T15:00:00Z" }],
      ["declutter_set_porch_time", { p_order_id: "o1", p_mode: "until", p_until: "2026-10-20T18:00:00Z" }],
      ["declutter_confirm_handover", { p_order_id: "o1", p_method: "buyer", p_code: null }],
      ["declutter_seller_picked_up", { p_order_id: "o1", p_photo_path: null, p_lat: null, p_lng: null }],
      ["declutter_porch_photo", { p_order_id: "o1", p_photo_path: "u1/declutter/handover/o1/a.jpg", p_lat: 30, p_lng: -92 }],
      ["declutter_porch_photo", { p_order_id: "o1", p_photo_path: "u1/declutter/handover/o1/b.jpg", p_lat: null, p_lng: null }],
      ["declutter_report_no_show", { p_order_id: "o1" }],
      ["declutter_report_problem", { p_order_id: "o1", p_reason: "damaged", p_note: "cracked", p_photo_paths: ["u1/declutter/handover/o1/c.jpg"] }],
      ["declutter_leave_review", { p_order_id: "o1", p_stars: 5, p_comment: null }],
      ["declutter_admin_decide_problem", { p_problem_id: "p1", p_decision: "refund_buyer", p_fault: "seller", p_strike: true, p_note: null }],
      ["declutter_admin_decide_problem", { p_problem_id: "p2", p_decision: "pay_seller", p_fault: "buyer", p_strike: false, p_note: null, p_false_report: true }],
    ]);
  });

  it("a refusal is thrown, never swallowed, and carries a userMessage", async () => {
    h.queue.push(refused("order_not_paid"));
    const err = await confirmHandover("o1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(typeof (err as { userMessage?: unknown }).userMessage).toBe("string");
    expect((err as { userMessage: string }).userMessage.length).toBeGreaterThan(0);
  });
});

describe("leaveReview tags (Q2265)", () => {
  it("sends p_tags only when chosen; before the migration a tagged call is retried without them", async () => {
    h.queue.push(ok("r1"));
    await leaveReview("o1", 5, null);
    expect(h.rpcs[h.rpcs.length - 1]).toEqual(["declutter_leave_review", { p_order_id: "o1", p_stars: 5, p_comment: null }]);
    h.queue.push(ok("r2"));
    await leaveReview("o1", 5, null, ["easy_pickup"]);
    expect(h.rpcs[h.rpcs.length - 1]).toEqual(["declutter_leave_review", { p_order_id: "o1", p_stars: 5, p_comment: null, p_tags: ["easy_pickup"] }]);
    h.rpcs.length = 0;
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_leave_review(p_comment, p_order_id, p_stars, p_tags) in the schema cache", hint: null } });
    h.queue.push(ok("r3"));
    expect(await leaveReview("o1", 4, "ok", ["friendly"])).toEqual({ id: "r3", tagsDropped: true });
    expect(h.rpcs.map((r) => Object.keys(r[1] as object).includes("p_tags"))).toEqual([true, false]);
  });
});

describe("porchNote (Q2266)", () => {
  it("sends the note to declutter_porch_note; before the migration it answers not_deployed, any other refusal throws", async () => {
    h.queue.push(ok("By the swing"));
    expect(await porchNote("o1", "By the swing")).toBe("By the swing");
    expect(h.rpcs[h.rpcs.length - 1]).toEqual(["declutter_porch_note", { p_order_id: "o1", p_note: "By the swing" }]);
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_porch_note(p_note, p_order_id) in the schema cache", hint: null } });
    expect(await porchNote("o1", "x")).toBe("not_deployed");
    h.queue.push(refused("photo_first"));
    await expect(porchNote("o1", "x")).rejects.toThrow("photo_first");
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
    expect([op, bucket, upPath]).toEqual(["upload", "declutter-handover", path]);
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

describe("audit 1a #10: a refused handover photo is removed, and the refusal still surfaces", () => {
  const removes = () => h.store.filter((c) => c[0] === "remove");
  const P = "u1/declutter/handover/o1/x.jpg";

  it("porch photo, seller picked up and seller delivered: a refusal removes the photo and throws the RPC's error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.queue.push(refused("photo_too_old"));
    await expect(porchPhoto("o1", P, { lat: 30, lng: -92 })).rejects.toThrow(/photo_too_old/);
    h.queue.push(refused("photo_not_at_address"));
    await expect(sellerPickedUp("o1", P, { lat: 30, lng: -92 })).rejects.toThrow(/photo_not_at_address/);
    h.queue.push(refused("photo_too_old"));
    await expect(markDelivered("o1", P, { lat: 30, lng: -92 })).rejects.toThrow(/photo_too_old/);
    expect(removes()).toEqual([
      ["remove", "declutter-handover", [P]],
      ["remove", "declutter-handover", [P]],
      ["remove", "declutter-handover", [P]],
    ]);
  });

  it("an accepted photo is never removed, and no photo means nothing to remove", async () => {
    h.queue.push(ok({ result: "set_out" }));
    await porchPhoto("o1", P, null);
    h.queue.push(refused("not_your_order"));
    await expect(sellerPickedUp("o1", null)).rejects.toThrow(/not_your_order/);
    h.queue.push(refused("not_your_order"));
    await expect(markDelivered("o1", "")).rejects.toThrow(/not_your_order/);
    expect(removes()).toEqual([]);
  });

  it("a failed cleanup is logged and never replaces the RPC's error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.removeResult.error = { message: "denied" };
    h.queue.push(refused("photo_too_old"));
    await expect(porchPhoto("o1", P, null)).rejects.toThrow(/photo_too_old/);
    h.removeResult.error = null;
    h.removeResult.throws = true;
    h.queue.push(refused("photo_too_old"));
    await expect(porchPhoto("o1", P, null)).rejects.toThrow(/photo_too_old/);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[declutter] refused handover photo not removed", "[declutter] refused handover photo not removed"]);
  });
});

// Audit 1b D2-7: problem and refund photos go into <uid>/declutter/problem/<order>/, the folder the storage rule and
// declutter_report_problem accept; cleaned like every Declutter photo; a photo taken earlier is fine (evidence).
// @mutate src/lib/declutter/handover.ts | `${uid}/declutter/problem/${orderId}/${photoNonce()}.jpg` | `${uid}/declutter/handover/${orderId}/${photoNonce()}.jpg`
// @mutate src/lib/declutter/handover.ts |   if (!uid) throw new Error("not_authenticated"); |
// @mutate src/lib/declutter/handover.ts |   const problemPhoto = await cleanHandoverPhoto(file); |   const problemPhoto = file;
describe("uploadProblemPhoto", () => {
  const old = new File([new Uint8Array([1, 2, 3])], "x.heic", { type: "image/heic", lastModified: Date.now() - 3 * 86_400_000 });
  beforeEach(() => { h.session.uid = "u1"; });

  it("uploads the cleaned JPEG under the member's <uid>/declutter/problem/<order>/, even a photo taken days ago", async () => {
    h.clean.mockResolvedValue(new File([new Uint8Array([9])], "x.jpg", { type: "image/jpeg" }));
    h.queue.push(ok({ path: "ignored" }));
    const path = await uploadProblemPhoto("o1", old);
    expect(path).toMatch(/^u1\/declutter\/problem\/o1\/[^/]+\.jpg$/);
    expect(h.clean).toHaveBeenCalledWith(old);
    const [op, bucket, upPath, body, opts] = h.store[0] as [string, string, string, File, Record<string, unknown>];
    expect([op, bucket, upPath, body.type]).toEqual(["upload", "declutter-handover", path, "image/jpeg"]);
    expect(opts).toEqual({ contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
  });

  it("refuses when signed out, an uncleanable file, and a failed upload", async () => {
    h.session.uid = null;
    await expect(uploadProblemPhoto("o1", old)).rejects.toThrow("not_authenticated");
    expect(h.store).toHaveLength(0);
    h.session.uid = "u1";
    h.clean.mockResolvedValue(new File([new Uint8Array([9])], "x.gif", { type: "image/gif" }));
    await expect(uploadProblemPhoto("o1", old)).rejects.toThrow("photo_not_uploaded");
    expect(h.store).toHaveLength(0);
    h.clean.mockResolvedValue(new File([new Uint8Array([9])], "x.jpg", { type: "image/jpeg" }));
    h.queue.push(refused("storage down"));
    await expect(uploadProblemPhoto("o1", old)).rejects.toThrow("photo_not_uploaded");
  });
});
