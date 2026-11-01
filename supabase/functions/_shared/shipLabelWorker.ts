/**
 * Shipping S3 label worker (docs/specs/shipping-draft.md 5.2; money review fixes 2, 7, 8 and 13; Q2259). One pass over
 * ONE claimed shipment: the claim row was written in the same transaction that recorded the card hold
 * (20261101201500_shipping_s3_checkout_claim). Order of events, never another:
 *   1. read the shipment back from EasyPost; a label already on it is USED (a resume after a crash), never re-bought;
 *   2. otherwise check the stored rate (still offered, same mode, not dearer than the buyer paid: checkBeforeBuy, then
 *      the database's own shipping_rate_buyable) and buy exactly that rate, once (EasyPost idempotency by shipment);
 *   3. record the label (the real cost ALWAYS, flagged when above the quote) BEFORE any capture;
 *   4. capture the hold (idempotency key per order, so a retry never captures twice).
 * A label that cannot be bought (rate gone, dearer, wrong mode or shipment) RELEASES the hold: a cancelled hold costs
 * nobody anything (fix 2). A network or provider error is a retry with backoff, never a release.
 * TEST MODE ONLY until the owner turns shipping on (lead 2026-10-30): a live-mode claim is never touched.
 *
 * The ports are injected so vitest drives every branch on recorded answers (src/test/shipLabelWorker.test.ts); the
 * declutter-money run supplies the real EasyPost fetch, Stripe and the service-role database.
 */
import { checkBeforeBuy, labelOnShipment } from "./easypostLabels.ts";

export type ClaimedShipment = {
  id: string;
  declutter_order_id: string;
  label_mode: "test" | "live";
  provider_shipment_id: string;
  provider_rate_id: string;
  quoted_cents: number;
  attempts: number;
};

export type ShipOrder = { status: string; ship_capture: string | null; stripe_payment_intent_id: string | null };

export interface ShipLabelPorts {
  /** GET /v2/shipments/:id (null body = the provider did not answer usefully). */
  getShipment(mode: "test", shipmentId: string): Promise<{ ok: boolean; status: number; body: unknown }>;
  /** POST /v2/shipments/:id/buy with { rate: { id } }. */
  buyShipment(mode: "test", shipmentId: string, body: { rate: { id: string } }): Promise<{ ok: boolean; status: number; body: unknown }>;
  rateBuyable(shipmentId: string, rateCents: number): Promise<boolean>;
  /** Compare-and-set: claimed -> bought with the label; false when the row was no longer 'claimed'. */
  recordBought(shipmentId: string, label: { costCents: number; trackingCode: string; labelUrl: string }): Promise<boolean>;
  /** claimed -> failed, with the reason. */
  recordFailed(shipmentId: string, reason: string): Promise<void>;
  /** A retry later: attempts + 1, next_attempt_at pushed back, the error kept (never the buyer's address). */
  recordRetry(shipmentId: string, attempts: number, error: string): Promise<void>;
  /** The cents to capture (declutter_ship_setup_fee_at_capture): the total, plus the setup fee only when this order
   *  claimed it; a fee the account paid elsewhere first is simply not captured (20261101220810). */
  captureAmount(orderId: string): Promise<number>;
  capture(paymentIntentId: string, orderId: string, amountCents: number): Promise<"captured" | "hold_lost">;
  release(paymentIntentId: string, orderId: string): Promise<void>;
  setCapture(orderId: string, state: "captured" | "released"): Promise<void>;
  /** declutter_ship_hold_released: the order closes (never left 'paid'), items back on sale, a claimed setup fee
   *  given back to the account, both sides told (20261101220810). */
  closeReleased(orderId: string): Promise<string>;
  page(title: string, message: string, fields: Record<string, string>): Promise<void>;
}

export type LabelOutcome =
  | "bought_captured" | "reused_captured" | "released" | "retry" | "skipped_live" | "skipped_not_held" | "capture_lost";

/** Backoff for a retry: 5 min, doubling, at most 6 h. */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempts), 6 * 60 * 60_000);
}

/** After this many tries ops is paged (the hold is still valid for days; nobody is charged meanwhile). */
export const PAGE_AFTER_ATTEMPTS = 6;

