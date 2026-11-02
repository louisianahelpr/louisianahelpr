/**
 * Shipping S6, part 1: a label void BEFORE pickup, and its refund after (docs/specs/shipping-draft.md 5.3; Q2259).
 * A bought label that will never be used (today: the card hold lapsed after the label was bought, so the order cannot
 * be charged) is voided so its postage goes back to the EasyPost balance; a void is only possible before the carrier
 * has the parcel (no acceptance scan). EasyPost answers a void (POST /v2/shipments/:id/refund) with refund_status
 * "submitted", and later "refunded" or "rejected" (docs.easypost.com/docs/shipments, read 2026-11-01); the money returns
 * to the balance 15+ days later (a float, not a loss; spec 5.3).
 * Two steps, never another order:
 *   1. requestShipVoid: compare-and-set bought -> void_requested, only while no acceptance scan exists (the database
 *      write itself carries the same before-pickup filter, so a scan that lands first wins and nothing is voided);
 *   2. runShipVoid, over 'void_requested' rows: read the shipment back FIRST; a void EasyPost already answered is
 *      recorded, never asked again; a shipment never asked (a crash between 1 and the POST) is asked once now;
 *      'submitted' waits for the next run; 'rejected' is recorded and pages ops (spent postage: the seller-debt rule
 *      of 5.3 books it in S6 part 2). A network or provider error is kept on the row and retried next run.
 * TEST MODE ONLY until the owner turns shipping on (lead 2026-10-30): a live-mode label is never touched.
 * The ports are injected so vitest drives every branch (src/test/shipLabelVoid.test.ts); shipLabelRun.ts wires
 * EasyPost and the service-role database.
 */
import { labelStateAfterVoid } from "./easypostLabels.ts";

export type VoidableShipment = {
  id: string;
  declutter_order_id: string;
  label_mode: "test" | "live";
  provider_shipment_id: string;
  tracking_status: string | null;
  accepted_at: string | null;
};

type Answer = { ok: boolean; status: number; body: unknown };

export interface VoidPorts {
  /** GET /v2/shipments/:id */
  getShipment(mode: "test", shipmentId: string): Promise<Answer>;
  /** POST /v2/shipments/:id/refund */
  refundShipment(mode: "test", shipmentId: string): Promise<Answer>;
  /** void_requested -> voided | void_rejected (compare-and-set on void_requested). */
  recordVoid(id: string, state: "voided" | "void_rejected"): Promise<void>;
  /** Keeps the provider's error on the row (never the buyer's address); the row stays void_requested. */
  recordVoidError(id: string, error: string): Promise<void>;
  page(title: string, message: string, fields: Record<string, string>): Promise<void>;
}

/** The carrier has not taken the parcel: no acceptance scan and no tracking past pre-transit. */
export function beforePickup(s: Pick<VoidableShipment, "tracking_status" | "accepted_at">): boolean {
  return s.accepted_at === null && (s.tracking_status === null || s.tracking_status === "pre_transit");
}

export type RequestVoidOutcome = "void_requested" | "void_too_late" | "skipped_live" | "skipped";

/** Step 1. markVoidRequested is the database compare-and-set (bought + before pickup -> void_requested). */
export async function requestShipVoid(
  s: VoidableShipment,
  p: { markVoidRequested(id: string): Promise<boolean>; page: VoidPorts["page"] },
): Promise<RequestVoidOutcome> {
  if (s.label_mode !== "test") return "skipped_live";
  if (!beforePickup(s)) {
    await p.page("Shipped order: label already with the carrier, cannot be voided",
      "A label that should be voided already has a carrier scan. It is spent postage (seller debt, Shipping S6 part 2).",
      { Order: s.declutter_order_id, Shipment: s.provider_shipment_id });
    return "void_too_late";
  }
  return (await p.markVoidRequested(s.id)) ? "void_requested" : "skipped";
}

export type VoidOutcome = "voided" | "void_rejected" | "void_wait" | "void_retry" | "skipped_live";

/** Step 2, one 'void_requested' row. */
export async function runShipVoid(s: VoidableShipment, p: VoidPorts): Promise<VoidOutcome> {
  if (s.label_mode !== "test") return "skipped_live";
  const expect = { shipmentId: s.provider_shipment_id, mode: "test" as const };
  const settle = async (state: ReturnType<typeof labelStateAfterVoid>): Promise<VoidOutcome | null> => {
    if (state === "voided") {
      await p.recordVoid(s.id, "voided");
      return "voided";
    }
    if (state === "void_rejected") {
      await p.recordVoid(s.id, "void_rejected");
      await p.page("Shipping label void rejected",
        "EasyPost rejected the void of a label that was never used. The postage is spent (seller debt, Shipping S6 part 2).",
        { Order: s.declutter_order_id, Shipment: s.provider_shipment_id });
      return "void_rejected";
    }
    if (state === "void_requested") return "void_wait";
    return null;
  };

  // Read back first: a void already asked is never asked twice.
  const read = await p.getShipment("test", s.provider_shipment_id);
  if (!read.ok) {
    await p.recordVoidError(s.id, `void read ${read.status}`);
    return "void_retry";
  }
  const already = await settle(labelStateAfterVoid(read.body, expect));
  if (already) return already;

  const asked = await p.refundShipment("test", s.provider_shipment_id);
  if (!asked.ok) {
    await p.recordVoidError(s.id, `void ${asked.status}`);
    return "void_retry";
  }
  const answered = await settle(labelStateAfterVoid(asked.body, expect));
  if (answered) return answered;
  await p.recordVoidError(s.id, "void answer unreadable");
  return "void_retry";
}
