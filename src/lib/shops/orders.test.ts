/**
 * Shops orders' client calls (src/lib/shops/orders.ts): the member's order
 * reads, the shop's cancel settings, the shop-checkout function's actions, and
 * the words each order status reads in.
 *
 * What is pinned: the reads ask for the member's OWN rows and leave out pages
 * that were never paid; an RPC refusal throws the server's code as the message
 * with that RPC's words on `userMessage`; a refused shop-checkout call throws
 * the code from its JSON body (payment_unavailable when there is none); a
 * brand-new quote RPC the database has not deployed offers no cancel.
 *
 * The Supabase client is a recording fake (calls logged, results queued).
 *
 * @mutate src/lib/shops/orders.ts |   return { charged: data.charged === true }; |   return { charged: !!data.charged };
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const reads: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const invokes: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const from = (table: string) => {
    const q = { table, ops: [] as [string, unknown[]][] };
    reads.push(q);
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["select", "eq", "not", "order"]) b[m] = (...a: unknown[]) => (q.ops.push([m, a]), b);
    for (const m of ["limit", "maybeSingle"]) b[m] = (...a: unknown[]) => (q.ops.push([m, a]), Promise.resolve(next()));
    return b;
  };
  return {
    queue,
    reads,
    rpcs,
    invokes,
    supabase: {
      from,
      rpc: (...a: unknown[]) => (rpcs.push(a), Promise.resolve(next())),
      functions: { invoke: (...a: unknown[]) => (invokes.push(a), Promise.resolve(next())) },
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import {
  acceptOrder,
  adminRecordHandRefund,
  adminRefundOrder,
  adminSettleHeldShopRefund,
  buyerCancelOrder,
  cancelOrderRequest,
  declineOrder,
  fetchCancelPolicy,
  fetchCancelQuote,
  fetchMyOrders,
  fetchOrderTerms,
  fetchReadyTapCancel,
  fetchShopOrders,
  firstOpenReadyDate,
  orderStatusLabel,
  reportNoShow,
  requestOrder,
  setCancelPolicy,
  setReadyTapCancel,
  shopCancelOrder,
} from "./orders";
import { SHOPS_RPC_ERROR_COPY as COPY } from "./rpcErrorCopy";

type Thrown = Error & { userMessage?: string; code?: string };

beforeEach(() => {
  h.queue.length = 0;
  h.reads.length = 0;
  h.rpcs.length = 0;
  h.invokes.length = 0;
});

async function thrown(p: Promise<unknown>): Promise<Thrown> {
  try {
    await p;
  } catch (e) {
    return e as Thrown;
  }
  throw new Error("expected a throw");
}

const bodyOf = (i: number) => (h.invokes[i][1] as { body: Record<string, unknown> }).body;

describe("order reads", () => {
  it("the buyer's list: their own rows, never-paid pages left out, newest first, capped", async () => {
    h.queue.push({ data: [{ id: "o1" }] });
    await expect(fetchMyOrders("u1")).resolves.toEqual([{ id: "o1" }]);
    const ops = h.reads[0].ops;
    expect(h.reads[0].table).toBe("shop_orders");
    expect(ops).toContainEqual(["eq", ["buyer_id", "u1"]]);
    expect(ops).toContainEqual(["not", ["status", "in", "(awaiting_hold,superseded)"]]);
    expect(ops).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(ops).toContainEqual(["limit", [100]]);
    expect(String(ops[0][1][0])).toContain("shops (name)");
  });

  it("the shop's list reads by seller, without the shop name join; null data is an empty list", async () => {
    h.queue.push({ data: null });
    await expect(fetchShopOrders("u1")).resolves.toEqual([]);
    expect(h.reads[0].ops).toContainEqual(["eq", ["seller_id", "u1"]]);
    expect(h.reads[0].ops).toContainEqual(["not", ["status", "in", "(awaiting_hold,superseded)"]]);
    expect(String(h.reads[0].ops[0][1][0])).not.toContain("shops (name)");
  });

  it("a read error throws (never an empty list)", async () => {
    h.queue.push({ error: { message: "permission denied for table shop_orders" } });
    expect((await thrown(fetchMyOrders("u1"))).message).toBe("permission denied for table shop_orders");
  });
});

describe("the shop's cancel settings", () => {
  it("reads its own preset and ready-tap choice, with the defaults when unset", async () => {
    h.queue.push({ data: { cancel_policy: "until_accept" } }, { data: null }, { data: { ready_tap_cancel: "ends_at_tap" } }, { data: null });
    await expect(fetchCancelPolicy("s1")).resolves.toBe("until_accept");
    await expect(fetchCancelPolicy("s1")).resolves.toBe("until_24h_before_ready");
    await expect(fetchReadyTapCancel("s1")).resolves.toBe("ends_at_tap");
    await expect(fetchReadyTapCancel("s1")).resolves.toBe("from_day_before");
    expect(h.reads.map((r) => r.table)).toEqual(["shops", "shops", "shops", "shops"]);
    expect(h.reads[0].ops).toContainEqual(["eq", ["id", "s1"]]);
  });

  it("sets them through their RPCs and answers what the server saved", async () => {
    h.queue.push({ data: "until_handover" }, { data: "never_shortens" });
    await expect(setCancelPolicy("until_handover")).resolves.toBe("until_handover");
    await expect(setReadyTapCancel("never_shortens")).resolves.toBe("never_shortens");
    expect(h.rpcs).toEqual([
      ["shops_set_cancel_policy", { p_policy: "until_handover" }],
      ["shops_set_ready_tap_cancel", { p_choice: "never_shortens" }],
    ]);
  });

  it("a refusal throws the code with that RPC's words, keeping the server's fields", async () => {
    h.queue.push({ error: { message: "invalid_cancel_policy", code: "P0001" } });
    const e = await thrown(setCancelPolicy("until_accept"));
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("invalid_cancel_policy");
    expect(e.code).toBe("P0001");
    expect(e.userMessage).toBe(COPY.shops_set_cancel_policy.invalid_cancel_policy);
  });

  it("a code the RPC has no words for throws without userMessage", async () => {
    h.queue.push({ error: { message: "statement timeout" } });
    const e = await thrown(setReadyTapCancel("ends_at_tap"));
    expect(e.message).toBe("statement timeout");
    expect(e).not.toHaveProperty("userMessage");
  });

  it("the order terms come from shops_order_terms; its refusal is worded", async () => {
    const terms = { cancel_policy: "until_accept", today: "2026-10-29" };
    h.queue.push({ data: terms }, { error: { message: "shop_not_found" } });
    await expect(fetchOrderTerms("s1")).resolves.toEqual(terms);
    expect(h.rpcs[0]).toEqual(["shops_order_terms", { p_shop_id: "s1" }]);
    expect((await thrown(fetchOrderTerms("s1"))).userMessage).toBe(COPY.shops_order_terms.shop_not_found);
  });
});

describe("shop-checkout actions", () => {
  it("requestOrder sends the order and the terms the buyer read, and answers the Stripe page", async () => {
    h.queue.push({ data: { url: "https://checkout.stripe.com/c/pay/x" } });
    const url = await requestOrder({
      shopId: "s1",
      lines: [{ item_id: "i1", quantity: 2 }],
      readyDate: "2026-11-02",
      note: "Thanks",
      terms: { cancel_policy: "until_handover" },
    });
    expect(url).toBe("https://checkout.stripe.com/c/pay/x");
    expect(h.invokes[0][0]).toBe("shop-checkout");
    expect(bodyOf(0)).toMatchObject({
      action: "order",
      shop_id: "s1",
      lines: [{ item_id: "i1", quantity: 2 }],
      ready_date: "2026-11-02",
      note: "Thanks",
      // A server older than the ready-tap column sends none: the default is what the buyer read.
      terms: { cancel_policy: "until_handover", ready_tap_cancel: "from_day_before" },
    });
  });

  it("requestOrder without a page URL is payment_unavailable", async () => {
    h.queue.push({ data: {} }, { data: null });
    const args = { shopId: "s1", lines: [], readyDate: "2026-11-02", note: "", terms: { cancel_policy: "until_accept" as const } };
    expect((await thrown(requestOrder(args))).message).toBe("payment_unavailable");
    expect((await thrown(requestOrder(args))).message).toBe("payment_unavailable");
  });

  it("accept, decline (blank reason sent as null), withdraw, cancel, no-show, and the admin actions", async () => {
    h.queue.push({ data: { charged: true } }, { data: { charged: "yes" } });
    await expect(acceptOrder("o1")).resolves.toEqual({ charged: true });
    await expect(acceptOrder("o1")).resolves.toEqual({ charged: false });
    await declineOrder("o1", "   ");
    await declineOrder("o1", " Sold out ");
    await cancelOrderRequest("o1");
    h.queue.push({ data: { refund_cents: 1234 } }, { data: {} });
    await expect(buyerCancelOrder("o1", "free")).resolves.toEqual({ refundCents: 1234 });
    await expect(buyerCancelOrder("o1", "late")).resolves.toEqual({ refundCents: 0 });
    await shopCancelOrder("o1", "");
    await reportNoShow("o1");
    await adminRefundOrder("o1", "problem_shop_fault", "  late  ");
    h.queue.push({ data: { result: "recorded" } }, { data: {} }, { data: { result: "settled" } });
    await expect(adminRecordHandRefund("o1", "re_1", 500, "n")).resolves.toBe("recorded");
    await expect(adminRecordHandRefund("o1", "re_1", 500, "n")).resolves.toBe("");
    await expect(adminSettleHeldShopRefund("r1", "re_2", "n")).resolves.toBe("settled");
    const bodies = h.invokes.map((_, i) => bodyOf(i));
    expect(bodies.map((b) => b.action)).toEqual([
      "accept", "accept", "decline", "decline", "cancel", "buyer_cancel", "buyer_cancel", "shop_cancel", "no_show",
      "admin_refund", "admin_record_hand_refund", "admin_record_hand_refund", "admin_settle_held_refund",
    ]);
    expect(bodies[2].reason).toBeNull();
    expect(bodies[3].reason).toBe("Sold out");
    expect(bodies[5].expect).toBe("free");
    expect(bodies[7].reason).toBeNull();
    expect(bodies[9]).toMatchObject({ reason: "problem_shop_fault", note: "late" });
    expect(bodies[10]).toMatchObject({ order_id: "o1", refund_id: "re_1", amount_cents: 500 });
    expect(bodies[12]).toMatchObject({ refund_row_id: "r1", refund_id: "re_2" });
    for (const b of bodies) expect(b).toHaveProperty("native");
  });

  it("a refused call throws the code from the function's JSON body", async () => {
    const context = new Response(JSON.stringify({ error: "terms_changed", hint: "x" }), { status: 409 });
    h.queue.push({ error: { message: "Edge Function returned a non-2xx status code", context } });
    expect((await thrown(acceptOrder("o1"))).message).toBe("terms_changed");
  });

  it("no body, a body that is not JSON, or no code reads as payment_unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.queue.push(
      { error: { message: "x" } },
      { error: { message: "x", context: new Response("Bad gateway", { status: 502 }) } },
      { error: { message: "x", context: new Response(JSON.stringify({ hint: "no code" }), { status: 400 }) } },
    );
    for (let i = 0; i < 3; i++) expect((await thrown(cancelOrderRequest("o1"))).message).toBe("payment_unavailable");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("fetchCancelQuote", () => {
  it("answers the server's quote, or no cancel when it sends nothing", async () => {
    const quote = { can_cancel: true, free: true, refund_cents: 900 };
    h.queue.push({ data: quote }, { data: null });
    await expect(fetchCancelQuote("o1")).resolves.toEqual(quote);
    await expect(fetchCancelQuote("o1")).resolves.toEqual({ can_cancel: false });
    expect(h.rpcs[0]).toEqual(["shops_order_cancel_quote", { p_order_id: "o1" }]);
  });

  it("the quote RPC not deployed yet offers no cancel and says so", async () => {
    h.queue.push({ error: { code: "PGRST202", message: "Could not find the function public.shops_order_cancel_quote", hint: null } });
    await expect(fetchCancelQuote("o1")).resolves.toEqual({ can_cancel: false, unavailable: true });
  });

  it("a real refusal throws with its words", async () => {
    h.queue.push({ error: { message: "order_not_found" } });
    expect((await thrown(fetchCancelQuote("o1"))).userMessage).toBe(COPY.shops_order_cancel_quote.order_not_found);
  });
});

describe("orderStatusLabel", () => {
  const o = (status: string, close_reason: string | null = null, captured_at: string | null = null) =>
    ({ status, close_reason, captured_at }) as Parameters<typeof orderStatusLabel>[0];

  it("each status has its own words, and an ending reads in each side's words", () => {
    const labels = [
      orderStatusLabel(o("held")),
      orderStatusLabel(o("accepted")),
      orderStatusLabel(o("accepted", null, "2026-10-29T12:00:00Z")),
      orderStatusLabel(o("declined")),
      orderStatusLabel(o("expired", "no_answer")),
      orderStatusLabel(o("expired")),
      orderStatusLabel(o("cancelled", "buyer_cancelled")),
      orderStatusLabel(o("cancelled")),
      orderStatusLabel(o("handed_over")),
      orderStatusLabel(o("refunded")),
      orderStatusLabel(o("partially_refunded")),
      orderStatusLabel(o("awaiting_hold")),
      orderStatusLabel(o("superseded")),
    ];
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[1]).toMatch(/charging/);
    expect(labels[2]).toMatch(/paid/);
  });

  it("a charged order's ending reads in the buyer's or the shop's words", () => {
    const buyer = orderStatusLabel(o("refunded", "shop_cancelled"), "buyer");
    const shop = orderStatusLabel(o("refunded", "shop_cancelled"), "shop");
    expect(buyer).not.toBe(shop);
    expect(orderStatusLabel(o("cancelled", "buyer_cancelled_late"), "shop")).toMatch(/you are paid/);
    expect(orderStatusLabel(o("partially_refunded", "admin_refunded"), "buyer")).toMatch(/^Partly refunded by/);
    expect(orderStatusLabel(o("partially_refunded", "admin_refunded"), "shop")).toMatch(/to the buyer/);
  });

  it("an unknown status is a loud error, not a blank label", () => {
    expect(() => orderStatusLabel(o("teleported"))).toThrow();
  });
});

describe("firstOpenReadyDate", () => {
  it("no open day in the window is null", () => {
    const terms = { today: "2026-10-29", last_day: "2026-11-02", open_weekdays: [], full_days: [] };
    expect(firstOpenReadyDate(terms, 0)).toBeNull();
  });

  it("skips full and closed days to the first fillable one", () => {
    // 2026-10-29 is a Thursday (4); Friday is full; Saturday closed; Sunday open.
    const terms = { today: "2026-10-29", last_day: "2026-11-05", open_weekdays: [0, 4, 5], full_days: ["2026-10-30"] };
    expect(firstOpenReadyDate(terms, 1)).toBe("2026-11-01");
  });
});