export async function runShipLabel(s: ClaimedShipment, order: ShipOrder | null, p: ShipLabelPorts): Promise<LabelOutcome> {
  if (s.label_mode !== "test") return "skipped_live";
  if (!order || order.status !== "paid" || order.ship_capture !== "held" || !order.stripe_payment_intent_id) {
    return "skipped_not_held";
  }
  const pi = order.stripe_payment_intent_id;
  const expect = { shipmentId: s.provider_shipment_id, mode: "test" as const, quotedCents: s.quoted_cents };

  const retry = async (why: string): Promise<LabelOutcome> => {
    const attempts = s.attempts + 1;
    await p.recordRetry(s.id, attempts, why.slice(0, 500));
    if (attempts === PAGE_AFTER_ATTEMPTS) {
      await p.page("Shipping label not bought yet (will keep trying)",
        `A shipped Declutter order's label failed ${attempts} times (${why.slice(0, 120)}). The buyer's card is only held, nobody is charged; check EasyPost (balance, status).`,
        { Order: s.declutter_order_id, Shipment: s.provider_shipment_id });
    }
    return "retry";
  };
  const releaseHold = async (reason: string): Promise<LabelOutcome> => {
    await p.recordFailed(s.id, reason);
    await p.release(pi, s.declutter_order_id);
    await p.setCapture(s.declutter_order_id, "released");
    const closed = await p.closeReleased(s.declutter_order_id);
    await p.page("Shipping label could not be bought: hold released",
      `The label for a shipped Declutter order could not be bought (${reason}). The buyer's hold was released at no cost and the order was closed (${closed}); both sides were told.`,
      { Order: s.declutter_order_id, Shipment: s.provider_shipment_id });
    return "released";
  };
  const captureAfter = async (label: { costCents: number; trackingCode: string; labelUrl: string; overQuote: boolean },
    outcome: "bought_captured" | "reused_captured"): Promise<LabelOutcome> => {
    // The label is recorded BEFORE the capture, so a crash between them resumes into "reuse + capture".
    const recorded = await p.recordBought(s.id, label);
    if (!recorded) return "skipped_not_held";
    if (label.overQuote) {
      await p.page("Shipping label cost more than the buyer paid",
        `A label cost ${label.costCents} cents against ${s.quoted_cents} quoted. Recorded; check the rate.`,
        { Order: s.declutter_order_id, Shipment: s.provider_shipment_id });
    }
    const amount = await p.captureAmount(s.declutter_order_id);
    const captured = await p.capture(pi, s.declutter_order_id, amount);
    if (captured === "hold_lost") {
      await p.page("Shipped order: label bought but the hold could not be captured",
        "The card hold lapsed or was cancelled after the label was bought. Void the label (Shipping S6) and close the order by hand.",
        { Order: s.declutter_order_id, Shipment: s.provider_shipment_id, PaymentIntent: pi });
      return "capture_lost";
    }
    await p.setCapture(s.declutter_order_id, "captured");
    return outcome;
  };

  // 1. Read the shipment back first (fix 7).
  const read = await p.getShipment("test", s.provider_shipment_id);
  if (!read.ok) return retry(`read ${read.status}`);
  const existing = labelOnShipment(read.body, expect);
  if (existing.ok) return captureAfter(existing.label, "reused_captured");
  if (existing.reason !== "no_label") {
    // A shipment in the other mode, another id, or a label with no readable cost: never bought on, never guessed.
    return existing.reason === "bad_cost" ? retry("label cost unreadable") : releaseHold(existing.reason);
  }

  // 2. Check, then buy exactly the stored rate.
  const check = checkBeforeBuy(read.body, { ...expect, rateId: s.provider_rate_id });
  if (!check.buy) return releaseHold(check.reason);
  if (!(await p.rateBuyable(s.id, s.quoted_cents))) return releaseHold("over_collected_shipping");
  const bought = await p.buyShipment("test", s.provider_shipment_id, check.body);
  if (!bought.ok) {
    // An unanswered buy may still have bought: the next pass reads the shipment back first and uses its label.
    return retry(`buy ${bought.status}`);
  }
  const label = labelOnShipment(bought.body, expect);
  if (!label.ok) return retry(`buy answer ${label.reason}`);
  return captureAfter(label.label, "bought_captured");
}
