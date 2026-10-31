/**
 * Declutter seller delivery's client calls (src/lib/declutter/sellerDelivery.ts).
 * Each sends the RPC its name says with its arguments (the optional free-over
 * amount omitted, never sent as null); a refusal throws an Error whose message
 * is the server's code, carrying that RPC's plain words on `userMessage` and the
 * original error as `cause`; the checkout quote turns a refused function call
 * into its code.
 *
 * The rules mirror is pinned by src/test/declutterSellerDelivery.test.ts; the
 * Supabase client here is a recording fake (calls logged, results queued).
 *
 * @mutate src/lib/declutter/sellerDelivery.ts |     if (w) err.userMessage = w; |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const rpcs: unknown[][] = [];
  const invokes: unknown[][] = [];
  const position = { impl: async (): Promise<{ lat: number; lng: number }> => ({ lat: 30.45, lng: -91.18 }) };
  const next = () => queue.shift() ?? { data: null, error: null };
  return {
    queue,
    rpcs,
    invokes,
    position,
    supabase: {
      rpc: (...a: unknown[]) => (rpcs.push(a), Promise.resolve(next())),
      functions: { invoke: (...a: unknown[]) => (invokes.push(a), Promise.resolve(next())) },
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("./position", () => ({ currentPosition: () => h.position.impl() }));

import {
  answerDeliveryTime,
  deliveryPhotoPosition,
  fetchDeliveryOpenTimes,
  fetchMySellerDelivery,
  fetchSellerDeliveryBooking,
  fetchSellerDeliveryOffer,
  markDelivered,
  proposeDeliveryTime,
  quoteSellerDelivery,
  reportNotDelivered,
  saveDeliverySchedule,
  saveSellerDelivery,
  setDeliveryHandoff,
  setItemSellerDelivery,
} from "./sellerDelivery";
import { SELLER_DELIVERY_RPC_ERROR_COPY as T } from "./sellerDeliveryErrors";

type Thrown = Error & { userMessage?: string; cause?: unknown };

beforeEach(() => {
  h.queue.length = 0;
  h.rpcs.length = 0;
  h.invokes.length = 0;
  h.position.impl = async () => ({ lat: 30.45, lng: -91.18 });
});

async function thrown(p: Promise<unknown>): Promise<Thrown> {
  try {
    await p;
  } catch (e) {
    return e as Thrown;
  }
  throw new Error("expected a throw");
}

describe("each call sends its RPC and hands back the answer", () => {
  it("settings: read, save (free-over omitted unless set), schedule, per-item switch", async () => {
    const settings = { enabled: true, rate_cents: 1500 };
    h.queue.push({ data: settings }, { data: settings }, { data: settings }, { data: settings }, { data: true }, { data: false });
    await expect(fetchMySellerDelivery()).resolves.toEqual(settings);
    await saveSellerDelivery(true, 1500, 10);
    await saveSellerDelivery(true, 1500, 10, 5000);
    await saveDeliverySchedule([{ weekday: 1, start: "09:00", end: "12:00" }] as never, ["2026-11-26"]);
    await expect(setItemSellerDelivery("i1", true)).resolves.toBe(true);
    await expect(setItemSellerDelivery("i1", false)).resolves.toBe(false);
    expect(h.rpcs).toEqual([
      ["declutter_my_seller_delivery"],
      ["declutter_set_seller_delivery", { p_enabled: true, p_rate_cents: 1500, p_radius_miles: 10 }],
      ["declutter_set_seller_delivery", { p_enabled: true, p_rate_cents: 1500, p_radius_miles: 10, p_free_over_cents: 5000 }],
      ["declutter_set_delivery_schedule", { p_windows: [{ weekday: 1, start: "09:00", end: "12:00" }], p_days_off: ["2026-11-26"] }],
      ["declutter_set_item_seller_delivery", { p_item_id: "i1", p_on: true }],
      ["declutter_set_item_seller_delivery", { p_item_id: "i1", p_on: false }],
    ]);
  });

  it("an order's booking, open times and a seller's offer", async () => {
    h.queue.push({ data: { slot_start: "s" } }, { data: { slots: ["a"], slot_minutes: 60 } }, { data: { available: true, slots: [] } });
    await expect(fetchSellerDeliveryBooking("o1")).resolves.toEqual({ slot_start: "s" });
    await expect(fetchDeliveryOpenTimes("o1")).resolves.toEqual({ slots: ["a"], slot_minutes: 60 });
    await expect(fetchSellerDeliveryOffer("seller1")).resolves.toEqual({ available: true, slots: [] });
    expect(h.rpcs).toEqual([
      ["declutter_seller_delivery_booking", { p_order_id: "o1" }],
      ["declutter_delivery_open_times", { p_order_id: "o1" }],
      ["declutter_seller_delivery_offer", { p_seller_id: "seller1" }],
    ]);
  });

  it("delivered with or without a position, not delivered, the handoff", async () => {
    h.queue.push({}, {}, {}, { data: "door" });
    await markDelivered("o1", "u/p.jpg", { lat: 30.1, lng: -90.2 });
    await markDelivered("o1", "u/p.jpg");
    await reportNotDelivered("o1");
    await expect(setDeliveryHandoff("o1", "door" as never)).resolves.toBe("door");
    expect(h.rpcs).toEqual([
      ["declutter_seller_delivered", { p_order_id: "o1", p_photo_path: "u/p.jpg", p_lat: 30.1, p_lng: -90.2 }],
      ["declutter_seller_delivered", { p_order_id: "o1", p_photo_path: "u/p.jpg", p_lat: null, p_lng: null }],
      ["declutter_report_not_delivered", { p_order_id: "o1" }],
      ["declutter_set_delivery_handoff", { p_order_id: "o1", p_handoff: "door" }],
    ]);
  });

  it("moving the time answers the server's result word", async () => {
    h.queue.push({ data: { result: "proposed" } }, { data: { result: "slot_taken" } });
    await expect(proposeDeliveryTime("o1", "2026-11-02T15:00:00Z")).resolves.toBe("proposed");
    await expect(answerDeliveryTime("o1", true)).resolves.toBe("slot_taken");
    expect(h.rpcs).toEqual([
      ["declutter_propose_delivery_time", { p_order_id: "o1", p_slot_start: "2026-11-02T15:00:00Z" }],
      ["declutter_answer_delivery_time", { p_order_id: "o1", p_accept: true }],
    ]);
  });
});

describe("a refusal", () => {
  it("throws the code as the message, that RPC's words as userMessage, the original as cause", async () => {
    const err = { message: "slot_unavailable", code: "P0001" };
    h.queue.push({ data: null, error: err });
    const e = await thrown(proposeDeliveryTime("o1", "2026-11-02T15:00:00Z"));
    expect(e.message).toBe("slot_unavailable");
    expect(e.userMessage).toBe(T.declutter_propose_delivery_time.slot_unavailable);
    expect(e.cause).toBe(err);
  });

  it("each RPC uses its own table: the same code reads differently for the door choice", async () => {
    h.queue.push({ error: { message: "not_reschedulable" } }, { error: { message: "not_reschedulable" } });
    const move = await thrown(proposeDeliveryTime("o1", "s"));
    const door = await thrown(setDeliveryHandoff("o1", "door" as never));
    expect(move.userMessage).toBe(T.declutter_propose_delivery_time.not_reschedulable);
    expect(door.userMessage).toBe(T.declutter_set_delivery_handoff.not_reschedulable);
    expect(move.userMessage).not.toBe(door.userMessage);
  });

  it("every call reads its refusal from its OWN RPC's table (floor)", async () => {
    const calls: [keyof typeof T, () => Promise<unknown>][] = [
      ["declutter_my_seller_delivery", () => fetchMySellerDelivery()],
      ["declutter_set_seller_delivery", () => saveSellerDelivery(true, 1500, 10)],
      ["declutter_set_delivery_schedule", () => saveDeliverySchedule([], [])],
      ["declutter_set_item_seller_delivery", () => setItemSellerDelivery("i1", true)],
      ["declutter_seller_delivery_booking", () => fetchSellerDeliveryBooking("o1")],
      ["declutter_seller_delivered", () => markDelivered("o1", "p.jpg")],
      ["declutter_report_not_delivered", () => reportNotDelivered("o1")],
      ["declutter_set_delivery_handoff", () => setDeliveryHandoff("o1", "door" as never)],
      ["declutter_propose_delivery_time", () => proposeDeliveryTime("o1", "s")],
      ["declutter_answer_delivery_time", () => answerDeliveryTime("o1", true)],
      ["declutter_delivery_open_times", () => fetchDeliveryOpenTimes("o1")],
      ["declutter_seller_delivery_offer", () => fetchSellerDeliveryOffer("seller1")],
    ];
    expect(calls.length).toBeGreaterThan(11);
    for (const [rpc, call] of calls) {
      // A code only THIS RPC words the way it does (the last entry of its table).
      const [code, words] = Object.entries(T[rpc]).slice(-1)[0]!;
      h.queue.push({ error: { message: code } });
      const e = await thrown(call());
      expect(h.rpcs.slice(-1)[0]?.[0], rpc).toBe(rpc);
      expect(e.userMessage, `${rpc}.${code}`).toBe(words);
    }
  });

  it("a code the RPC has no words for still throws, with no userMessage", async () => {
    h.queue.push({ error: { message: "connection reset" } });
    const e = await thrown(fetchMySellerDelivery());
    expect(e.message).toBe("connection reset");
    expect(e.userMessage).toBeUndefined();
  });
});

describe("deliveryPhotoPosition", () => {
  it("answers the device's position", async () => {
    await expect(deliveryPhotoPosition()).resolves.toEqual({ lat: 30.45, lng: -91.18 });
  });

  it("refused location carries the delivered RPC's words about the buyer's address", async () => {
    h.position.impl = async () => {
      throw new Error("location_required");
    };
    const e = await thrown(deliveryPhotoPosition());
    expect(e.message).toBe("location_required");
    expect(e.userMessage).toBe(T.declutter_seller_delivered.location_required);
  });

  it("an error it has no words for is rethrown untouched (a frozen one too)", async () => {
    const frozen = Object.freeze(new Error("location_required"));
    h.position.impl = async () => {
      throw frozen;
    };
    expect(await thrown(deliveryPhotoPosition())).toBe(frozen);
    h.position.impl = async () => {
      throw new Error("timeout");
    };
    expect((await thrown(deliveryPhotoPosition())).userMessage).toBeUndefined();
  });
});

describe("quoteSellerDelivery", () => {
  const offer = { available: true, slots: ["2026-11-02T15:00:00Z"], rate_cents: 1500 };

  it("asks declutter-checkout for the quote, with the address only when one is given", async () => {
    h.queue.push({ data: { offer } }, { data: { offer } });
    await expect(quoteSellerDelivery("seller1")).resolves.toEqual(offer);
    await quoteSellerDelivery("seller1", "123 Main St, Baton Rouge");
    expect(h.invokes[0][0]).toBe("declutter-checkout");
    const b0 = (h.invokes[0][1] as { body: Record<string, unknown> }).body;
    const b1 = (h.invokes[1][1] as { body: Record<string, unknown> }).body;
    expect(b0).toMatchObject({ action: "seller_delivery_quote", seller_id: "seller1" });
    expect(b0).not.toHaveProperty("address");
    expect(b1.address).toBe("123 Main St, Baton Rouge");
  });

  it("a refused call throws the function's code from its JSON body", async () => {
    const context = new Response(JSON.stringify({ error: "delivery_out_of_range" }), { status: 400 });
    h.queue.push({ data: null, error: { message: "Edge Function returned a non-2xx status code", context } });
    expect((await thrown(quoteSellerDelivery("seller1"))).message).toBe("delivery_out_of_range");
  });

  it("a body that is not JSON, no body, or an empty code reads as payment_unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.queue.push(
      { error: { message: "x", context: new Response("<html>502</html>", { status: 502 }) } },
      { error: { message: "x" } },
      { error: { message: "x", context: new Response(JSON.stringify({ error: "" }), { status: 400 }) } },
    );
    for (let i = 0; i < 3; i++) expect((await thrown(quoteSellerDelivery("seller1"))).message).toBe("delivery_check_unavailable");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("an answer without a well-formed offer is delivery_check_unavailable, never a half offer", async () => {
    h.queue.push({ data: null }, { data: { offer: { available: "yes", slots: [] } } }, { data: { offer: { available: true } } });
    for (let i = 0; i < 3; i++) expect((await thrown(quoteSellerDelivery("seller1"))).message).toBe("delivery_check_unavailable");
  });
});
