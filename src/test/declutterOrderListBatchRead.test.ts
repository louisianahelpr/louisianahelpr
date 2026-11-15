/**
 * The Declutter order list reads its cards in ONE call (builder 1, 2026-11-15; handoff builder4b-1115 section 1b).
 *
 * The defect: /declutter?tab=buying for the poster-e2e test account (11 orders) made about 77 requests, one per order
 * and fact: declutter_my_handover x9, declutter_refund_request_view x6, declutter_order_problem x6 and the order row
 * (declutter_orders) per card for the other person. Now every one of those reads goes through orderCardPart, and the
 * reads asked in one tick are one declutter_my_order_cards call (20261115185143).
 *
 * This pins the count: the same 32 reads the list made for those 11 orders, asked in one tick, are exactly ONE request,
 * and the per-order read is asked only when the batch has no answer for it. A source half keeps every per-order call
 * inside its lib function, so no screen can call the per-order RPC around the batch.
 *
 * @mutate src/lib/declutter/orderCards.ts | queueMicrotask(flush); | flush();
 * @mutate src/lib/declutter/handover.ts | return orderCardPart(orderId, "handover", () => fetchMyHandoverAlone(orderId)); | return fetchMyHandoverAlone(orderId);
 * @mutate src/lib/declutter/handover.ts | return orderCardPart(orderId, "problem", () => fetchOrderProblemAlone(orderId)); | return fetchOrderProblemAlone(orderId);
 * @mutate src/lib/declutter/refundRequests.ts | return orderCardPart(orderId, "refund", () => fetchRefundRequestViewAlone(orderId)); | return fetchRefundRequestViewAlone(orderId);
 * @mutate src/lib/declutter/reviews.ts | return orderCardPart(orderId, "other", () => fetchOrderOtherPersonAlone(orderId, myId)); | return fetchOrderOtherPersonAlone(orderId, myId);
 * @mutate src/lib/declutter/orderCards.ts | if (part == null && kind !== "problem") return direct(); | if (part == null) return direct();
 * @mutate src/lib/declutter/orderCards.ts | if (isMissingRpcNamed(res.error, "declutter_my_order_cards")) notDeployed = true; | if (isMissingRpcNamed(res.error, "declutter_my_order_cards")) void 0;
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

type Call = { kind: "rpc" | "from"; name: string; args?: unknown };
const h = vi.hoisted(() => ({
  calls: [] as { kind: "rpc" | "from"; name: string; args?: unknown }[],
  batch: null as null | ((ids: string[]) => { data: unknown; error: unknown }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const rows = { data: { buyer_id: "me", seller_id: "them" }, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => rows;
  return {
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        h.calls.push({ kind: "rpc", name, args });
        if (name === "declutter_my_order_cards") return h.batch ? h.batch(args.p_order_ids as string[]) : { data: [], error: null };
        return { data: { per_order: name, order_id: args.p_order_id }, error: null };
      },
      from: (name: string) => {
        h.calls.push({ kind: "from", name });
        return chain;
      },
    },
  };
});

import { fetchMyHandover, fetchOrderProblem } from "@/lib/declutter/handover";
import { fetchRefundRequestView } from "@/lib/declutter/refundRequests";
import { fetchOrderOtherPerson } from "@/lib/declutter/reviews";
import { __resetOrderCardsForTests, type OrderCardRow } from "@/lib/declutter/orderCards";

const ID = (n: number) => `0dc40dc4-0000-0000-0000-${String(n).padStart(12, "0")}`;
/** poster-e2e on prod 2026-11-15: 11 orders (6 handed_over, 4 paid, 1 refunded). */
const ORDERS = Array.from({ length: 11 }, (_, i) => ({ id: ID(i + 1), status: i < 6 ? "handed_over" : i < 10 ? "paid" : "refunded" }));

function row(id: string, status: string, n: number): OrderCardRow {
  return {
    order_id: id,
    other_id: `other-${n}`,
    handover: status === "refunded" ? null : { order_id: id, status, side: "buyer" },
    // Half the orders have no problem: null is the answer, never a reason to ask again.
    problem: n % 2 ? { id: `p-${n}`, reason: "damaged" } : null,
    refund: { order_id: id, side: "buyer", request: null },
  };
}

const okBatch = (ids: string[]) => ({
  data: ORDERS.filter((o) => ids.includes(o.id)).map((o) => row(o.id, o.status, ORDERS.indexOf(o) + 1)),
  error: null,
});

