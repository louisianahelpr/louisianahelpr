/**
 * The shared Helpr task module's client calls (src/lib/helprTasks/api.ts) and
 * Declutter delivery's price mirror + quote call (src/lib/declutter/delivery.ts).
 *
 * Unit tests of the request each call sends and how it reads the answer; the
 * Supabase client is doubled the same way src/lib/declutter/api.test.ts does
 * (coverage floor for src/lib). The rules themselves are proven against a
 * real Postgres in src/test/pglite/declutterDelivery.pglite.mjs, and the price
 * formula is held to the SQL text below.
 *
 * @mutate src/lib/declutter/delivery.ts | export const DELIVERY_PER_MILE_CENTS = 150; | export const DELIVERY_PER_MILE_CENTS = 200;
 * @mutate src/lib/declutter/delivery.ts |   const miles = Math.max(1, Math.ceil(Number.isFinite(roadMiles) ? roadMiles : 1)); |   const miles = Math.max(0, Math.floor(Number.isFinite(roadMiles) ? roadMiles : 0));
 * @mutate src/lib/declutter/delivery.ts |   return roundPayoutDownCents(pay - Math.min(pay, Math.round((pay * 5) / 100) + 70)); |   return roundPayoutDownCents(pay - Math.round((pay * 5) / 100));
 * @mutate src/lib/declutter/delivery.ts |   return roundPayoutDownCents(pay - Math.min(pay, Math.round((pay * 5) / 100) + 70)); |   return pay - Math.min(pay, Math.round((pay * 5) / 100) + 70);
 * @mutate src/lib/helprTasks/api.ts |   if (!result.error) return result.data as T; |   return result.data as T;
 * @mutate src/lib/helprTasks/api.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     void msg;
 * @mutate src/lib/helprTasks/api.ts | `${userId}/task/${taskId}/${nonce()}.jpg` | `${userId}/${taskId}/${nonce()}.jpg`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: unknown };

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const queries: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const store: unknown[][] = [];
  const invokes: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const makeBuilder = (table: string) => {
    const q: { table: string; ops: [string, unknown[]][] } = { table, ops: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    const op = (m: string) => (...args: unknown[]) => {
      q.ops.push([m, args]);
      return b;
    };
    b.select = op("select");
    b.eq = op("eq");
    b.maybeSingle = op("maybeSingle");
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
        createSignedUrl: (...a: unknown[]) => {
          store.push(["sign", bucket, ...a]);
          return Promise.resolve(next());
        },
      }),
    },
    functions: {
      invoke: (...a: unknown[]) => {
        invokes.push(a);
        return Promise.resolve(next());
      },
    },
  };
  return { queue, queries, rpcs, store, invokes, supabase, clean: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/declutter/photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: h.clean,
}));

import {
  acceptTask,
  confirmReceived,
  fetchMyTasks,
  fetchMyVehicle,
  fetchOpenTasks,
  fetchTaskView,
  markDelivered,
  markPickedUp,
  releaseTask,
  reportPickupNoShow,
  saveVehicle,
  taskPhotoUrl,
  uploadTaskPhoto,
  uploadVehiclePhoto,
} from "./api";
import {
  DELIVERY_BASE_CENTS,
  DELIVERY_PER_MILE_CENTS,
  DELIVERY_SIZE_CENTS,
  deliveryPriceCents,
  fetchDeliveryQuote,
  helprTakeHomeCents,
} from "@/lib/declutter/delivery";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { newestFunction } from "@/test/helpers/parityReaders";

const ok = (data: unknown): Result => ({ data, error: null });
const refused = (message: string): Result => ({ data: null, error: { message } });
// The NEWEST definition of each priced function, never one migration by name
// (src/test/guardsReadTheNewestMigration.test.ts): a later restatement must be graded.
const PRICE_SQL = newestFunction("declutter_delivery_price_cents").body;
const FEE_SQL = newestFunction("helpr_task_fee_cents").body;

beforeEach(() => {
  h.queue.length = 0;
  h.queries.length = 0;
  h.rpcs.length = 0;
  h.store.length = 0;
  h.invokes.length = 0;
  h.clean.mockReset();
});

describe("delivery price mirror (row 29) agrees with the SQL", () => {
  it("uses the same constants as declutter_delivery_price_cents", () => {
    expect(PRICE_SQL.length).toBeGreaterThan(50); // the body was read, not an empty match
    expect(PRICE_SQL).toContain("SELECT 600 + 150 * greatest(COALESCE(p_miles, 1), 1)");
    expect(PRICE_SQL).toContain("CASE s WHEN 'large' THEN 2000 WHEN 'xl' THEN 4000 ELSE 0 END");
    expect([DELIVERY_BASE_CENTS, DELIVERY_PER_MILE_CENTS]).toEqual([600, 150]); // owner 2026-11-01: $6 + $1.50 a mile
    expect(DELIVERY_SIZE_CENTS).toEqual({ small: 0, large: 2000, xl: 4000 });
  });

  it("prices one checkout: one base + miles, a size add-on per item", () => {
    expect(deliveryPriceCents(1, ["small"])).toBe(750);
    expect(deliveryPriceCents(10, ["small", "large", "xl"])).toBe(600 + 1500 + 6000);
    expect(deliveryPriceCents(0, ["small"])).toBe(750);
    expect(deliveryPriceCents(4.2, ["large"])).toBe(600 + 750 + 2000);
    expect(deliveryPriceCents(Number.NaN, [])).toBe(750);
  });

  it("the Helpr keeps the fee minus jobs' flat 5% + 70c (same as helpr_task_fee_cents), rounded down to the dollar", () => {
    expect(FEE_SQL.length).toBeGreaterThan(50);
    expect(FEE_SQL).toContain("ELSE least(p_pay_cents, round(p_pay_cents * 5 / 100.0)::integer + 70) END;");
    // Owner 2026-10-21: the payout is whole dollars, rounded DOWN (the platform keeps the cents).
    expect(helprTakeHomeCents(1200)).toBe(1000); // 1200 - 60 - 70 = 1070
    expect(helprTakeHomeCents(4000)).toBe(3700); // 4000 - 200 - 70 = 3730
    expect(helprTakeHomeCents(4400)).toBe(4100); // 4400 - 220 - 70 = 4110
    expect(helprTakeHomeCents(50)).toBe(0);
    expect(helprTakeHomeCents(0)).toBe(0);
    // A half cent rounds UP in the fee in both (SQL round(numeric) and Math.round agree for positive cents):
    // 1010 -> 50.5 -> 51 + 70 = 121, take-home 889 -> 800.
    expect(helprTakeHomeCents(1010)).toBe(800);
    expect(FEE_SQL).toContain("least(p_pay_cents, round(p_pay_cents * 5 / 100.0)::integer + 70)");
  });
});

describe("fetchDeliveryQuote", () => {
  it("asks declutter-checkout to geocode the address on the server (no coordinates sent)", async () => {
    const quote = { road_miles: 5, size: "large", delivery_cents: 4000, base_cents: 1000, per_mile_cents: 1000, size_cents: 2000, dropoff_area: "Baker, LA" };
    h.queue.push(ok({ quote }));
    await expect(fetchDeliveryQuote("seller-1", "900 Far Rd, Baker")).resolves.toEqual(quote);
    expect(h.invokes[0]).toEqual(["declutter-checkout", { body: { action: "delivery_quote", seller_id: "seller-1", address: "900 Far Rd, Baker" } }]);
  });

  it("a refusal carries the server's code, worded by declutterErrorMessage", async () => {
    const ctx = new Response(JSON.stringify({ error: "address_not_found" }), { status: 422 });
    h.queue.push({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } });
    const err = await fetchDeliveryQuote("s", "1 Nowhere Ln").catch((e: unknown) => e);
    expect((err as Error).message).toBe("address_not_found");
    expect(declutterErrorMessage(err)).toMatch(/couldn't find that address/);
  });

  it("an answer that is not a quote is never shown as a price", async () => {
    h.queue.push(ok({ quote: { delivery_cents: "40" } }));
    await expect(fetchDeliveryQuote("s", "1 Main St, Baker")).rejects.toThrow("delivery_check_unavailable");
  });
});

describe("Helpr task calls", () => {
  it("finds open tasks near a point, or without one", async () => {
    h.queue.push(ok([{ task_id: "t1" }]), ok(null));
    await expect(fetchOpenTasks({ lat: 30.4, lng: -91.1 })).resolves.toEqual([{ task_id: "t1" }]);
    await expect(fetchOpenTasks(null)).resolves.toEqual([]);
    expect(h.rpcs[0]).toEqual(["helpr_tasks_open_near", { p_lat: 30.4, p_lng: -91.1, p_limit: 50 }]);
    expect(h.rpcs[1]).toEqual(["helpr_tasks_open_near", { p_lat: null, p_lng: null, p_limit: 50 }]);
  });

  it("reads the caller's tasks and one task's view", async () => {
    h.queue.push(ok(null), ok({ task_id: "t1", role: "helpr" }));
    await expect(fetchMyTasks()).resolves.toEqual([]);
    await expect(fetchTaskView("t1")).resolves.toMatchObject({ role: "helpr" });
    expect(h.rpcs.map((r) => r[0])).toEqual(["helpr_my_tasks", "helpr_task_view"]);
  });

  it("every step sends exactly its arguments", async () => {
    for (let i = 0; i < 7; i++) h.queue.push(ok({ result: "ok", strike: false }));
    await acceptTask("t1", "2026-10-20T15:00:00.000Z");
    await releaseTask("t1");
    await markPickedUp("t1", "u/task/t1/p.jpg", { lat: 30.45, lng: -91.15 });
    await markDelivered("t1", "u/task/t1/d.jpg", { lat: 30.5, lng: -91.15 });
    await markDelivered("t1", null, null);
    await reportPickupNoShow("t1", "u/task/t1/a.jpg", { lat: 30.45, lng: -91.15 });
    await confirmReceived("t1");
    expect(h.rpcs).toEqual([
      ["helpr_task_accept", { p_task_id: "t1", p_pickup_slot_start: "2026-10-20T15:00:00.000Z" }],
      ["helpr_task_release", { p_task_id: "t1" }],
      ["helpr_task_picked_up", { p_task_id: "t1", p_photo_path: "u/task/t1/p.jpg", p_lat: 30.45, p_lng: -91.15 }],
      ["helpr_task_delivered", { p_task_id: "t1", p_photo_path: "u/task/t1/d.jpg", p_lat: 30.5, p_lng: -91.15, p_code: null }],
      ["helpr_task_delivered", { p_task_id: "t1", p_photo_path: null, p_lat: null, p_lng: null, p_code: null }],
      ["helpr_task_pickup_no_show", { p_task_id: "t1", p_photo_path: "u/task/t1/a.jpg", p_lat: 30.45, p_lng: -91.15 }],
      ["helpr_task_customer_confirm", { p_task_id: "t1" }],
    ]);
  });

  it("a refusal throws the server's code (never a silent success)", async () => {
    h.queue.push(refused("task_taken"));
    const err = await acceptTask("t1", "2026-10-20T15:00:00.000Z").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(declutterErrorMessage(err)).toBe("Another Helpr took this delivery, or it closed.");
    // ...and carries the RPC's own words (RPC_ERROR_COPY) for the shared error toasts.
    expect(typeof (err as { userMessage?: unknown }).userMessage).toBe("string");
  });

  it("vehicle: reads the caller's row and saves through the RPC", async () => {
    h.queue.push(ok({ has_car: true, has_truck: true, second_person: false, photo_path: "u/vehicle/a.jpg" }), ok({}));
    await expect(fetchMyVehicle("u")).resolves.toMatchObject({ has_truck: true });
    expect(h.queries[0]).toEqual({ table: "helpr_vehicles", ops: [["select", ["has_car, has_truck, second_person, photo_path"]], ["eq", ["user_id", "u"]], ["maybeSingle", []]] });
    await saveVehicle(true, false, false, null);
    expect(h.rpcs[0]).toEqual(["helpr_set_vehicle", { p_has_car: true, p_has_truck: false, p_second_person: false, p_photo_path: null }]);
  });
});

describe("photos go to the private bucket at the paths the SQL accepts", () => {
  const jpeg = () => new File([new Uint8Array([1, 2, 3])], "x.jpg", { type: "image/jpeg" });

  it("task photo: <uid>/task/<task>/<file>.jpg, cleaned, never overwriting", async () => {
    h.clean.mockResolvedValue(jpeg());
    h.queue.push(ok({}));
    const path = await uploadTaskPhoto("u1", "t1", jpeg());
    expect(path).toMatch(/^u1\/task\/t1\/[^/]+\.jpg$/);
    expect(h.store[0][0]).toBe("upload");
    expect(h.store[0][1]).toBe("helpr-tasks");
    expect(h.store[0][4]).toMatchObject({ contentType: "image/jpeg", upsert: false });
  });

  it("vehicle photo: <uid>/vehicle/<file>.jpg", async () => {
    h.clean.mockResolvedValue(jpeg());
    h.queue.push(ok({}));
    await expect(uploadVehiclePhoto("u1", jpeg())).resolves.toMatch(/^u1\/vehicle\/[^/]+\.jpg$/);
  });

  it("an upload that fails, or a file that cannot be cleaned to a JPEG, is refused", async () => {
    h.clean.mockResolvedValue(jpeg());
    h.queue.push({ data: null, error: { message: "denied" } });
    await expect(uploadTaskPhoto("u1", "t1", jpeg())).rejects.toThrow("photo_not_uploaded");
    h.clean.mockResolvedValue(new File(["x"], "x.gif", { type: "image/gif" }));
    await expect(uploadTaskPhoto("u1", "t1", jpeg())).rejects.toThrow("photo_not_uploaded");
  });

  it("photos are read through a short-lived signed URL; one that cannot be signed is an error, never silently nothing", async () => {
    h.queue.push(ok({ signedUrl: "https://signed.test/a" }), { data: null, error: { message: "not allowed" } });
    await expect(taskPhotoUrl("u/task/t/a.jpg")).resolves.toBe("https://signed.test/a");
    await expect(taskPhotoUrl("u/task/t/b.jpg")).rejects.toThrow("photo_unavailable");
    expect(h.store[0]).toEqual(["sign", "helpr-tasks", "u/task/t/a.jpg", 600]);
  });
});
