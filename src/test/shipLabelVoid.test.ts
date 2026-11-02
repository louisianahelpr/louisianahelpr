/**
 * Shipping S6 part 1 (supabase/functions/_shared/shipLabelVoid.ts; docs/specs/shipping-draft.md 5.3; Q2259): a label
 * that will never be used is voided BEFORE pickup, and its refund is followed after. Read back first (a void already
 * asked is never asked twice); 'submitted' waits; 'refunded' -> voided; 'rejected' -> void_rejected + ops page; a
 * provider error is kept and retried; live mode is never touched; a scanned label is never voided. The worker and the
 * crash reconcile request the void when the hold is lost after the label was bought, and the run asks EasyPost.
 *
 * @mutate supabase/functions/_shared/shipLabelVoid.ts |   const already = await settle(labelStateAfterVoid(read.body, expect));\n  if (already) return already; |   const already = null;
 * @mutate supabase/functions/_shared/shipLabelVoid.ts |   if (s.label_mode !== "test") return "skipped_live";\n  const expect | const expect
 * @mutate supabase/functions/_shared/shipLabelVoid.ts |   return s.accepted_at === null && (s.tracking_status === null \|\| s.tracking_status === "pre_transit"); |   return true;
 * @mutate supabase/functions/_shared/shipLabelVoid.ts |       await p.recordVoid(s.id, "void_rejected");\n      await p.page( |       await p.recordVoid(s.id, "void_rejected");\n      void (
 * @mutate supabase/functions/_shared/shipLabelVoid.ts |     await p.recordVoidError(s.id, `void ${asked.status}`);\n    return "void_retry"; |     await p.recordVoid(s.id, "void_rejected");\n    return "void_rejected";
 * @mutate supabase/functions/_shared/shipLabelVoid.ts |     if (state === "voided") { |     if (state === "void_requested") {
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |       `The card hold lapsed or was cancelled after the label was bought. ${voidLine(await p.requestVoid(s.id))} Close the order by hand.`,\n        { Order: s.declutter_order_id, Shipment: s.provider_shipment_id, PaymentIntent: pi });\n      return "capture_lost"; |       "The card hold lapsed.",\n        { Order: s.declutter_order_id, Shipment: s.provider_shipment_id, PaymentIntent: pi });\n      return "capture_lost";
 * @mutate supabase/functions/_shared/shipLabelRun.ts |   await runVoids(admin, record, counts); |
 * @mutate supabase/functions/_shared/shipLabelRun.ts |       .eq("id", shipmentId).eq("label_state", "bought").is("accepted_at", null) |       .eq("id", shipmentId).eq("label_state", "bought")
 * @mutate supabase/functions/_shared/shipLabelRun.ts |       .or("tracking_status.is.null,tracking_status.eq.pre_transit").select("id"); |       .select("id");
 * @mutate supabase/functions/_shared/shipLabelRun.ts |         refundShipment: (_m, id) => call(`${EASYPOST}/${id}/refund`, { method: "POST" }), |         refundShipment: (_m, id) => call(`${EASYPOST}/${id}/buy`, { method: "POST" }),
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beforePickup, requestShipVoid, runShipVoid, type VoidableShipment, type VoidPorts } from "../../supabase/functions/_shared/shipLabelVoid";
import { runShipLabel, type ShipLabelPorts } from "../../supabase/functions/_shared/shipLabelWorker";
import { blankComments } from "./helpers/blankNonCode";

const SHP = "shp_void";
const row = (over: Partial<VoidableShipment> = {}): VoidableShipment => ({
  id: "s1", declutter_order_id: "o1", label_mode: "test", provider_shipment_id: SHP, tracking_status: "pre_transit",
  accepted_at: null, ...over,
});
const shipment = (refund_status: string | null, over: Record<string, unknown> = {}) => ({ id: SHP, mode: "test", refund_status, ...over });

function ports(readBody: unknown, refundBody: unknown, over: Partial<VoidPorts> = {}) {
  const calls: string[] = [];
  const p: VoidPorts = {
    getShipment: async () => { calls.push("get"); return { ok: true, status: 200, body: readBody }; },
    refundShipment: async () => { calls.push("refund"); return { ok: true, status: 200, body: refundBody }; },
    recordVoid: async (_id, st) => { calls.push(`record:${st}`); },
    recordVoidError: async (_id, why) => { calls.push(`error:${why}`); },
    page: async () => { calls.push("page"); },
    ...over,
  };
  return { p, calls };
}

describe("runShipVoid: a 'void_requested' label", () => {
  it("never asked: asks EasyPost once; 'submitted' waits for the next run", async () => {
    const { p, calls } = ports(shipment(null), shipment("submitted"));
    expect(await runShipVoid(row(), p)).toBe("void_wait");
    expect(calls).toEqual(["get", "refund"]);
  });
  it("a void already submitted is read back and never asked again", async () => {
    const { p, calls } = ports(shipment("submitted"), shipment("submitted"));
    expect(await runShipVoid(row(), p)).toBe("void_wait");
    expect(calls).toEqual(["get"]);
  });
  it("refunded (now or on read-back): recorded voided, no page", async () => {
    for (const [read, ask, want] of [
      [shipment(null), shipment("refunded"), ["get", "refund", "record:voided"]],
      [shipment("refunded"), null, ["get", "record:voided"]],
    ] as const) {
      const { p, calls } = ports(read, ask);
      expect(await runShipVoid(row(), p)).toBe("voided");
      expect(calls).toEqual(want);
    }
  });
  it("rejected: recorded void_rejected and ops is paged (spent postage)", async () => {
    const { p, calls } = ports(shipment(null), shipment("rejected"));
    expect(await runShipVoid(row(), p)).toBe("void_rejected");
    expect(calls).toEqual(["get", "refund", "record:void_rejected", "page"]);
  });
  it("a provider error or an unreadable answer is kept on the row and retried, never recorded as settled", async () => {
    for (const [over, want] of [
      [{ getShipment: async () => ({ ok: false, status: 503, body: null }) }, ["error:void read 503"]],
      [{ refundShipment: async () => ({ ok: false, status: 0, body: null }) }, ["get", "error:void 0"]],
    ] as const) {
      const { p, calls } = ports(shipment(null), null, over as Partial<VoidPorts>);
      expect(await runShipVoid(row(), p)).toBe("void_retry");
      expect(calls).toEqual(want);
    }
    const odd = ports(shipment(null), shipment("refunded", { mode: "live" }));
    expect(await runShipVoid(row(), odd.p)).toBe("void_retry");
    expect(odd.calls).toEqual(["get", "refund", "error:void answer unreadable"]);
  });
  it("a live label is never touched", async () => {
    const { p, calls } = ports(shipment(null), shipment("refunded"));
    expect(await runShipVoid(row({ label_mode: "live" }), p)).toBe("skipped_live");
    expect(calls).toEqual([]);
  });
});

describe("requestShipVoid: only before pickup", () => {
  it("before pickup: compare-and-set to void_requested", async () => {
    const calls: string[] = [];
    const p = { markVoidRequested: async () => { calls.push("mark"); return true; }, page: async () => { calls.push("page"); } };
    expect(await requestShipVoid(row(), p)).toBe("void_requested");
    expect(await requestShipVoid(row({ tracking_status: null }), p)).toBe("void_requested");
    expect(calls).toEqual(["mark", "mark"]);
  });
  it("a scanned label is never voided (pages ops instead); a lost compare-and-set is skipped", async () => {
    expect(beforePickup({ tracking_status: "in_transit", accepted_at: null })).toBe(false);
    expect(beforePickup({ tracking_status: "pre_transit", accepted_at: "2026-11-01T10:00:00Z" })).toBe(false);
    const calls: string[] = [];
    const p = { markVoidRequested: async () => { calls.push("mark"); return false; }, page: async () => { calls.push("page"); } };
    expect(await requestShipVoid(row({ tracking_status: "in_transit" }), p)).toBe("void_too_late");
    expect(calls).toEqual(["page"]);
    expect(await requestShipVoid(row(), p)).toBe("skipped");
    expect(await requestShipVoid(row({ label_mode: "live" }), p)).toBe("skipped_live");
  });
});

describe("the hold is lost after the label was bought: the void is requested", () => {
  it("the worker requests the void and says so in the ops page", async () => {
    const calls: string[] = [];
    const pages: string[] = [];
    const bought = { id: SHP, mode: "test", rates: [{ id: "r", rate: "7.33", currency: "USD" }],
      postage_label: { label_url: "https://x/l.pdf" }, tracking_code: "9400", selected_rate: { id: "r", rate: "7.33", currency: "USD" } };
    const p: ShipLabelPorts = {
      getShipment: async () => ({ ok: true, status: 200, body: bought }),
      buyShipment: async () => ({ ok: true, status: 200, body: bought }),
      rateBuyable: async () => true, recordBought: async () => true, recordFailed: async () => {}, recordRetry: async () => {},
      captureAmount: async () => 2485, capture: async () => "hold_lost", release: async () => {},
      setCapture: async (_o, st) => { calls.push(`set:${st}`); }, closeReleased: async () => "closed",
      page: async (_t, m) => { pages.push(m); },
      requestVoid: async (id) => { calls.push(`void:${id}`); return true; },
    };
    const claim = { id: "s1", declutter_order_id: "o1", label_mode: "test" as const, provider_shipment_id: SHP,
      provider_rate_id: "r", quoted_cents: 733, attempts: 0 };
    expect(await runShipLabel(claim, { status: "paid", ship_capture: "held", stripe_payment_intent_id: "pi" }, p)).toBe("capture_lost");
    expect(calls).toEqual(["void:s1"]);
    expect(pages.join(" ")).toContain("The label void was requested");
  });
  it("the run: worker and reconcile get the void port, the void pass runs last and asks /refund", () => {
    const run = blankComments(readFileSync("supabase/functions/_shared/shipLabelRun.ts", "utf8"));
    expect((run.match(/requestVoid: requestVoidWith\(admin\)/g) ?? []).length).toBe(2);
    expect(run.indexOf("await reconcileCaptures(")).toBeLessThan(run.indexOf("await runVoids("));
    expect(run).toContain(`.eq("label_state", "void_requested")`);
    expect(run).toContain("/refund`, { method: \"POST\" }");
    expect(run).toContain(`.eq("id", shipmentId).eq("label_state", "bought").is("accepted_at", null)`);
    expect(run).toContain(`.or("tracking_status.is.null,tracking_status.eq.pre_transit")`);
  });
});