/** The 32 reads the Buying list and its cards made for those 11 orders (handoff 1b's measured mix plus one per card). */
function listReads(): Promise<unknown>[] {
  const handover = ORDERS.filter((o) => o.status !== "refunded").slice(0, 9);
  const handed = ORDERS.filter((o) => o.status === "handed_over");
  return [
    ...handover.map((o) => fetchMyHandover(o.id)),
    ...handed.map((o) => fetchRefundRequestView(o.id)),
    ...handed.map((o) => fetchOrderProblem(o.id)),
    ...ORDERS.map((o) => fetchOrderOtherPerson(o.id, "me")),
  ];
}

const requests = (): Call[] => h.calls;

beforeEach(() => {
  h.calls = [];
  h.batch = okBatch;
  __resetOrderCardsForTests();
});

describe("Declutter order list: one request for every card", () => {
  it("the 32 per-card reads for 11 orders, asked in one tick, are ONE request (was about 32 + the order rows)", async () => {
    const reads = listReads();
    expect(reads.length).toBe(32);
    const out = await Promise.all(reads);
    expect(requests().map((c) => c.name)).toEqual(["declutter_my_order_cards"]);
    expect(new Set((requests()[0].args as { p_order_ids: string[] }).p_order_ids)).toEqual(new Set(ORDERS.map((o) => o.id)));
    // Each read gets its own part of the batch.
    expect(out[0]).toEqual({ order_id: ID(1), status: "handed_over", side: "buyer" });
    expect(out.slice(21)).toEqual(ORDERS.map((_, i) => `other-${i + 1}`));
    const problems = out.slice(15, 21);
    expect(problems.filter((p) => p === null).length).toBe(3);
  });

  it("a later tick asks again (never a stale answer after a change)", async () => {
    await fetchMyHandover(ID(1));
    await fetchMyHandover(ID(1));
    expect(requests().map((c) => c.name)).toEqual(["declutter_my_order_cards", "declutter_my_order_cards"]);
  });

  it("an order the batch does not answer (an admin's read, a stranger) asks the per-order read alone", async () => {
    h.batch = () => ({ data: [], error: null });
    const [p, hv, other] = await Promise.all([fetchOrderProblem(ID(1)), fetchMyHandover(ID(2)), fetchOrderOtherPerson(ID(3), "me")]);
    expect(requests().map((c) => c.name)).toEqual(["declutter_my_order_cards", "declutter_order_problem", "declutter_my_handover", "declutter_orders"]);
    expect(p).toEqual({ per_order: "declutter_order_problem", order_id: ID(1) });
    expect(hv).toEqual({ per_order: "declutter_my_handover", order_id: ID(2) });
    expect(other).toBe("them");
  });

  it("a refunded order's handover read and a switched-off refund read keep the per-order read's own answer", async () => {
    h.batch = (ids) => ({ data: ids.map((id) => ({ ...row(id, "refunded", 2), refund: null })), error: null });
    await Promise.all([fetchMyHandover(ID(11)), fetchRefundRequestView(ID(11))]);
    expect(requests().map((c) => c.name)).toEqual(["declutter_my_order_cards", "declutter_my_handover", "declutter_refund_request_view"]);
  });

  it("before the batch read is on the server (PGRST202) the cards ask per order, and the batch is not asked again", async () => {
    h.batch = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_my_order_cards(p_order_ids) in the schema cache" } });
    await fetchMyHandover(ID(1));
    await fetchMyHandover(ID(2));
    expect(requests().map((c) => c.name)).toEqual(["declutter_my_order_cards", "declutter_my_handover", "declutter_my_handover"]);
  });

  it("source: each per-order read is called in exactly one place, its lib function (no screen goes around the batch)", () => {
    const at = (file: string) => blankComments(readFileSync(file, "utf8"));
    const handover = at("src/lib/declutter/handover.ts");
    const refunds = at("src/lib/declutter/refundRequests.ts");
    const reviews = at("src/lib/declutter/reviews.ts");
    const count = (s: string, needle: string) => s.split(needle).length - 1;
    expect(count(handover, 'rpc("declutter_my_handover"')).toBe(1);
    expect(count(handover, 'rpc("declutter_order_problem"')).toBe(1);
    expect(count(refunds, 'rpc("declutter_refund_request_view"')).toBe(1);
    expect(count(reviews, 'from("declutter_orders")')).toBe(1);
    expect(count(handover, 'orderCardPart(orderId, "handover"') + count(handover, 'orderCardPart(orderId, "problem"')).toBe(2);
    expect(count(refunds, 'orderCardPart(orderId, "refund"')).toBe(1);
    expect(count(reviews, 'orderCardPart(orderId, "other"')).toBe(1);
  });
});
