/**
 * The readers of src/lib/declutter/sellerDeliveryErrors.ts. The tables are
 * pinned against the migrations by src/test/declutterErrorCopy.test.ts and
 * src/test/rpcErrorCopyCoverage.test.ts; this file pins how an error reaches
 * them: whole-token matching per RPC, the step's own words first, then the
 * shared Declutter words.
 *
 * @mutate src/lib/declutter/sellerDeliveryErrors.ts |   if (typeof e?.userMessage === "string" && e.userMessage) return e.userMessage; |
 */
import { describe, expect, it } from "vitest";
import {
  SELLER_DELIVERY_ERROR_COPY as S,
  SELLER_DELIVERY_RPC_ERROR_COPY as T,
  rpcErrorMessage,
  sellerDeliveryErrorMessage,
} from "./sellerDeliveryErrors";
import { DECLUTTER_ERROR_COPY, declutterErrorMessage } from "./errors";

describe("rpcErrorMessage", () => {
  it("reads the code from an Error, a PostgREST error object or a bare string", () => {
    const want = T.declutter_propose_delivery_time.slot_unavailable;
    expect(rpcErrorMessage("declutter_propose_delivery_time", "slot_unavailable")).toBe(want);
    expect(rpcErrorMessage("declutter_propose_delivery_time", new Error("P0001: slot_unavailable"))).toBe(want);
    expect(rpcErrorMessage("declutter_propose_delivery_time", { message: "ERROR:  slot_unavailable\nCONTEXT: ..." })).toBe(want);
  });

  it("each RPC speaks its own words for a shared code", () => {
    // not_reschedulable: a new time vs. the door choice read differently.
    expect(rpcErrorMessage("declutter_propose_delivery_time", "not_reschedulable")).toBe(S.not_reschedulable);
    expect(rpcErrorMessage("declutter_set_delivery_handoff", "not_reschedulable")).toBe(T.declutter_set_delivery_handoff.not_reschedulable);
    expect(T.declutter_set_delivery_handoff.not_reschedulable).not.toBe(S.not_reschedulable);
  });

  it("a code the RPC does not raise, a longer code containing one, or nothing to read is null", () => {
    // no_proposal is answer_delivery_time's, not propose_delivery_time's.
    expect(rpcErrorMessage("declutter_propose_delivery_time", "no_proposal")).toBeNull();
    expect(rpcErrorMessage("declutter_propose_delivery_time", "slot_unavailable_today")).toBeNull();
    expect(rpcErrorMessage("declutter_my_seller_delivery", "")).toBeNull();
    expect(rpcErrorMessage("declutter_my_seller_delivery", null)).toBeNull();
    expect(rpcErrorMessage("declutter_my_seller_delivery", { message: 7 })).toBeNull();
  });

  it("every RPC in the table has codes to match (floor)", () => {
    const rpcs = Object.keys(T) as (keyof typeof T)[];
    expect(rpcs.length).toBeGreaterThan(10);
    for (const rpc of rpcs) {
      const [code, words] = Object.entries(T[rpc])[0];
      expect(rpcErrorMessage(rpc, `ERROR: ${code}`), `${rpc}.${code}`).toBe(words);
    }
  });
});

describe("sellerDeliveryErrorMessage", () => {
  it("words a call site already attached win", () => {
    expect(sellerDeliveryErrorMessage({ message: "slot_unavailable", userMessage: "Pick again." })).toBe("Pick again.");
  });

  it("a seller-delivery code as the message reads the seller-delivery words", () => {
    expect(sellerDeliveryErrorMessage(new Error("delivery_out_of_range"))).toBe(S.delivery_out_of_range);
    expect(sellerDeliveryErrorMessage(new Error("  cancel_window_closed  "))).toBe(S.cancel_window_closed);
  });

  it("anything else falls through to the shared Declutter words", () => {
    const shared = Object.keys(DECLUTTER_ERROR_COPY).find((k) => !(k in S))!;
    expect(sellerDeliveryErrorMessage(new Error(shared))).toBe(DECLUTTER_ERROR_COPY[shared]);
    expect(sellerDeliveryErrorMessage(new Error("TypeError: Failed to fetch"))).toBe(declutterErrorMessage(new Error("TypeError: Failed to fetch")));
    expect(sellerDeliveryErrorMessage({ userMessage: "" , message: "x" })).toBe(declutterErrorMessage({ message: "x" }));
    expect(sellerDeliveryErrorMessage(null)).toBe(declutterErrorMessage(null));
  });
});
